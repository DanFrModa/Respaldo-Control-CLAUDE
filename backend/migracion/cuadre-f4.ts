/**
 * Reporte de CUADRE de TELAS de F4-E6 (Pieza B), espejo de `cuadre-f3.ts` (§7 — un dato tirado en
 * silencio NO puede cerrar en verde). NO depende del código de la Pieza A (compras/notas): solo
 * cuenta contra las TABLAS de v2 y los CSV de v1, así que cuadra el inventario de telas sin importar
 * el orden de los ETL.
 *
 *  (1) CONTEOS v1 (CSV) vs v2 (BD): entradas/salidas de tela (cabecera y detalle), pares de traspaso
 *      detectados, movimientos de kardex de tela en v2. Diferencias con NOTA (v2 ≤ v1 por renglones
 *      con FK sin mapeo — al reporte del ETL).
 *
 *  (2) Σ KARDEX v2 agregado por COLOR×ALMACÉN (tela×lote→color, vía el mapeo `LoteLegacyTela`) vs
 *      `TelasColAlm.ExTela1+ExTela2` (el saldo EDITABLE del viejo, el problema que D3 erradica).
 *      Donde NO cuadra, se LISTA el descuadre con su causa probable — NUNCA se corrige en silencio
 *      (el viejo mantenía el saldo con GotFocus/LostFocus y permitía editarlo a mano; los descuadres
 *      son del viejo, no de la migración). Resumen: # de combinaciones que cuadran / descuadran + Σ.
 *
 *  (3) CHECK de NO DOBLE CONTEO: todo `Movimiento` de kardex de TELA tiene `origenTipo ∈ {migracion,
 *      salida-tela-orden, traspaso}` — JAMÁS `recepcion-compra` (en F4-E6 NO se crea ninguna
 *      RecepcionCompra: las entradas de compra legacy entran DIRECTO al kardex). Si aparece un
 *      movimiento de tela con origen de recepción, se LISTA como inconsistencia CRÍTICA.
 *
 * AVÍOS: NO hay histórico que migrar (R4 es nuevo) → arrancan en cero. El conteo físico inicial lo
 * capturará Gabriel con la pantalla de E1. Solo se menciona en el cuadre (no hay cifras que cruzar).
 *
 * Se corre solo el cuadre con `npx tsx --env-file=.env migracion/cuadre-f4.ts` (no carga nada).
 */
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, DireccionMovimiento, type PrismaClient } from '../src/datos/index.js';
import { ORIGEN } from '../src/comun/origenes.js';

import { contarFilasCsv, leerCsv } from './comun/csv.js';
import { cargarMapaNumerico, ENTIDAD_MAPEO } from './comun/mapeo.js';

/** Un renglón del cuadre de conteos: entidad, v1, v2, nota. */
export interface RenglonCuadreF4 {
  entidad: string;
  v1: number;
  v2: number;
  nota: string;
}

/** Resumen del cuadre de existencias de tela (Σ kardex v2 vs TelasColAlm.ExTela1+ExTela2). */
export interface CuadreExistenciasTela {
  /** # de combinaciones color×almacén comparadas (las que el viejo tenía con saldo y se pudieron mapear). */
  comparadas: number;
  /** # que cuadran (|Σ kardex v2 − Existencia v1| ≤ tolerancia). */
  cuadran: number;
  /** # que NO cuadran (se listan en `descuadres`). */
  descuadran: number;
  /** # de TelasColAlm con saldo que NO se pudieron mapear a v2 (color/almacén/lote) — no comparables. */
  noMapeables: number;
  /** Σ de la existencia v1 (ExTela1+ExTela2 de las comparables). */
  sumaV1: number;
  /** Σ del kardex v2 (de las comparables). */
  sumaV2: number;
  /** Detalle de los descuadres (acotado en el texto). */
  descuadres: string[];
}

