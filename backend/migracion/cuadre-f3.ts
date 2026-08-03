/**
 * Reporte de CUADRE de TODA la fase F3 (Producción / WIP + Inventario PT), en TRES niveles (§7 — un
 * dato tirado en silencio NO puede cerrar en verde). NO depende del código de la Pieza A: solo cuenta
 * contra las TABLAS de v2 y los CSV de v1, así que cuadra la fase completa sin importar el orden.
 *
 *  (1) CONTEOS v1 (CSV) vs v2 (BD) por entidad de producción + kardex IPT:
 *      cortes, envíos costura/estampado, recibos costura/estampado, cargos EsMa, movimientos IPT.
 *      Diferencias con NOTA (v2 ≤ v1 por filas con FK sin mapeo — al reporte de su ETL).
 *
 *  (2) Σ KARDEX v2 agregado por MODELO×ALMACÉN (ignorando el color/talla SENTINELA — se agrega sobre
 *      todas las dimensiones de color/talla) vs `IPT_Mod_Alm.Existencia` (el saldo EDITABLE del viejo,
 *      el problema que D3 erradica). Donde NO cuadra, se LISTA el descuadre con su causa probable —
 *      NUNCA se corrige en silencio (el viejo permitía editar la existencia a mano; los descuadres son
 *      del viejo, no de la migración). Resumen: # de combinaciones que cuadran / descuadran + Σ totales.
 *
 *  (3) CHECK de NO DOBLE CONTEO (la garantía de la Pieza A "recibos sin efectos"):
 *      • TODO `Movimiento` de kardex (con `MovimientoDetPt`) tiene `origenTipo = 'migracion'`.
 *      • CERO movimientos de kardex provienen de un recibo (`recibo-maquila`) ni de un cargo/otro.
 *      • Las ENTRADAS de v2 (dirección entrada, excl. sentinela no aplica) salen 1:1 de IPT_MovsDet.
 *      Si algo de esto NO se cumple, se LISTA como inconsistencia CRÍTICA.
 *
 * Se corre solo el cuadre con `npx tsx --env-file=.env migracion/cuadre-f3.ts` (no carga nada).
 */
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, DireccionMovimiento, type PrismaClient } from '../src/datos/index.js';

import { opcionesClienteEtl } from './comun/cliente-etl.js';
import { ORIGEN } from '../src/comun/origenes.js';

import { contarFilasCsv, leerCsv } from './comun/csv.js';
import { cargarMapaNumerico, ENTIDAD_MAPEO } from './comun/mapeo.js';
import { COLOR_SENTINELA, TALLA_SENTINELA } from './loaders/ipt-kardex.js';

/** Un renglón del cuadre de conteos: entidad, v1, v2, nota. */
export interface RenglonCuadreF3 {
  entidad: string;
  v1: number;
  v2: number;
  nota: string;
}

/** Resumen del cuadre de existencias (Σ kardex v2 vs IPT_Mod_Alm.Existencia del viejo). */
export interface CuadreExistencias {
  /** # de combinaciones modelo×almacén comparadas (las que el viejo tenía en IPT_Mod_Alm y se pudieron mapear). */
  comparadas: number;
  /** # que cuadran exactamente (Σ kardex v2 == Existencia v1). */
  cuadran: number;
  /** # que NO cuadran (se listan en `descuadres`). */
  descuadran: number;
  /** # de IPT_Mod_Alm que NO se pudieron mapear a v2 (modelo/almacén/empresa) — no comparables. */
  noMapeables: number;
  /** Σ de la existencia v1 (de las comparables). */
  sumaV1: number;
  /** Σ del kardex v2 (de las comparables). */
  sumaV2: number;
  /** Detalle de los descuadres (acotado en el texto). */
  descuadres: string[];
}

