/**
 * Loader de la RUTA VIVA HISTÓRICA por orden (F5-E7, Pieza B).
 *
 * `RC.csv` (181 renglones, 8 órdenes distintas) → `RutaOrden` (un renglón por proceso×orden), con sus
 * `RutaOrdenChecklist` de `RC_IP3.csv`/`RC_IP4.csv` (los checks de IP capturados). Carga VÍA el modo
 * migración del dominio (`crearRutaOrdenMigrada`, A1): preserva las fechas y la CAPTURA originales del
 * viejo (`FechaEst`/`FechaReal`/`IdUsuario`/`FechaUsuarioRC`) sin re-sellar ni recalcular el CPM.
 *
 * Resolución de FKs:
 *  • `RC.IdOrdenes → Orden.id` por el mapeo `ENTIDAD_MAPEO.orden` que dejó el ETL de órdenes (F2-E5).
 *    Si la orden no está mapeada (fuera de la ventana temporal u origen inválido), TODA la ruta de
 *    esa orden se OMITE y se reporta en un BUCKET AGREGADO (conteo total + muestra) — con la ventana
 *    activa pueden ser MILES de órdenes y listarlas una a una inundaría el reporte.
 *  • `RC.IdCP_Procesos → ProcesoDef.id` por el puente de posición/codigo de `comun.ts` (E1).
 *  • `RC.IdUsuario → capturadoPorId`: los 137 usuarios del viejo NO están migrados a v2; se conserva el
 *    id legacy como texto `legacy:<id>` (sin FK, igual que `OrdenComentario.idUsuario` de F2). Si una
 *    corrida futura migra usuarios, se podrá re-resolver; hoy alimenta el KPI D11 "quién capturó".
 *
 * Idempotencia: `crearRutaOrdenMigrada` BORRA la ruta histórica de la orden y la RECREA con el set
 * completo del CSV → re-ejecutar deja los MISMOS renglones (no duplica). Se procesa POR ORDEN (una tx
 * por orden), nunca renglón por renglón.
 */
import {
  crearRutaOrdenMigrada,
  type ItemChecklistMigrado,
  type RenglonRutaMigrada,
} from '../../src/dominio/ruta-critica/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { cargarMapaNumerico, ENTIDAD_MAPEO } from '../comun/mapeo.js';
import { MuestraAgregada } from '../comun/muestra.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearEntero, parsearFecha } from '../comun/valores.js';

import { construirPuenteProcesos, type ProcesoV2 } from './comun.js';

/** Resultado del loader de rutas históricas. */
export interface ResultadoRutaOrden {
  /** Órdenes con ruta migrada (recreada). */
  ordenes: number;
  /** Renglones de ruta creados (Σ sobre las órdenes). */
  renglones: number;
  /** Ítems de checklist creados. */
  itemsChecklist: number;
  /** Renglones del CSV omitidos (orden o proceso sin mapeo). */
  omitidos: number;
  /** Órdenes del CSV sin mapeo (no migradas) — su ruta entera se omite. */
  ordenesSinMapeo: number;
}

/** Columnas booleanas de `RC_IP3` (checks de IP, en orden) → descripción del ítem de checklist. */
const COLUMNAS_IP3: { col: string; descripcion: string }[] = [
  { col: 'Moldes', descripcion: 'Moldes' },
  { col: 'MuestraFisica', descripcion: 'Muestra física' },
  { col: 'FichaTecnica', descripcion: 'Ficha técnica' },
  { col: 'Digitalizacion', descripcion: 'Digitalización' },
  { col: 'Graduacion', descripcion: 'Graduación' },
  { col: 'MandarModelo', descripcion: 'Mandar modelo' },
];

/** Columnas booleanas de `RC_IP4` (checks de corte, en orden) → descripción del ítem de checklist. */
const COLUMNAS_IP4: { col: string; descripcion: string }[] = [
  { col: 'CorteIP4', descripcion: 'Corte' },
  { col: 'AsignadaIP4', descripcion: 'Asignada' },
  { col: 'AprobadaIP4', descripcion: 'Aprobada' },
];

/** `"1"`/`"-1"`/… → true (mismo criterio que `parsearBandera`, pero local para no importar de más). */
export function flag(v: string | undefined): boolean {
  const t = (v ?? '').trim();
  if (t === '') return false;
  const n = Number(t);
  return Number.isFinite(n) ? n !== 0 : false;
}

/** Construye los ítems de checklist de un renglón de RC desde sus filas de IP3/IP4 (si las hay). */
export function checklistDe(
  ip3: Record<string, string> | undefined,
  ip4: Record<string, string> | undefined,
): ItemChecklistMigrado[] {
  const items: ItemChecklistMigrado[] = [];
  let orden = 0;
  if (ip3 !== undefined) {
    for (const { col, descripcion } of COLUMNAS_IP3) {
      items.push({ descripcion, orden, hecho: flag(ip3[col]) });
      orden += 1;
    }
  }
  if (ip4 !== undefined) {
    for (const { col, descripcion } of COLUMNAS_IP4) {
      items.push({ descripcion, orden, hecho: flag(ip4[col]) });
      orden += 1;
    }
  }
  return items;
}

/**
 * Carga las rutas históricas de las órdenes. Agrupa `RC.csv` por `IdOrdenes`, resuelve cada orden y
 * cada proceso, anexa el checklist de IP3/IP4 (que va por `IdRC`), y recrea la ruta por orden.
 */
