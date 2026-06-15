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
import { mapearTipoComponente } from '../comun/mapeos-enum.js';
import { ENTIDAD_MAPEO, guardarMapeo, leerMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import {
  normalizarParaDedup,
  parsearBandera,
  parsearDinero,
  parsearTexto,
} from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

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

  let telasSinTelaDis = 0;
  let creados = 0;
  let existentes = 0;
  let omitidos = 0;

  // ── 1) Telas (base) ──────────────────────────────────────────────────────────
  for (const fila of leerCsv('Telas.csv')) {
    const idViejo = fila.IdTelas;
    const nombreOriginal = parsearTexto(fila.Nombre);
    if (nombreOriginal === null) {
      omitidos += 1;
      reporte.agregar('Telas con nombre vacío (omitidas)', `IdTelas=${idViejo ?? '?'}`);
      continue;
    }

    // Idempotencia por IdTelas.
    if (idViejo !== undefined) {
      const ya = await leerMapeo(cliente, ENTIDAD_MAPEO.telaPorIdTelas, idViejo);
      if (ya !== null) {
        existentes += 1;
        const norm = normalizarParaDedup(nombreOriginal);
        if (disPorNombre.has(norm)) {
          disUsados.add(norm);
        }
        continue;
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
      telasSinTelaDis += 1;
    }

    const idCategoria = await resolverCategoria(cliente, fila.IdTelasCategorias);
    const tipoComponente = mapearTipoComponente(fila.Texto1, fila.Texto2);
    const descripcion = parsearTexto(fila.Descripcion) ?? undefined;
    const precioSugerido = parsearDinero(fila.PrecioSugerido);
    const favorito = parsearBandera(fila.Favorito);
    const paraProduccion = disMatch ? parsearBandera(disMatch.ParaProduccion) : true;

    const nombre = await nombreTelaLibre(cliente, nombreOriginal);
    if (nombre !== nombreOriginal) {
      reporte.agregar(
        'Telas con nombre duplicado (desambiguadas con sufijo)',
        `"${nombreOriginal}" → "${nombre}" (IdTelas=${idViejo ?? '?'})`,
      );
    }

    const creado = await crearTela(
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
    );
    creados += 1;

    if (!parsearBandera(fila.Activa)) {
      await actualizarTela(sesion, { id: creado.id, activo: false }, bd);
    }

    if (idViejo !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.telaPorIdTelas, idViejo, creado.id, {
        nombre,
        ...(nombre !== nombreOriginal ? { nombreOriginal } : {}),
      });
    }
    // Si hubo match con un TelaDis, ese IdTelasDis apunta a la MISMA Tela nueva.
    if (disMatch?.IdTelasDis !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.telaPorIdTelasDis, disMatch.IdTelasDis, creado.id, {
        nombre,
        via: 'match-Telas',
      });
    }
  }

  // ── 2) TelasDis SIN match en Telas → Tela propia (no se pierde) ──────────────
  let disSinTela = 0;
  for (const d of telasDis) {
    const nombreOriginal = parsearTexto(d.TelaDis);
    if (nombreOriginal === null) {
      continue;
    }
    const norm = normalizarParaDedup(nombreOriginal);
    if (disUsados.has(norm)) {
      continue; // ya unificada con una Tela
    }
    // Idempotencia por IdTelasDis.
    if (d.IdTelasDis !== undefined) {
      const ya = await leerMapeo(cliente, ENTIDAD_MAPEO.telaPorIdTelasDis, d.IdTelasDis);
      if (ya !== null) {
        existentes += 1;
        continue;
      }
    }
    disSinTela += 1;
    reporte.agregar(
      'TelasDis SIN Tela base (creadas como Tela propia)',
      `"${nombreOriginal}" (IdTelasDis=${d.IdTelasDis ?? '?'}, proveedor="${parsearTexto(d.Proveedor) ?? ''}")`,
    );

    const descripcion = parsearTexto(d.Descripcion) ?? undefined;
    const precio = parsearDinero(d.Precio);
    const nombre = await nombreTelaLibre(cliente, nombreOriginal);
    const creado = await crearTela(
      sesion,
      {
        nombre,
        paraProduccion: parsearBandera(d.ParaProduccion),
        ...(descripcion === undefined ? {} : { descripcion }),
        ...(precio === null ? {} : { precioSugerido: Math.max(0, precio) }),
        colores: [],
      },
      bd,
    );
    creados += 1;
    if (d.IdTelasDis !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.telaPorIdTelasDis, d.IdTelasDis, creado.id, {
        nombre,
        via: 'TelaDis-sin-Tela',
      });
    }
  }

  // Conteos agregados al reporte (decisión de Gabriel/Daniel sobre la llave de unificación).
  reporte.nota(
    `Unificación de telas: ${String(telasSinTelaDis)} Telas sin TelaDis (normal), ` +
      `${String(disSinTela)} TelasDis sin Tela base (creadas aparte). Llave de join = nombre normalizado.`,
  );

  return { creados, existentes, omitidos };
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