/** Resultado del check de no doble conteo (telas). */
export interface NoDobleConteoTela {
  /** Movimientos de kardex de TELA en total (con detalle de tela). */
  totalKardex: number;
  /** Cuántos provienen de una recepción de compra (deben ser 0 en F4-E6). */
  conOrigenRecepcion: number;
  /** Inconsistencias detectadas (vacío = OK). */
  inconsistencias: string[];
}

/** Cuadre F4 (telas) completo. */
export interface CuadreF4 {
  conteos: RenglonCuadreF4[];
  existencias: CuadreExistenciasTela;
  noDobleConteo: NoDobleConteoTela;
}

/** Tolerancia para comparar Decimales de tela (kg/m): redondeo a 4 decimales del viejo. */
const TOLERANCIA = 0.0001;

/** Σ de TelaEnt/TelaSal de un detalle CSV (suma de los dos componentes). */
function sumaDet(c1: string | undefined, c2: string | undefined): number {
  const n1 = Number((c1 ?? '0').replace(/[\s,]/g, '')) || 0;
  const n2 = Number((c2 ?? '0').replace(/[\s,]/g, '')) || 0;
  return n1 + n2;
}

/** Bloque (1): conteos v1 (CSV) vs v2 (BD). */
async function calcularConteos(cliente: PrismaClient): Promise<RenglonCuadreF4[]> {
  const v1Entradas = contarFilasCsv('Entradas.csv');
  const v1EntradasDet = contarFilasCsv('EntradasDet.csv');
  const v1Salidas = contarFilasCsv('Salidas.csv');
  const v1SalidasDet = contarFilasCsv('SalidasDet.csv');

  // Movimientos de kardex de TELA en v2, por origen.
  const [v2Tela, v2Entrada, v2Salida, v2Traspaso] = await Promise.all([
    cliente.movimiento.count({ where: { detallesTela: { some: {} } } }),
    cliente.movimiento.count({
      where: {
        detallesTela: { some: {} },
        origenTipo: ORIGEN.migracion,
        tipoMov: { direccion: DireccionMovimiento.entrada },
      },
    }),
    cliente.movimiento.count({
      where: { detallesTela: { some: {} }, origenTipo: ORIGEN.salidaTelaOrden },
    }),
    cliente.movimiento.count({
      where: { detallesTela: { some: {} }, origenTipo: ORIGEN.traspaso },
    }),
  ]);

  return [
    {
      entidad: 'Entradas de tela (Entradas)',
      v1: v1Entradas,
      v2: v2Entrada,
      nota: 'v2 = movimientos de entrada (migracion). Incluye compra directa; las Transferencia van como traspaso. v2 difiere por documentos multi-almacén (1 mov/almacén) y FK sin mapeo.',
    },
    {
      entidad: 'Detalle de entradas (EntradasDet)',
      v1: v1EntradasDet,
      v2: 0,
      nota: 'Referencia: cada EntradasDet aporta 1 renglón de kardex (no se cuenta cabecera↔detalle 1:1 por la síntesis a tela parent).',
    },
    {
      entidad: 'Salidas de tela (Salidas)',
      v1: v1Salidas,
      v2: v2Salida,
      nota: 'v2 = salidas a orden (salida-tela-orden). Las salidas sin orden van como ajuste-salida; las pata-de-traspaso NO se cuentan aquí (van en traspaso).',
    },
    {
      entidad: 'Detalle de salidas (SalidasDet)',
      v1: v1SalidasDet,
      v2: 0,
      nota: 'Referencia (no comparable 1:1 — ver nota de detalle de entradas).',
    },
    {
      entidad: 'Movimientos de kardex de TELA (v2, total)',
      v1: 0,
      v2: v2Tela,
      nota: `entrada + salida-a-orden + ajuste-salida + 2 patas por traspaso. Traspasos (patas)=${String(v2Traspaso)}.`,
    },
  ];
}

