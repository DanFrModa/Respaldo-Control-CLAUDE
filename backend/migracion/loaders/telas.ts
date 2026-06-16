/**
 * Loader de TELAS UNIFICADAS (F1-E6, D5 — ADR-0009). `Telas.csv` (877) + `TelasDis.csv`
 * (109) → UNA sola entidad `Tela` (corrige la dualidad del viejo). Carga VÍA el dominio
 * (A1): `crearTela`. Persiste DOS mapeos: `Tela:IdTelas` y `Tela:IdTelasDis`.
 *
 * UNIFICACIÓN: ADR-0009 NO fija la llave de join entre Telas y TelasDis. Se usa el **nombre
 * normalizado** (`Telas.Nombre` vs `TelasDis.TelaDis`) como llave y se REPORTAN los
 * no-mapeados en AMBOS sentidos (Tela sin TelaDis y TelaDis sin Tela) para decisión
 * (§7, no arreglar en silencio):
 *  • Una `Tela` cuyo nombre coincide con un `TelaDis` → un solo `Tela` (la base es Telas;
 *    se anota en el reporte que hubo match).
 *  • `TelasDis` SIN match en Telas → se crea como `Tela` propia (no se pierde) y se reporta.
 *  • `Telas` SIN match en TelasDis → normal (la mayoría); se reporta el conteo agregado.
 *
 * `Texto1`/`Texto2` → `tipoComponente` (CUERPO/CARDIGAN/OTRO). `Tela.nombre` @unique → se
 * desambiguan duplicados con sufijo y se reportan. `Activa` → desactivar tras crear si toca.
 * Los COLORES se cargan en `telas-colores.ts` (necesita el mapeo de telas y de colores).
 */
import { actualizarTela, crearTela } from '../../src/dominio/catalogos/telas.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import { mapearTipoComponente } from '../comun/mapeos-enum.js';
import { ENTIDAD_MAPEO, guardarMapeo, leerMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { crearConNombreUnico, intentarCrear, LIMITES, truncarYReportar } from '../comun/saneo.js';
import {
  normalizarParaDedup,
  parsearBandera,
  parsearDinero,
  parsearTexto,
} from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** Desenlace de procesar una tela (para agregar conteos tras los lotes). */
type Desenlace = 'creado' | 'existente' | 'omitido' | 'omitidoValidacion';

async function idTelaPorNombre(cliente: ClienteMapeo, nombre: string): Promise<number | null> {
  const fila = await cliente.tela.findFirst({
    where: { nombre: { equals: nombre, mode: 'insensitive' } },
    select: { id: true },
  });
  return fila?.id ?? null;
}

/** Nombre @unique libre (case-insensitive), con sufijo `(n)` si choca. */
async function nombreTelaLibre(cliente: ClienteMapeo, base: string): Promise<string> {
  if ((await idTelaPorNombre(cliente, base)) === null) {
    return base;
  }
  for (let n = 2; n < 1000; n += 1) {
    const candidato = `${base} (${String(n)})`;
    if ((await idTelaPorNombre(cliente, candidato)) === null) {
      return candidato;
    }
  }
  return `${base} (${String(Date.now())})`;
}

export async function cargarTelas(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };

  // Índice de TelasDis por nombre normalizado (para el join y para detectar no-mapeados).
  const telasDis = leerCsv('TelasDis.csv');
  const disPorNombre = new Map<string, Record<string, string>>();
  for (const d of telasDis) {
    const n = parsearTexto(d.TelaDis);
    if (n !== null) {
      disPorNombre.set(normalizarParaDedup(n), d);
    }
  }
  const disUsados = new Set<string>(); // nombres normalizados de TelasDis que sí matchearon
  const contadores = { telasSinTelaDis: 0, disSinTela: 0 };

  // ── 1) Telas (base) — filas INDEPENDIENTES → carga concurrente acotada ────────
  const resBase = await enLotes(
    leerCsv('Telas.csv'),
    (fila): Promise<Desenlace> =>
      procesarTelaBase(sesion, bd, cliente, reporte, disPorNombre, disUsados, contadores, fila),
    CONCURRENCIA_ETL,
  );

  // ── 2) TelasDis SIN match en Telas → Tela propia. Corre DESPUÉS de (1): necesita
  // `disUsados` completo y las telas base ya creadas (desambiguación de nombre coherente).
  const resDis = await enLotes(
    telasDis,
    (d): Promise<Desenlace> =>
      procesarTelaDisSinTela(sesion, bd, cliente, reporte, disUsados, contadores, d),
    CONCURRENCIA_ETL,
  );

  // Agregación de conteos.
  let creados = 0;
  let existentes = 0;
  let omitidos = 0;
  let omitidosValidacion = 0;
  for (const r of [...resBase, ...resDis]) {
    const d = r.ok ? r.valor : 'omitidoValidacion';
    if (d === 'creado') creados += 1;
    else if (d === 'existente') existentes += 1;
    else if (d === 'omitido') omitidos += 1;
    else omitidosValidacion += 1;
  }

  // Conteos agregados al reporte (decisión de Gabriel/Daniel sobre la llave de unificación).
  reporte.nota(
    `Unificación de telas: ${String(contadores.telasSinTelaDis)} Telas sin TelaDis (normal), ` +
      `${String(contadores.disSinTela)} TelasDis sin Tela base (creadas aparte). Llave de join = nombre normalizado.`,
  );

  return { creados, existentes, omitidos, omitidosValidacion };
}