export async function cargarRutasOrden(
  sesion: SesionUsuario,
  cliente: PrismaClient,
  reporte: Reporte,
): Promise<ResultadoRutaOrden> {
  const bd: ContextoBd = { cliente };
  const resultado: ResultadoRutaOrden = {
    ordenes: 0,
    renglones: 0,
    itemsChecklist: 0,
    omitidos: 0,
    ordenesSinMapeo: 0,
  };

  const mapaOrden = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.orden);
  const { porIdViejo: procesoPorIdViejo } = await construirPuenteProcesos(cliente);

  // Checklist de IP por IdRC (un IP3/IP4 por renglón de RC, a lo sumo).
  const ip3PorIdRc = new Map<string, Record<string, string>>();
  for (const f of leerCsv('RC_IP3.csv')) {
    const idRc = (f.IdRC ?? '').trim();
    if (idRc !== '') ip3PorIdRc.set(idRc, f);
  }
  const ip4PorIdRc = new Map<string, Record<string, string>>();
  for (const f of leerCsv('RC_IP4.csv')) {
    const idRc = (f.IdRC ?? '').trim();
    if (idRc !== '') ip4PorIdRc.set(idRc, f);
  }

  // Agrupa RC por IdOrdenes, conservando el orden de captura (NumProcesoRC).
  const porOrden = new Map<string, Record<string, string>[]>();
  for (const f of leerCsv('RC.csv')) {
    const idOrdenViejo = (f.IdOrdenes ?? '').trim();
    if (idOrdenViejo === '') continue;
    const lista = porOrden.get(idOrdenViejo) ?? [];
    lista.push(f);
    porOrden.set(idOrdenViejo, lista);
  }

  // Bucket agregado (conteo + muestra): con la ventana temporal activa pueden ser MILES de órdenes.
  const ordenesNoMigradas = new MuestraAgregada();

  for (const [idOrdenViejo, filas] of porOrden) {
    const idOrden = mapaOrden.get(idOrdenViejo);
    if (idOrden === undefined) {
      resultado.ordenesSinMapeo += 1;
      resultado.omitidos += filas.length;
      ordenesNoMigradas.agregar(`IdOrdenes=${idOrdenViejo} renglones=${String(filas.length)}`);
      continue;
    }

    // Traduce los renglones a `RenglonRutaMigrada`, en orden por NumProcesoRC.
    const ordenadas = [...filas].sort(
      (a, b) => (parsearEntero(a.NumProcesoRC) ?? 0) - (parsearEntero(b.NumProcesoRC) ?? 0),
    );
    const renglones: RenglonRutaMigrada[] = [];
    const procesosVistos = new Set<number>();
    for (const f of ordenadas) {
      const idProcViejo = (f.IdCP_Procesos ?? '').trim();
      const v2: ProcesoV2 | undefined = procesoPorIdViejo.get(idProcViejo);
      if (v2 === undefined) {
        resultado.omitidos += 1;
        reporte.agregar(
          'Renglón de ruta histórica con proceso sin mapeo (OMITIDO)',
          `IdRC=${(f.IdRC ?? '').trim()} IdOrdenes=${idOrdenViejo} IdCP_Procesos=${idProcViejo}`,
        );
        continue;
      }
      // El @@unique(idOrden,idProcesoDef) prohíbe el mismo proceso 2 veces en una orden: se omite el
      // duplicado (defensa; el viejo no debería tenerlo) y se lista.
      if (procesosVistos.has(v2.id)) {
        resultado.omitidos += 1;
        reporte.agregar(
          'Renglón de ruta histórica con proceso DUPLICADO en la orden (OMITIDO)',
          `IdRC=${(f.IdRC ?? '').trim()} IdOrdenes=${idOrdenViejo} IdCP_Procesos=${idProcViejo}`,
        );
        continue;
      }
      procesosVistos.add(v2.id);

      const idRc = (f.IdRC ?? '').trim();
      const idUsuario = parsearEntero(f.IdUsuario);
      // capturadoPorId: conserva el id LEGACY del viejo (sin FK), null si 0/vacío (no capturado).
      const capturadoPorId =
        idUsuario !== null && idUsuario !== 0 ? `legacy:${String(idUsuario)}` : null;

      renglones.push({
        idProcesoDef: v2.id,
        secuencia: parsearEntero(f.NumProcesoRC) ?? renglones.length,
        critico: v2.critico,
        ultimoProceso: v2.ultimoProceso,
        esResurtido: v2.esResurtido,
        condicionAplicabilidad: v2.condicionAplicabilidad,
        duracionDias: parsearEntero(f.TiempoRC) ?? 0,
        acumuladoDias: parsearEntero(f.Acumulado),
        fechaEst: parsearFecha(f.FechaEst),
        fechaReal: parsearFecha(f.FechaReal),
        capturadoPorId,
        capturadoEn: parsearFecha(f.FechaUsuarioRC),
        checklist: checklistDe(ip3PorIdRc.get(idRc), ip4PorIdRc.get(idRc)),
      });
    }

    if (renglones.length === 0) {
      continue;
    }

    const creada = await intentarCrear(reporte, 'RutaOrden', idOrdenViejo, () =>
      crearRutaOrdenMigrada(sesion, idOrden, renglones, bd),
    );
    if (creada === null) {
      continue;
    }
    resultado.ordenes += 1;
    resultado.renglones += creada.renglones;
    resultado.itemsChecklist += creada.itemsChecklist;
  }

  ordenesNoMigradas.volcar(
    reporte,
    'Ruta histórica con orden no migrada (fuera de ventana u origen inválido) — OMITIDA (agregado)',
  );

  return resultado;
}