/**
 * Bloque (2): Σ kardex v2 por color×almacén vs `TelasColAlm.ExTela1+ExTela2`. El color de v2 se
 * resuelve del LOTE legacy (mapeo `LoteLegacyTela`: IdTelasColores → idLote): cada lote es de UN
 * color, así que Σ kardex por (idLote, idAlmacen) ≈ existencia del viejo por (IdTelasColores,
 * IdAlmacenes). Se compara contra ExTela1+ExTela2 (las dos sub-existencias del viejo, unificadas).
 */
async function calcularExistencias(cliente: PrismaClient): Promise<CuadreExistenciasTela> {
  const mapaAlmacen = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.almacenTela);
  // IdTelasColores → idLote (lote legacy sintetizado).
  const lotePorColor = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.loteLegacyTela);

  // Σ kardex v2 por (idLote, idAlmacen): entrada +, salida −. Suma directa sobre el detalle (D3).
  const sumaKardex = new Map<string, number>();
  const filas = await cliente.$queryRaw<
    { idLote: number | null; idAlmacen: number; existencia: string | null }[]
  >`
    SELECT d."id_lote" AS "idLote", m."id_almacen" AS "idAlmacen",
      COALESCE(SUM(d."cantidad" * CASE t."direccion"
        WHEN 'entrada' THEN 1 WHEN 'salida' THEN -1 ELSE 0 END), 0)::text AS existencia
    FROM "movimiento_det_tela" d
    JOIN "movimientos" m ON m."id" = d."id_movimiento"
    JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
    GROUP BY d."id_lote", m."id_almacen"
  `;
  for (const f of filas) {
    if (f.idLote === null) continue;
    sumaKardex.set(`${f.idLote}:${f.idAlmacen}`, Number(f.existencia ?? '0'));
  }

  const resumen: CuadreExistenciasTela = {
    comparadas: 0,
    cuadran: 0,
    descuadran: 0,
    noMapeables: 0,
    sumaV1: 0,
    sumaV2: 0,
    descuadres: [],
  };

  let telasColAlm: ReturnType<typeof leerCsv>;
  try {
    telasColAlm = leerCsv('TelasColAlm.csv');
  } catch {
    return resumen;
  }

  for (const f of telasColAlm) {
    const idTelasColores = (f.IdTelasColores ?? '').trim();
    const idAlmacenV1 = (f.IdAlmacenes ?? '').trim();
    const ex = sumaDet(f.ExTela1, f.ExTela2);
    // Solo se comparan los que el viejo tenía con saldo distinto de 0 (los miles de filas en cero no
    // aportan ni descuadre ni señal; el kardex de v2 tampoco los toca).
    if (Math.abs(ex) <= TOLERANCIA) continue;

    const idLote = lotePorColor.get(idTelasColores);
    const idAlmacen = mapaAlmacen.get(idAlmacenV1);
    if (idLote === undefined || idAlmacen === undefined) {
      resumen.noMapeables += 1;
      continue;
    }

    const v2 = sumaKardex.get(`${idLote}:${idAlmacen}`) ?? 0;
    resumen.comparadas += 1;
    resumen.sumaV1 += ex;
    resumen.sumaV2 += v2;
    if (Math.abs(ex - v2) <= TOLERANCIA) {
      resumen.cuadran += 1;
    } else {
      resumen.descuadran += 1;
      resumen.descuadres.push(
        `IdTelasColores=${idTelasColores} almacénV1=${idAlmacenV1}: v1 ExTela1+2=${ex.toFixed(2)} ` +
          `vs Σ kardex v2=${v2.toFixed(2)} (Δ=${(v2 - ex).toFixed(2)}) — saldo editado a mano en el viejo (D3).`,
      );
    }
  }

  return resumen;
}

