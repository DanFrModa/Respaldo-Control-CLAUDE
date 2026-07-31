/**
 * Loader de BORDADOS (F1-E6, R2). `Bordados.csv` (2964) → catálogo `Bordado`
 * (nombre, descripcion, puntadas, precio, tipo). Carga VÍA el dominio (A1): `crearBordado`.
 *
 * SOLO el catálogo — **NO sube fotos** (las fotos masivas son E7; la columna `Foto` se
 * ignora aquí). `Bordado.nombre` es @unique → se desambiguan los duplicados con sufijo
 * `(2)`, `(3)`… y se REPORTAN (ADR-0009, riesgo menor anotado para E6).
 *
 * `BorEst` → tipo (BORDADO/ESTAMPADO); `Precio` viejo (`$2.50`) → number; `Puntadas` → int.
 * Idempotente: el nombre desambiguado se mapea por `IdBordados`, así re-ejecutar reusa el
 * mismo nombre (no genera `(2)` nuevos). Persiste `IdBordados → idBordado`.
 */
import { crearBordado } from '../../src/dominio/catalogos/bordados.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import { mapearTipoBordado } from '../comun/mapeos-enum.js';
import { ENTIDAD_MAPEO, guardarMapeo, leerMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import { prescanUso, type PrescanUso } from '../comun/prescan-uso.js';
import type { Reporte } from '../comun/reporte.js';
import { crearConNombreUnico, intentarCrear, LIMITES, truncarYReportar } from '../comun/saneo.js';
import { parsearDinero, parsearEntero, parsearTexto } from '../comun/valores.js';
import { resolverVentana } from '../comun/ventana.js';
import type { ResultadoLoader } from './clientes.js';

/** Desenlace de procesar una fila (para agregar conteos tras los lotes). */
type Desenlace = 'creado' | 'existente' | 'omitido' | 'omitidoValidacion' | 'fueraVentana';

async function idPorNombre(cliente: ClienteMapeo, nombre: string): Promise<number | null> {
  const fila = await cliente.bordado.findFirst({
    where: { nombre: { equals: nombre, mode: 'insensitive' } },
    select: { id: true },
  });
  return fila?.id ?? null;
}

/** Devuelve un nombre libre (case-insensitive) agregando sufijo `(n)` si hace falta. */
async function nombreLibre(cliente: ClienteMapeo, base: string): Promise<string> {
  if ((await idPorNombre(cliente, base)) === null) {
    return base;
  }
  for (let n = 2; n < 1000; n += 1) {
    const candidato = `${base} (${String(n)})`;
    if ((await idPorNombre(cliente, candidato)) === null) {
      return candidato;
    }
  }
  // Fallback extremo: nombre con timestamp (no debería pasar con 2964 filas).
  return `${base} (${String(Date.now())})`;
}

export async function cargarBordados(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  prescan?: PrescanUso | null,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const filas = leerCsv('Bordados.csv');
  // Prescan de USO: con ventana activa solo migran los bordados del BOM de modelos usados.
  const pre = prescan === undefined ? prescanUso(resolverVentana()) : prescan;

  // Filas INDEPENDIENTES → carga concurrente acotada (acelera carga Y re-chequeo idempotente).
  const resultados = await enLotes(
    filas,
    (fila): Promise<Desenlace> => procesarBordado(sesion, bd, cliente, reporte, pre, fila),
    CONCURRENCIA_ETL,
  );

  // Agregación de conteos tras los lotes (un fallo de `enLotes` se cuenta como omitidoValidacion).
  let creados = 0;
  let existentes = 0;
  let omitidos = 0;
  let omitidosValidacion = 0;
  let fueraVentana = 0;
  for (const r of resultados) {
    const d = r.ok ? r.valor : 'omitidoValidacion';
    if (d === 'creado') creados += 1;
    else if (d === 'existente') existentes += 1;
    else if (d === 'omitido') omitidos += 1;
    else if (d === 'fueraVentana') fueraVentana += 1;
    else omitidosValidacion += 1;
  }
  if (fueraVentana > 0) {
    reporte.nota(
      `Bordados fuera de ventana (sin uso en BOM de modelos usados): ${String(fueraVentana)} NO migrados.`,
    );
  }
  return { creados, existentes, omitidos, omitidosValidacion, fueraVentana };
}

/** Procesa UNA fila de Bordados (idempotente, tolerante, con desambiguación de nombre). */
async function procesarBordado(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: ClienteMapeo,
  reporte: Reporte,
  pre: PrescanUso | null,
  fila: Record<string, string>,
): Promise<Desenlace> {
  const idViejo = fila.IdBordados;
  const nombreCrudo = parsearTexto(fila.Nombre);
  if (nombreCrudo === null) {
    reporte.agregar('Bordados con nombre vacío (omitidos)', `Id=${idViejo ?? '?'}`);
    return 'omitido';
  }
  // Ventana por USO: bordado sin uso → fuera, con su propio bucket (muestra en el reporte).
  if (pre !== null && (idViejo === undefined || !pre.bordadosId.has(idViejo.trim()))) {
    reporte.agregarMuestra(
      'Bordados FUERA de ventana (sin uso — NO migrados)',
      `"${nombreCrudo}" (IdBordados=${idViejo ?? '?'})`,
    );
    return 'fueraVentana';
  }
  // Trunca el nombre al máximo del esquema (deja sitio para el sufijo de desambiguación).
  const nombreOriginal =
    truncarYReportar(reporte, 'Bordado', idViejo, 'nombre', nombreCrudo, LIMITES.bordado.nombre) ??
    nombreCrudo;

  // Idempotencia: si ya migramos ESTE IdBordados, reusar su id (no generar (2) nuevos).
  if (idViejo !== undefined) {
    const yaMapeado = await leerMapeo(cliente, ENTIDAD_MAPEO.bordado, idViejo);
    if (yaMapeado !== null) {
      return 'existente';
    }
  }

  const tipo = mapearTipoBordado(fila.BorEst);
  const descripcion =
    truncarYReportar(
      reporte,
      'Bordado',
      idViejo,
      'descripcion',
      parsearTexto(fila.Descripcion),
      LIMITES.bordado.descripcion,
    ) ?? undefined;
  const puntadasRaw = parsearEntero(fila.Puntadas);
  const puntadas = puntadasRaw === null ? undefined : Math.max(0, puntadasRaw);
  const precioRaw = parsearDinero(fila.Precio);
  const precio = precioRaw === null ? undefined : Math.max(0, precioRaw);

  // Crear con nombre @unique desambiguado, tolerante a carreras (otra tarea pudo tomar el
  // mismo nombre): `crearConNombreUnico` reintenta recomputando un nombre libre.
  const creado = await intentarCrear(reporte, 'Bordado', idViejo, () =>
    crearConNombreUnico(
      nombreOriginal,
      (base) => nombreLibre(cliente, base),
      (nombre) =>
        crearBordado(
          sesion,
          {
            nombre,
            tipo,
            ...(descripcion === undefined ? {} : { descripcion }),
            ...(puntadas === undefined ? {} : { puntadas }),
            ...(precio === undefined ? {} : { precio }),
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
      'Bordados con nombre duplicado (desambiguados con sufijo)',
      `"${nombreOriginal}" → "${creado.nombre}" (IdBordados=${idViejo ?? '?'})`,
    );
  }

  if (idViejo !== undefined) {
    await guardarMapeo(cliente, ENTIDAD_MAPEO.bordado, idViejo, creado.id, {
      nombre: creado.nombre,
      ...(creado.nombre !== nombreOriginal ? { nombreOriginal } : {}),
    });
  }
  return 'creado';
}
