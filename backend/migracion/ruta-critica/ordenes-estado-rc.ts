/**
 * Loader del ESTADO RC LEGADO de las órdenes (F5-E7, Pieza B).
 *
 * `Ordenes.csv` → campos RC snapshot de la `Orden` v2: `idTipoArticuloRC` (IdCP_Articulos),
 * `idRcAplicaciones` (IdRC_Aplicaciones), `idRcTipoTelas` (IdRC_TipoTelas), `fechaInicioRC`,
 * `fechaEntregaRC`, `fechaProg`, `enRiesgo` (EnRiesgo), `siRC` (SI_RC), `rcViva` (RC_Viva).
 *
 * ⚠️ El ETL de órdenes de F2-E5 YA migró estos escalares al cargar `Ordenes.csv` (mismas columnas). Este
 * loader los RE-CONFIRMA de forma IDEMPOTENTE vía `fijarEstadoRcOrdenMigrado`, que actualiza SOLO si
 * algún valor difiere (re-correr no toca nada cuando ya cuadran). Se incluye en F5-E7 porque es donde
 * conceptualmente vive el estado RC de las órdenes, y para que el cierre de fase quede auto-contenido.
 *
 * Resolución: `IdOrdenes → Orden.id` por el mapeo `ENTIDAD_MAPEO.orden` (F2-E5). Se procesan SOLO las
 * órdenes que traen ALGÚN campo RC en el CSV (la inmensa mayoría no tiene RC; tocarlas sería gasto sin
 * efecto). Las órdenes SIN mapeo (fuera de la ventana temporal u origen inválido) se cuentan en un
 * BUCKET AGREGADO (conteo + muestra) — con ventana activa pueden ser MILES. Carga concurrente acotada
 * por lotes (nunca fila por fila contra la BD remota).
 */
import { fijarEstadoRcOrdenMigrado } from '../../src/dominio/ruta-critica/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import { cargarMapaNumerico, ENTIDAD_MAPEO } from '../comun/mapeo.js';
import { MuestraAgregada } from '../comun/muestra.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearBandera, parsearEntero, parsearFecha } from '../comun/valores.js';

/** Resultado del loader del estado RC de órdenes. */
export interface ResultadoOrdenesEstadoRc {
  /** Órdenes del CSV con ALGÚN campo RC (candidatas). */
  candidatas: number;
  /** Órdenes actualizadas en ESTA corrida (valor difería de lo ya migrado por F2). */
  actualizadas: number;
  /** Órdenes ya al día (idempotencia: el estado RC ya cuadraba). */
  alDia: number;
  /** Órdenes con algún campo RC pero SIN mapeo a v2 (no migradas) → omitidas y listadas. */
  sinMapeo: number;
}

/** Bandera nullable del viejo: null si la celda viene vacía (distingue "no dato" de "falso"). */
function banderaNullable(v: string | undefined): boolean | null {
  const t = (v ?? '').trim();
  if (t === '') return null;
  return parsearBandera(v);
}

/** ¿La fila del CSV trae ALGÚN campo RC (para no tocar las miles de órdenes sin RC)? */
function tieneAlgunCampoRc(f: Record<string, string>): boolean {
  return (
    (f.IdCP_Articulos ?? '').trim() !== '' ||
    (f.IdRC_Aplicaciones ?? '').trim() !== '' ||
    (f.IdRC_TipoTelas ?? '').trim() !== '' ||
    (f.FechaInicioRC ?? '').trim() !== '' ||
    (f.FechaEntregaRC ?? '').trim() !== '' ||
    (f.FechaProg ?? '').trim() !== '' ||
    (f.EnRiesgo ?? '').trim() !== '' ||
    (f.SI_RC ?? '').trim() !== '' ||
    (f.RC_Viva ?? '').trim() !== ''
  );
}

type Desenlace = 'actualizada' | 'alDia' | 'sinMapeo';

export async function cargarOrdenesEstadoRc(
  sesion: SesionUsuario,
  cliente: PrismaClient,
  reporte: Reporte,
): Promise<ResultadoOrdenesEstadoRc> {
  const bd: ContextoBd = { cliente };
  const mapaOrden = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.orden);

  const candidatas = leerCsv('Ordenes.csv').filter(tieneAlgunCampoRc);

  // Bucket agregado (conteo + muestra): con la ventana temporal activa pueden ser MILES de órdenes.
  const ordenesNoMigradas = new MuestraAgregada();

  const resultados = await enLotes(
    candidatas,
    (f): Promise<Desenlace> =>
      conReintentoTransitorio(() =>
        procesarFila(sesion, bd, reporte, mapaOrden, ordenesNoMigradas, f),
      ),
    CONCURRENCIA_ETL,
  );

  ordenesNoMigradas.volcar(
    reporte,
    'Estado RC de orden no migrada (fuera de ventana u origen inválido) — OMITIDO (agregado)',
  );

  const r: ResultadoOrdenesEstadoRc = {
    candidatas: candidatas.length,
    actualizadas: 0,
    alDia: 0,
    sinMapeo: 0,
  };
  for (const res of resultados) {
    const d = res.ok ? res.valor : 'sinMapeo';
    if (d === 'actualizada') r.actualizadas += 1;
    else if (d === 'alDia') r.alDia += 1;
    else r.sinMapeo += 1;
  }
  return r;
}

/** Procesa UNA orden candidata (idempotente, tolerante). */
async function procesarFila(
  sesion: SesionUsuario,
  bd: ContextoBd,
  reporte: Reporte,
  mapaOrden: Map<string, number>,
  ordenesNoMigradas: MuestraAgregada,
  f: Record<string, string>,
): Promise<Desenlace> {
  const idOrdenViejo = (f.IdOrdenes ?? '').trim();
  const idOrden = mapaOrden.get(idOrdenViejo);
  if (idOrden === undefined) {
    ordenesNoMigradas.agregar(`IdOrdenes=${idOrdenViejo}`);
    return 'sinMapeo';
  }

  const actualizo = await intentarCrear(reporte, 'Orden (estado RC)', idOrdenViejo, () =>
    fijarEstadoRcOrdenMigrado(
      sesion,
      idOrden,
      {
        idTipoArticuloRC: parsearEntero(f.IdCP_Articulos),
        idRcAplicaciones: parsearEntero(f.IdRC_Aplicaciones),
        idRcTipoTelas: parsearEntero(f.IdRC_TipoTelas),
        fechaInicioRC: parsearFecha(f.FechaInicioRC),
        fechaEntregaRC: parsearFecha(f.FechaEntregaRC),
        fechaProg: parsearFecha(f.FechaProg),
        enRiesgo: banderaNullable(f.EnRiesgo),
        siRC: banderaNullable(f.SI_RC),
        rcViva: banderaNullable(f.RC_Viva),
      },
      bd,
    ),
  );
  if (actualizo === null) return 'sinMapeo'; // error ya reportado (raro); cuenta como no aplicada
  return actualizo ? 'actualizada' : 'alDia';
}