/** Resultado del check de no doble conteo. */
export interface CuadreNoDobleConteo {
  /** Movimientos de kardex (con detalle PT) en total. */
  totalKardex: number;
  /** Cuántos tienen origenTipo = 'migracion' (deben ser TODOS). */
  conOrigenMigracion: number;
  /** Cuántos provienen de un recibo de maquila (deben ser 0). */
  conOrigenRecibo: number;
  /** Cuántos tienen un origenTipo distinto de 'migracion' (deben ser 0). */
  conOtroOrigen: number;
  /** Movimientos de DIRECCIÓN entrada (v2 crea uno por IPT_MovsDet → cuadra con los DETALLES, no las cabeceras). */
  entradasV2: number;
  /** Detalles (IPT_MovsDet) cuyo IPT_Movs padre tiene EnSa=1 (entradas v1, a nivel detalle). */
  entradasV1Dets: number;
  /** Inconsistencias detectadas (vacío = OK). */
  inconsistencias: string[];
}

/** Cuadre F3 completo. */
export interface CuadreF3 {
  conteos: RenglonCuadreF3[];
  existencias: CuadreExistencias;
  noDobleConteo: CuadreNoDobleConteo;
}

/**
 * Cuenta DETALLES (IPT_MovsDet) cuyo IPT_Movs padre tiene un EnSa dado (1=entrada, 2=salida). Se cuenta
 * a nivel detalle —no de cabecera— porque v2 crea un `Movimiento` por cada `IPT_MovsDet` (una cabecera
 * vieja con N detalles → N movimientos en v2); comparar contra las cabeceras daría una falsa alarma.
 */