/** Procesa UNA fila de `Telas.csv` (base), unificando con su `TelaDis` si hay match por nombre. */
async function procesarTelaBase(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: ClienteMapeo,
  reporte: Reporte,
  disPorNombre: Map<string, Record<string, string>>,
  disUsados: Set<string>,
  contadores: { telasSinTelaDis: number; disSinTela: number },
  fila: Record<string, string>,
): Promise<Desenlace> {
  const idViejo = fila.IdTelas;
  const nombreCrudo = parsearTexto(fila.Nombre);
  if (nombreCrudo === null) {
    reporte.agregar('Telas con nombre vacío (omitidas)', `IdTelas=${idViejo ?? '?'}`);
    return 'omitido';
  }
  const nombreOriginal =
    truncarYReportar(reporte, 'Tela', idViejo, 'nombre', nombreCrudo, LIMITES.tela.nombre) ??
    nombreCrudo;

  // Idempotencia por IdTelas.
  if (idViejo !== undefined) {
    const ya = await leerMapeo(cliente, ENTIDAD_MAPEO.telaPorIdTelas, idViejo);
    if (ya !== null) {
      const norm = normalizarParaDedup(nombreOriginal);
      if (disPorNombre.has(norm)) {
        disUsados.add(norm);
      }
      return 'existente';
    }
  }

  const norm = normalizarParaDedup(nombreOriginal);
  const disMatch = disPorNombre.get(norm);
  if (disMatch !== undefined) {
    disUsados.add(norm);
    reporte.agregar(
      'Telas unificadas con TelaDis (match por nombre)',
      `"${nombreOriginal}" (IdTelas=${idViejo ?? '?'}, IdTelasDis=${disMatch.IdTelasDis ?? '?'})`,
    );
  } else {
    contadores.telasSinTelaDis += 1;
  }

  const idCategoria = await resolverCategoria(cliente, fila.IdTelasCategorias);
  const tipoComponente = mapearTipoComponente(fila.Texto1, fila.Texto2);
  const descripcion =
    truncarYReportar(
      reporte,
      'Tela',
      idViejo,
      'descripcion',
      parsearTexto(fila.Descripcion),
      LIMITES.tela.descripcion,
    ) ?? undefined;
  const precioSugerido = parsearDinero(fila.PrecioSugerido);
  const favorito = parsearBandera(fila.Favorito);
  const paraProduccion = disMatch ? parsearBandera(disMatch.ParaProduccion) : true;

  // Crear con nombre @unique desambiguado, tolerante a carreras concurrentes.
  const creado = await intentarCrear(reporte, 'Tela', idViejo, () =>
    crearConNombreUnico(
      nombreOriginal,
      (base) => nombreTelaLibre(cliente, base),
      (nombre) =>
        crearTela(
          sesion,
          {
            nombre,
            tipoComponente,
            favorito,
            paraProduccion,
            ...(idCategoria === null ? {} : { idCategoria }),
            ...(descripcion === undefined ? {} : { descripcion }),
            ...(precioSugerido === null ? {} : { precioSugerido: Math.max(0, precioSugerido) }),
            colores: [], // los colores se cargan después (telas-colores.ts)
          },
          bd,
        ),
    ),
  );
  if (creado === null) {
    return 'omitidoValidacion';
  }
  if (creado.nombre !== nombreOriginal) {
    reporte.agregar(
      'Telas con nombre duplicado (desambiguadas con sufijo)',
      `"${nombreOriginal}" → "${creado.nombre}" (IdTelas=${idViejo ?? '?'})`,
    );
  }

  if (!parsearBandera(fila.Activa)) {
    await actualizarTela(sesion, { id: creado.id, activo: false }, bd);
  }

  if (idViejo !== undefined) {
    await guardarMapeo(cliente, ENTIDAD_MAPEO.telaPorIdTelas, idViejo, creado.id, {
      nombre: creado.nombre,
      ...(creado.nombre !== nombreOriginal ? { nombreOriginal } : {}),
    });
  }
  // Si hubo match con un TelaDis, ese IdTelasDis apunta a la MISMA Tela nueva.
  if (disMatch?.IdTelasDis !== undefined) {
    await guardarMapeo(cliente, ENTIDAD_MAPEO.telaPorIdTelasDis, disMatch.IdTelasDis, creado.id, {
      nombre: creado.nombre,
      via: 'match-Telas',
    });
  }
  return 'creado';
}