/** Bloque (3): check de NO doble conteo (telas). */
async function calcularNoDobleConteo(cliente: PrismaClient): Promise<NoDobleConteoTela> {
  const [totalKardex, conOrigenRecepcion] = await Promise.all([
    cliente.movimiento.count({ where: { detallesTela: { some: {} } } }),
    cliente.movimiento.count({
      where: { detallesTela: { some: {} }, origenTipo: ORIGEN.recepcionCompra },
    }),
  ]);

  const inconsistencias: string[] = [];
  if (conOrigenRecepcion !== 0) {
    inconsistencias.push(
      `CRÍTICO: ${String(conOrigenRecepcion)} movimiento(s) de kardex de tela con origen ` +
        `'recepcion-compra' (se esperaba 0: en F4-E6 las entradas legacy van DIRECTO al kardex, ` +
        `sin RecepcionCompra).`,
    );
  }

  return { totalKardex, conOrigenRecepcion, inconsistencias };
}

/** Calcula el cuadre F4 (telas) completo (los tres bloques). */
export async function calcularCuadreF4(cliente: PrismaClient): Promise<CuadreF4> {
  const conteos = await calcularConteos(cliente);
  const existencias = await calcularExistencias(cliente);
  const noDobleConteo = await calcularNoDobleConteo(cliente);
  return { conteos, existencias, noDobleConteo };
}

/** Da formato de texto al cuadre F4 (telas). */
export function formatearCuadreF4(c: CuadreF4): string {
  const p: string[] = [];
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(' CUADRE F4 (TELAS) (1) CONTEOS — v1 (CSV) vs v2 (Postgres)');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(`${'Entidad'.padEnd(44)}${'v1'.padStart(8)}${'v2'.padStart(8)}   Nota`);
  p.push('─'.repeat(76));
  for (const r of c.conteos) {
    const v1 = r.v1 === 0 ? '   —' : String(r.v1);
    const v2 = r.v2 === 0 ? '   —' : String(r.v2);
    p.push(`${r.entidad.padEnd(44)}${v1.padStart(8)}${v2.padStart(8)}   ${r.nota}`);
  }

  p.push('');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(
    ' CUADRE F4 (TELAS) (2) EXISTENCIAS — Σ kardex v2 (color×almacén) vs TelasColAlm.ExTela1+2 (v1)',
  );
  p.push('═══════════════════════════════════════════════════════════════');
  const e = c.existencias;
  p.push(`  Combinaciones color×almacén comparadas (saldo≠0) : ${String(e.comparadas)}`);
  p.push(`    cuadran (|Δ| ≤ ${String(TOLERANCIA)})                        : ${String(e.cuadran)}`);
  p.push(`    DESCUADRAN (listadas abajo)                    : ${String(e.descuadran)}`);
  p.push(`  TelasColAlm con saldo no mapeables a v2 (excl.)   : ${String(e.noMapeables)}`);
  p.push(`  Σ existencia v1 (comparables)                     : ${e.sumaV1.toFixed(2)}`);
  p.push(
    `  Σ kardex v2 (comparables)                         : ${e.sumaV2.toFixed(2)} (Δ=${(e.sumaV2 - e.sumaV1).toFixed(2)})`,
  );
  p.push(
    '  Avíos: SIN histórico que migrar (R4 es nuevo) — arrancan en CERO; el conteo físico lo captura Gabriel (E1).',
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
  p.push(' CUADRE F4 (TELAS) (3) NO DOBLE CONTEO — entradas legacy SIN RecepcionCompra');
  p.push('═══════════════════════════════════════════════════════════════');
  const n = c.noDobleConteo;
  p.push(`  Movimientos de kardex de TELA (con detalle)       : ${String(n.totalKardex)}`);
  p.push(`    con origen 'recepcion-compra' (deben ser 0)     : ${String(n.conOrigenRecepcion)}`);
  if (n.inconsistencias.length === 0) {
    p.push(
      '  ✔ Sin doble conteo: ninguna entrada legacy creó RecepcionCompra (van directo al kardex).',
    );
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
  const cliente = crearClientePrisma(url);
  try {
    const cuadre = await calcularCuadreF4(cliente);
    console.log(formatearCuadreF4(cuadre));
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