function contarDetsPorEnSa(enSa: string): number {
  try {
    const movsConEnSa = new Set<string>();
    for (const f of leerCsv('IPT_Movs.csv')) {
      if ((f.EnSa ?? '').trim() === enSa) movsConEnSa.add((f.IdIPT_Movs ?? '').trim());
    }
    let n = 0;
    for (const d of leerCsv('IPT_MovsDet.csv')) {
      if (movsConEnSa.has((d.IdIPT_Movs ?? '').trim())) n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}

/** Calcula el bloque (1): conteos v1 (CSV) vs v2 (BD). */
async function calcularConteos(cliente: PrismaClient): Promise<RenglonCuadreF3[]> {
  const v1Corte = contarFilasCsv('Corte.csv');
  const v1Entregas = contarFilasCsv('Entregas.csv');
  const v1EntregasEst = contarFilasCsv('EntregasEst.csv');
  const v1Recibos = contarFilasCsv('Recibos.csv');
  const v1RecibosEst = contarFilasCsv('RecibosEst.csv');
  const v1EsMaRecibos = contarFilasCsv('EsMa_Recibos.csv');
  const v1IptMovs = contarFilasCsv('IPT_Movs.csv');
  const v1IptMovsDet = contarFilasCsv('IPT_MovsDet.csv');

  const [v2Cortes, v2Envios, v2Recibos, v2Cargos, v2Movs, v2MovsDet, v2Entregas] =
    await Promise.all([
      cliente.etapaMovimiento.count({ where: { tipo: 'corte' } }),
      cliente.etapaMovimiento.count({ where: { tipo: 'envio_maquila' } }),
      cliente.etapaMovimiento.count({ where: { tipo: 'recibo_maquila' } }),
      cliente.esMaCargo.count(),
      cliente.movimiento.count({ where: { detallesPt: { some: {} } } }),
      cliente.movimientoDetPt.count(),
      cliente.etapaMovimiento.count({ where: { tipo: 'entrega_cliente' } }),
    ]);

  return [
    {
      entidad: 'Cortes (Corte)',
      v1: v1Corte,
      v2: v2Cortes,
      nota: 'v2 = etapa tipo "corte". v2 ≤ v1 por cortes con orden/empresa sin mapeo (Pieza A).',
    },
    {
      entidad: 'Envíos maquila (Entregas+EntregasEst)',
      v1: v1Entregas + v1EntregasEst,
      v2: v2Envios,
      nota: `costura=${String(v1Entregas)} + estampado=${String(v1EntregasEst)} (unificados en "envio_maquila" por TipoProceso, D8).`,
    },
    {
      entidad: 'Recibos maquila (Recibos+RecibosEst)',
      v1: v1Recibos + v1RecibosEst,
      v2: v2Recibos,
      nota: `costura=${String(v1Recibos)} + estampado=${String(v1RecibosEst)} (unificados en "recibo_maquila"). El recibo NO genera kardex en el ETL (no doble conteo).`,
    },
    {
      entidad: 'Cargos EsMa (EsMa_Recibos)',
      v1: v1EsMaRecibos,
      v2: v2Cargos,
      nota: 'v2 = EsMaCargo (cargo a maquilero). Solo de EsMa_Recibos; NUNCA del kardex.',
    },
    {
      entidad: 'Entregas a cliente (etapa)',
      v1: 0,
      v2: v2Entregas,
      nota: 'EntregasCliente.csv tiene 0 filas; la entrega real vieja vive en IPT_Movs tipo 5 + PedidosReales.',
    },
    {
      entidad: 'Movimientos IPT (IPT_Movs)',
      v1: v1IptMovs,
      v2: v2Movs,
      nota: 'v2 = un Movimiento por IPT_MovsDet (no por IPT_Movs): v2 ~ dets. v2 ≤ dets por FK sin mapeo.',
    },
    {
      entidad: 'Detalle IPT (IPT_MovsDet → MovimientoDetPt)',
      v1: v1IptMovsDet,
      v2: v2MovsDet,
      nota: 'v2 ≤ v1 por renglones con modelo/almacén/empresa sin mapeo o cantidad ≤ 0 (al reporte del ETL).',
    },
  ];
}

/**
 * Calcula el bloque (2): Σ kardex v2 por modelo×almacén vs `IPT_Mod_Alm.Existencia`. Mapea cada
 * IPT_Mod_Alm (modeloV1×almacenV1, con su Existencia) a los ids de v2 (modelo por código=NumMod,
 * almacén por mapeo Almacen:IPT), suma el kardex v2 de ese modelo×almacén y compara.
 */
async function calcularExistencias(cliente: PrismaClient): Promise<CuadreExistencias> {
  // Mapeos v1→v2.
  const mapaAlmacen = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.almacenIpt);
  // Código de modelo v2 → idModelo.
  const idPorCodigoModelo = new Map<string, number>();
  for (const m of await cliente.modelo.findMany({ select: { id: true, codigo: true } })) {
    idPorCodigoModelo.set(m.codigo.trim().toUpperCase(), m.id);
  }
  // IPT_Modelos: IdIPT_Modelos → NumMod (código v2).
  const numModPorIdModeloV1 = new Map<string, string>();
  try {
    for (const f of leerCsv('IPT_Modelos.csv')) {
      const id = (f.IdIPT_Modelos ?? '').trim();
      if (id !== '') numModPorIdModeloV1.set(id, (f.NumMod ?? '').trim().toUpperCase());
    }
  } catch {
    // sin CSV: no se puede cuadrar existencias (deja el resumen en 0).
  }

  // Σ kardex v2 por (idModelo, idAlmacen): entrada +, salida −. Suma directa sobre el detalle (D3).
  const sumaKardex = new Map<string, number>();
  const filas = await cliente.$queryRaw<
    { idModelo: number; idAlmacen: number; existencia: bigint | null }[]
  >`
    SELECT d."id_modelo" AS "idModelo", m."id_almacen" AS "idAlmacen",
      COALESCE(SUM(d."cantidad" * CASE t."direccion"
        WHEN 'entrada' THEN 1 WHEN 'salida' THEN -1 ELSE 0 END), 0)::bigint AS existencia
    FROM "movimiento_det_pt" d
    JOIN "movimientos" m ON m."id" = d."id_movimiento"
    JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
    GROUP BY d."id_modelo", m."id_almacen"
  `;
  for (const f of filas) {
    sumaKardex.set(`${f.idModelo}:${f.idAlmacen}`, Number(f.existencia ?? 0n));
  }

  const resumen: CuadreExistencias = {
    comparadas: 0,
    cuadran: 0,
    descuadran: 0,
    noMapeables: 0,
    sumaV1: 0,
    sumaV2: 0,
    descuadres: [],
  };

  let modAlm: ReturnType<typeof leerCsv>;
  try {
    modAlm = leerCsv('IPT_Mod_Alm.csv');
  } catch {
    return resumen;
  }

  for (const f of modAlm) {
    const idModeloV1 = (f.IdIPT_Modelos ?? '').trim();
    const idAlmacenV1 = (f.IdIPT_Almacenes ?? '').trim();
    const existenciaV1 = Number((f.Existencia ?? '0').trim() || '0');

    const numMod = numModPorIdModeloV1.get(idModeloV1);
    const idModelo = numMod === undefined ? undefined : idPorCodigoModelo.get(numMod);
    const idAlmacen = mapaAlmacen.get(idAlmacenV1);
    if (idModelo === undefined || idAlmacen === undefined) {
      resumen.noMapeables += 1;
      continue;
    }

    const v2 = sumaKardex.get(`${idModelo}:${idAlmacen}`) ?? 0;
    resumen.comparadas += 1;
    resumen.sumaV1 += Number.isFinite(existenciaV1) ? existenciaV1 : 0;
    resumen.sumaV2 += v2;
    if ((Number.isFinite(existenciaV1) ? existenciaV1 : 0) === v2) {
      resumen.cuadran += 1;
    } else {
      resumen.descuadran += 1;
      resumen.descuadres.push(
        `NumMod="${numMod ?? '?'}" almacénV1=${idAlmacenV1}: v1 Existencia=${String(existenciaV1)} ` +
          `vs Σ kardex v2=${String(v2)} (Δ=${String(v2 - existenciaV1)}) — saldo editado a mano en el viejo (D3).`,
      );
    }
  }

  return resumen;
}

/** Calcula el bloque (3): check de NO doble conteo. */
async function calcularNoDobleConteo(cliente: PrismaClient): Promise<CuadreNoDobleConteo> {
  const [totalKardex, conOrigenMigracion, conOrigenRecibo, entradasV2] = await Promise.all([
    cliente.movimiento.count({ where: { detallesPt: { some: {} } } }),
    cliente.movimiento.count({
      where: { detallesPt: { some: {} }, origenTipo: ORIGEN.migracion },
    }),
    cliente.movimiento.count({
      where: { detallesPt: { some: {} }, origenTipo: ORIGEN.reciboMaquila },
    }),
    cliente.movimiento.count({
      where: {
        detallesPt: { some: {} },
        tipoMov: { direccion: DireccionMovimiento.entrada },
      },
    }),
  ]);
  const conOtroOrigen = totalKardex - conOrigenMigracion;
  const entradasV1Dets = contarDetsPorEnSa('1');

  const inconsistencias: string[] = [];
  if (conOtroOrigen !== 0) {
    inconsistencias.push(
      `CRÍTICO: ${String(conOtroOrigen)} movimiento(s) de kardex con origenTipo ≠ 'migracion' ` +
        `(se esperaba 0: en F3 el kardex SOLO viene del ETL de IPT).`,
    );
  }
  if (conOrigenRecibo !== 0) {
    inconsistencias.push(
      `CRÍTICO: ${String(conOrigenRecibo)} movimiento(s) de kardex con origen 'recibo-maquila' ` +
        `(se esperaba 0: la Pieza A carga los recibos SIN efectos de kardex para no duplicar).`,
    );
  }
  // v2 crea un Movimiento por IPT_MovsDet, así que las ENTRADAS de v2 se comparan contra los DETALLES
  // de IPT_Movs con EnSa=1 (no las cabeceras). Salvo filas omitidas por FK sin mapeo (v2 ≤ v1), solo se
  // LISTA si v2 > v1 (sería un alta de más).
  if (entradasV2 > entradasV1Dets) {
    inconsistencias.push(
      `Entradas de kardex v2 (${String(entradasV2)}) > detalles IPT_MovsDet con EnSa=1 (${String(entradasV1Dets)}): ` +
        `revisar — no debería haber entradas de más.`,
    );
  }

  return {
    totalKardex,
    conOrigenMigracion,
    conOrigenRecibo,
    conOtroOrigen,
    entradasV2,
    entradasV1Dets,
    inconsistencias,
  };
}

/** Calcula el cuadre F3 completo (los tres bloques). */
export async function calcularCuadreF3(cliente: PrismaClient): Promise<CuadreF3> {
  const conteos = await calcularConteos(cliente);
  const existencias = await calcularExistencias(cliente);
  const noDobleConteo = await calcularNoDobleConteo(cliente);
  return { conteos, existencias, noDobleConteo };
}

/** Da formato de texto al cuadre F3 (tres bloques). */
export function formatearCuadreF3(c: CuadreF3): string {
  const p: string[] = [];
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(' CUADRE F3 (1) CONTEOS — v1 (CSV) vs v2 (Postgres)');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(`${'Entidad'.padEnd(40)}${'v1'.padStart(8)}${'v2'.padStart(8)}   Nota`);
  p.push('─'.repeat(72));
  for (const r of c.conteos) {
    const v1 = r.v1 === 0 ? '   —' : String(r.v1);
    p.push(`${r.entidad.padEnd(40)}${v1.padStart(8)}${String(r.v2).padStart(8)}   ${r.nota}`);
  }

  p.push('');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(
    ' CUADRE F3 (2) EXISTENCIAS — Σ kardex v2 (modelo×almacén) vs IPT_Mod_Alm.Existencia (v1)',
  );
  p.push('═══════════════════════════════════════════════════════════════');
  const e = c.existencias;
  p.push(`  Combinaciones modelo×almacén comparadas : ${String(e.comparadas)}`);
  p.push(`    cuadran exactamente                   : ${String(e.cuadran)}`);
  p.push(`    DESCUADRAN (listadas abajo)           : ${String(e.descuadran)}`);
  p.push(`  IPT_Mod_Alm no mapeables a v2 (excl.)    : ${String(e.noMapeables)}`);
  p.push(`  Σ existencia v1 (comparables)            : ${String(e.sumaV1)}`);
  p.push(
    `  Σ kardex v2 (comparables)                : ${String(e.sumaV2)} (Δ=${String(e.sumaV2 - e.sumaV1)})`,
  );
  p.push(
    `  Color/Talla SENTINELA: "${COLOR_SENTINELA}" / "${TALLA_SENTINELA}" (inactivos; el kardex se agrega sobre todas las dimensiones, así que el sentinela no afecta el modelo×almacén).`,
  );
  if (e.descuadres.length > 0) {
    p.push(
      '  ── Descuadres (saldo viejo editado a mano — D3 los erradica; NO se corrigen, se LISTAN) ──',
    );
    const MAX = 60;
    for (const d of e.descuadres.slice(0, MAX)) p.push(`    - ${d}`);
    if (e.descuadres.length > MAX) p.push(`    … y ${String(e.descuadres.length - MAX)} más.`);
  } else if (e.comparadas > 0) {
    p.push('  Todas las combinaciones comparables CUADRAN.');
  }

  p.push('');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(' CUADRE F3 (3) NO DOBLE CONTEO — el kardex SOLO viene del ETL de IPT');
  p.push('═══════════════════════════════════════════════════════════════');
  const n = c.noDobleConteo;
  p.push(`  Movimientos de kardex (con detalle PT)   : ${String(n.totalKardex)}`);
  p.push(`    con origenTipo 'migracion' (deben ser TODOS) : ${String(n.conOrigenMigracion)}`);
  p.push(`    con origen 'recibo-maquila' (deben ser 0)    : ${String(n.conOrigenRecibo)}`);
  p.push(`    con OTRO origen (deben ser 0)                : ${String(n.conOtroOrigen)}`);
  p.push(
    `  Entradas kardex v2=${String(n.entradasV2)} vs detalles IPT_MovsDet EnSa=1 v1=${String(n.entradasV1Dets)} (v2 ≤ v1 por FK sin mapeo)`,
  );
  if (n.inconsistencias.length === 0) {
    p.push('  ✔ Sin doble conteo: todo el kardex proviene de la migración de IPT.');
  } else {
    for (const i of n.inconsistencias) p.push(`  ✖ ${i}`);
  }

  return p.join('\n');
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url, opcionesClienteEtl());
  try {
    const cuadre = await calcularCuadreF3(cliente);
    console.log(formatearCuadreF3(cuadre));
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