/** Procesa UNA `TelasDis` SIN Tela base → la crea como Tela propia (no se pierde). */
async function procesarTelaDisSinTela(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: ClienteMapeo,
  reporte: Reporte,
  disUsados: Set<string>,
  contadores: { telasSinTelaDis: number; disSinTela: number },
  d: Record<string, string>,
): Promise<Desenlace> {
  const nombreCrudo = parsearTexto(d.TelaDis);
  if (nombreCrudo === null) {
    return 'omitido';
  }
  const nombreOriginal =
    truncarYReportar(reporte, 'Tela', d.IdTelasDis, 'nombre', nombreCrudo, LIMITES.tela.nombre) ??
    nombreCrudo;
  const norm = normalizarParaDedup(nombreOriginal);
  if (disUsados.has(norm)) {
    return 'omitido'; // ya unificada con una Tela (no es incidencia)
  }
  // Idempotencia por IdTelasDis.
  if (d.IdTelasDis !== undefined) {
    const ya = await leerMapeo(cliente, ENTIDAD_MAPEO.telaPorIdTelasDis, d.IdTelasDis);
    if (ya !== null) {
      return 'existente';
    }
  }
  contadores.disSinTela += 1;
  reporte.agregar(
    'TelasDis SIN Tela base (creadas como Tela propia)',
    `"${nombreOriginal}" (IdTelasDis=${d.IdTelasDis ?? '?'}, proveedor="${parsearTexto(d.Proveedor) ?? ''}")`,
  );

  const descripcion =
    truncarYReportar(
      reporte,
      'Tela',
      d.IdTelasDis,
      'descripcion',
      parsearTexto(d.Descripcion),
      LIMITES.tela.descripcion,
    ) ?? undefined;
  const precio = parsearDinero(d.Precio);
  const creado = await intentarCrear(reporte, 'Tela', d.IdTelasDis, () =>
    crearConNombreUnico(
      nombreOriginal,
      (base) => nombreTelaLibre(cliente, base),
      (nombre) =>
        crearTela(
          sesion,
          {
            nombre,
            paraProduccion: parsearBandera(d.ParaProduccion),
            ...(descripcion === undefined ? {} : { descripcion }),
            ...(precio === null ? {} : { precioSugerido: Math.max(0, precio) }),
            colores: [],
          },
          bd,
        ),
    ),
  );
  if (creado === null) {
    return 'omitidoValidacion';
  }
  if (d.IdTelasDis !== undefined) {
    await guardarMapeo(cliente, ENTIDAD_MAPEO.telaPorIdTelasDis, d.IdTelasDis, creado.id, {
      nombre: creado.nombre,
      via: 'TelaDis-sin-Tela',
    });
  }
  return 'creado';
}

/** Traduce `IdTelasCategorias` (viejo) → idCategoria nuevo vía el mapeo; null si no hay. */
async function resolverCategoria(
  cliente: ClienteMapeo,
  idTelasCategorias: string | undefined,
): Promise<number | null> {
  if (idTelasCategorias === undefined || idTelasCategorias.trim() === '') {
    return null;
  }
  const idNuevo = await leerMapeo(cliente, ENTIDAD_MAPEO.telaCategoria, idTelasCategorias);
  if (idNuevo === null) {
    return null;
  }
  const n = Number(idNuevo);
  return Number.isFinite(n) ? n : null;
}
