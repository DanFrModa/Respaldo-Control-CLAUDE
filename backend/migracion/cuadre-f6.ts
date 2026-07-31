/**
 * Reporte de CUADRE COMPLETO de la fase F6 (Calidad + EsMa) — F6-E6, espejo de `cuadre-f5.ts` /
 * `cuadre-fase.ts` (§7 — un dato tirado en silencio NO puede cerrar en verde). Tres bloques:
 *
 *  (1) CONTEOS v1 (CSV, parser real) vs v2 (Prisma count): Calidad (DefectoCatalogo/Auditoria/
 *      AuditoriaDefecto) + EsMa (EsMaCargo/AbonoMaquilero/DescuentoMaquilero/PagoMaquilero). Las
 *      tablas de Calidad se cuentan por Prisma directo (NO depende del código del ETL de Calidad).
 *  (2) SALDOS por maquilero: saldo v1 (fórmula `EsMa_SaldosMaq` con "ceronulo" sobre los CSV,
 *      calculada de forma COMPARABLE a v2 — solo cargos VALIDADOS de órdenes migradas) vs saldo v2
 *      (mismo cálculo que `dominio/esma/saldos.ts`, D3). Lista los descuadres con su causa probable;
 *      la diferencia sistemática (cargos de órdenes NO migradas, cargos `propuesto`) se explica, NO
 *      se corrige. Cruce con el tablero de dominio (`saldosDeTodosMaquileros`).
 *  (3) CONCILIACIÓN sobre el periodo histórico completo (`dominio/esma/conciliacion.ts`): recibido
 *      (F3) vs cargado (EsMa) — criterio de salida "EsMa cuadra contra los recibos del periodo".
 *  (+) INCONSISTENCIAS de origen LISTADAS (no se corrigen): cargos sin cabecera EsMa (los 12 con
 *      `IdEsMa=0`, incl. el estampado `IdEsMa_Recibos=5811`), movimientos con maquilero sin mapeo en
 *      v2 (los de empresas viejas no migradas, pendientes F10), pagos con `IdEsMa` sin cabecera.
 *
 * Solo LECTURA (no carga nada). Correr aparte con: npx tsx --env-file=.env migracion/cuadre-f6.ts
 */
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, Prisma, type PrismaClient } from '../src/datos/index.js';
import { saldosDeTodosMaquileros } from '../src/dominio/esma/saldos-todos.js';
import { conciliarEsMa } from '../src/dominio/esma/conciliacion.js';

import { contarFilasCsv, leerCsv } from './comun/csv.js';
import { cargarMapaNumerico, ENTIDAD_MAPEO } from './comun/mapeo.js';
import { parsearBandera, parsearDinero } from './comun/valores.js';
import { describirVentana, resolverVentana } from './comun/ventana.js';
import { sesionEtl } from './comun/sesion-etl.js';
import {
  cargarCabecerasEsMa,
  resolverEmpresaEsMa,
  resolverMaquileroCabecera,
} from './loaders/esma-cargos.js';

/** Un renglón del cuadre de conteos: entidad, v1, v2, nota. */
export interface RenglonCuadreF6 {
  entidad: string;
  v1: number;
  v2: number;
  nota: string;
}

/** Redondeo monetario a 2 decimales (evita artefactos de coma flotante en las sumas). */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Bloque (1): conteos ────────────────────────────────────────────────────────────────────────

/** Conteos v1 (CSV) vs v2 (Prisma) de Calidad + EsMa. */
async function calcularConteos(cliente: PrismaClient): Promise<RenglonCuadreF6[]> {
  const v1Defectos = contarFilasCsv('CC_Catalogo.csv');
  const v1Auditorias = contarFilasCsv('CC_Auditorias.csv');
  const v1AuditoriasDet = contarFilasCsv('CC_AuditoriasDet.csv');
  const v1Cargos = contarFilasCsv('EsMa_Recibos.csv');
  const v1Abonos = contarFilasCsv('EsMa_Abonos.csv');
  const v1Descuentos = contarFilasCsv('EsMa_Desc.csv');
  const v1Pagos = contarFilasCsv('EsMa_Pagos.csv');

  const [v2Defectos, v2Auditorias, v2AuditoriasDet, v2Cargos, v2Abonos, v2Descuentos, v2Pagos] =
    await Promise.all([
      cliente.defectoCatalogo.count(),
      cliente.auditoria.count(),
      cliente.auditoriaDefecto.count(),
      cliente.esMaCargo.count(),
      cliente.abonoMaquilero.count(),
      cliente.descuentoMaquilero.count(),
      cliente.pagoMaquilero.count(),
    ]);

  return [
    {
      entidad: 'Defectos (CC_Catalogo)',
      v1: v1Defectos,
      v2: v2Defectos,
      nota: 'v2 ≥ v1 (el seed de Calidad puede sembrar algunos; el ETL crea los que falten).',
    },
    {
      entidad: 'Auditorías (CC_Auditorias)',
      v1: v1Auditorias,
      v2: v2Auditorias,
      nota: 'v2 = auditorías migradas; órdenes no migradas se OMITEN (ver ETL de Calidad).',
    },
    {
      entidad: 'Renglones defecto (CC_AuditoriasDet)',
      v1: v1AuditoriasDet,
      v2: v2AuditoriasDet,
      nota: 'v2 ≤ v1 ESPERADO (ETL): dedup de pares (auditoría, defecto) DUPLICADOS + detalles omitidos (defecto/auditoría sin mapeo). La pre-carga de favoritos es de la CAPTURA nueva, NO de la migración.',
    },
    {
      entidad: 'Cargos EsMa (EsMa_Recibos)',
      v1: v1Cargos,
      v2: v2Cargos,
      nota: 'v2 = cargos migrados (1,251 de estampado recuperados por el FIX). 12 con IdEsMa=0 y órdenes no migradas se OMITEN (listado).',
    },
    {
      entidad: 'Abonos (EsMa_Abonos)',
      v1: v1Abonos,
      v2: v2Abonos,
      nota: 'v2 ≤ v1 por abonos con maquilero sin mapeo (empresas viejas, F10). Montos negativos ("saldo anterior") preservados.',
    },
    {
      entidad: 'Descuentos (EsMa_Desc)',
      v1: v1Descuentos,
      v2: v2Descuentos,
      nota: 'v2 ≤ v1 por descuentos con maquilero sin mapeo (F10).',
    },
    {
      entidad: 'Pagos (EsMa_Pagos)',
      v1: v1Pagos,
      v2: v2Pagos,
      nota: 'v2 ≤ v1: pagos LIBRES (sin aplicaciones); 1 con IdEsMa sin cabecera + refs sin mapeo se OMITEN.',
    },
  ];
}

// ── Bloque (2): saldos por maquilero ─────────────────────────────────────────────────────────────

/** Saldo v1 acumulado por maquilero (v2 provId), comparable a v2 (solo cargos validados migrados). */
interface SaldoAcumulado {
  cargos: number;
  abonos: number;
  pagos: number;
  descuentos: number;
}

/** Resultado del bloque de saldos. */
export interface SaldosF6 {
  /** # de maquileros (v2 provId) comparados (aparecen en v1 y/o v2). */
  comparados: number;
  /** # que cuadran (|v1−v2| ≤ 1 centavo). */
  cuadran: number;
  /** # que descuadran. */
  descuadran: number;
  /** Saldo total v1 comparable / v2. */
  totalV1: number;
  totalV2: number;
  /** Detalle de los descuadres (acotado). */
  detalle: string[];
  /** Cargos de órdenes NO migradas excluidos del v1 comparable (# y monto) — causa sistemática. */
  cargosOrdenNoMigrada: number;
  montoCargosOrdenNoMigrada: number;
  /** Cargos `propuesto` (RevisionPendiente=1) excluidos (v2 solo suma validados). */
  cargosPropuestoExcluidos: number;
  /** Total del tablero de dominio (`saldosDeTodosMaquileros`) — cruce independiente. */
  totalTableroDominio: number | null;
  filasTableroDominio: number;
}

/** Acumula un aporte al saldo de un maquilero. */
function acumular(
  mapa: Map<number, SaldoAcumulado>,
  prov: number,
  campo: keyof SaldoAcumulado,
  valor: number,
): void {
  const s = mapa.get(prov) ?? { cargos: 0, abonos: 0, pagos: 0, descuentos: 0 };
  s[campo] += valor;
  mapa.set(prov, s);
}

/** Saldo derivado (cargos + abonos − pagos − descuentos). */
function saldoDe(s: SaldoAcumulado): number {
  return redondear2(s.cargos + s.abonos - s.pagos - s.descuentos);
}

/** Fila cruda del agregado v2 por maquilero. */
interface FilaV2 {
  idMaquilero: number;
  nombre: string;
  cargos: number;
  abonos: number;
  pagos: number;
  descuentos: number;
}

/** Calcula el cuadre de SALDOS por maquilero (v1 comparable vs v2). */
async function calcularSaldos(cliente: PrismaClient): Promise<SaldosF6> {
  const idEmpresa = await resolverEmpresaEsMa(cliente);
  const cabeceras = cargarCabecerasEsMa();
  const mapaMaquilero = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.proveedorPorIdMaquileros);
  const mapaEstampador = await cargarMapaNumerico(
    cliente,
    ENTIDAD_MAPEO.proveedorPorIdEstampadores,
  );
  const mapaOrden = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.orden);

  const resolverProv = (idEsMa: string): number | null => {
    const cab = cabeceras.get(idEsMa);
    if (cab === undefined) return null;
    return resolverMaquileroCabecera(cab.idMaquileroViejo, mapaMaquilero, mapaEstampador);
  };

  const v1 = new Map<number, SaldoAcumulado>();

  // Cargos: solo VALIDADOS (RevisionPendiente=0) de órdenes MIGRADAS (comparable a v2).
  let cargosOrdenNoMigrada = 0;
  let montoCargosOrdenNoMigrada = 0;
  let cargosPropuestoExcluidos = 0;
  for (const r of leerCsv('EsMa_Recibos.csv')) {
    const prov = resolverProv((r.IdEsMa ?? '').trim());
    if (prov === null) continue; // sin cabecera o maquilero sin mapeo → fuera del comparable
    const importe = (parsearDinero(r.CantRecEsMa) ?? 0) * (parsearDinero(r.PrecioEsMa) ?? 0);
    if (parsearBandera(r.RevisionPendiente)) {
      cargosPropuestoExcluidos += 1;
      continue; // v2 solo suma cargos validados
    }
    if (!mapaOrden.has((r.IdOrdenes ?? '').trim())) {
      cargosOrdenNoMigrada += 1;
      montoCargosOrdenNoMigrada += importe;
      continue; // v2 omite el cargo si su orden no se migró
    }
    acumular(v1, prov, 'cargos', importe);
  }

  // Abonos / descuentos / pagos (montos signados; nulos → 0).
  for (const r of leerCsv('EsMa_Abonos.csv')) {
    const prov = resolverProv((r.IdEsMa ?? '').trim());
    if (prov !== null) acumular(v1, prov, 'abonos', parsearDinero(r.AbonoEsMa) ?? 0);
  }
  for (const r of leerCsv('EsMa_Desc.csv')) {
    const prov = resolverProv((r.IdEsMa ?? '').trim());
    if (prov !== null) acumular(v1, prov, 'descuentos', parsearDinero(r.DescuentoEsMa) ?? 0);
  }
  for (const r of leerCsv('EsMa_Pagos.csv')) {
    const prov = resolverProv((r.IdEsMa ?? '').trim());
    if (prov !== null) acumular(v1, prov, 'pagos', parsearDinero(r.PagoEsMa) ?? 0);
  }

  // v2: agregado por maquilero (misma fórmula que `saldoDeMaquilero`, D3), acotado a la empresa.
  const filasV2 = await cliente.$queryRaw<FilaV2[]>(Prisma.sql`
    SELECT p."id" AS "idMaquilero", p."nombre" AS "nombre",
      COALESCE(c."total", 0)::float8 AS "cargos",
      COALESCE(a."total", 0)::float8 AS "abonos",
      COALESCE(pg."total", 0)::float8 AS "pagos",
      COALESCE(d."total", 0)::float8 AS "descuentos"
    FROM "proveedores" p
    LEFT JOIN (
      SELECT "id_maquilero", SUM("cantidad_real" * "precio_real") AS "total" FROM "esma_cargo"
      WHERE "id_empresa" = ${idEmpresa} AND "estado" = 'validado' AND "sin_costo" = FALSE
      GROUP BY "id_maquilero"
    ) c ON c."id_maquilero" = p."id"
    LEFT JOIN (
      SELECT "id_maquilero", SUM("monto") AS "total" FROM "abono_maquilero"
      WHERE "id_empresa" = ${idEmpresa} GROUP BY "id_maquilero"
    ) a ON a."id_maquilero" = p."id"
    LEFT JOIN (
      SELECT "id_maquilero", SUM("monto") AS "total" FROM "pago_maquilero"
      WHERE "id_empresa" = ${idEmpresa} GROUP BY "id_maquilero"
    ) pg ON pg."id_maquilero" = p."id"
    LEFT JOIN (
      SELECT "id_maquilero", SUM("monto") AS "total" FROM "descuento_maquilero"
      WHERE "id_empresa" = ${idEmpresa} GROUP BY "id_maquilero"
    ) d ON d."id_maquilero" = p."id"
    WHERE c."total" IS NOT NULL OR a."total" IS NOT NULL
       OR pg."total" IS NOT NULL OR d."total" IS NOT NULL
  `);
  const v2 = new Map<number, { saldo: number; nombre: string }>();
  for (const f of filasV2) {
    v2.set(f.idMaquilero, {
      nombre: f.nombre,
      saldo: redondear2(f.cargos + f.abonos - f.pagos - f.descuentos),
    });
  }

  // Compara sobre la unión de maquileros.
  const provIds = new Set<number>([...v1.keys(), ...v2.keys()]);
  let cuadran = 0;
  let descuadran = 0;
  let totalV1 = 0;
  let totalV2 = 0;
  const detalle: string[] = [];
  for (const prov of [...provIds].sort((a, b) => a - b)) {
    const sv1 = v1.has(prov) ? saldoDe(v1.get(prov) as SaldoAcumulado) : 0;
    const sv2 = v2.get(prov)?.saldo ?? 0;
    totalV1 += sv1;
    totalV2 += sv2;
    if (Math.abs(sv1 - sv2) <= 0.01) {
      cuadran += 1;
    } else {
      descuadran += 1;
      const nombre = v2.get(prov)?.nombre ?? '(sin datos v2)';
      const causa = !v2.has(prov)
        ? 'sin datos en v2 (¿todos sus movimientos omitidos?)'
        : 'revisar reporte de incidencias (cargos/movimientos omitidos)';
      detalle.push(
        `prov=${String(prov)} "${nombre}" v1=${sv1.toFixed(2)} v2=${sv2.toFixed(2)} dif=${(sv2 - sv1).toFixed(2)} — ${causa}`,
      );
    }
  }

  // Cruce con el tablero de dominio (activos con rol y saldo ≠ 0).
  const sesion = sesionEtl(idEmpresa);
  let totalTableroDominio: number | null = null;
  let filasTableroDominio = 0;
  try {
    const tablero = await saldosDeTodosMaquileros(sesion, {}, { cliente });
    totalTableroDominio = tablero.totalSaldo;
    filasTableroDominio = tablero.filas.length;
  } catch {
    // El tablero es un cruce informativo; si fallara (permisos/empresa) no invalida el cuadre.
  }

  return {
    comparados: provIds.size,
    cuadran,
    descuadran,
    totalV1: redondear2(totalV1),
    totalV2: redondear2(totalV2),
    detalle,
    cargosOrdenNoMigrada,
    montoCargosOrdenNoMigrada: redondear2(montoCargosOrdenNoMigrada),
    cargosPropuestoExcluidos,
    totalTableroDominio,
    filasTableroDominio,
  };
}

// ── Bloque (3): conciliación del periodo histórico ───────────────────────────────────────────────

/** Resultado del bloque de conciliación (recibido vs cargado). */
export interface ConciliacionF6 {
  desde: string | null;
  hasta: string | null;
  recibido: number;
  cargado: number;
  faltantePorCargar: number;
  numCargosSinRecibo: number;
  grupos: number;
}

/** `YYYY-MM-DD` de un `Date` (UTC). */
function aFechaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Corre la conciliación sobre TODO el periodo histórico (recibido F3 vs cargado EsMa). El periodo se
 * calcula (min..max fecha de los recibos) SOLO para mostrarlo; la conciliación se corre SIN recorte de
 * fecha a propósito: `conciliarEsMa` filtra los "cargos sin recibo" por `creadoEn`, y los cargos
 * MIGRADOS nacen con `creadoEn` = fecha de migración (no la histórica), así que un periodo acotado los
 * perdería. Sin recorte, `numCargosSinRecibo` refleja los cargos migrados (idEtapaRecibo NULL, sin
 * liga 1:1). El recibido/cargado del periodo completo = el de todo el histórico.
 */
async function calcularConciliacion(cliente: PrismaClient): Promise<ConciliacionF6> {
  const idEmpresa = await resolverEmpresaEsMa(cliente);
  const rango = await cliente.etapaMovimiento.aggregate({
    where: { idEmpresa, tipo: 'recibo_maquila', canceladoEn: null },
    _min: { fecha: true },
    _max: { fecha: true },
  });
  const desde = rango._min.fecha === null ? null : aFechaISO(rango._min.fecha);
  const hasta = rango._max.fecha === null ? null : aFechaISO(rango._max.fecha);

  const sesion = sesionEtl(idEmpresa);
  const conc = await conciliarEsMa(sesion, {}, { cliente });
  return {
    desde,
    hasta,
    recibido: conc.totales.recibido,
    cargado: conc.totales.cargado,
    faltantePorCargar: conc.totales.faltantePorCargar,
    numCargosSinRecibo: conc.totales.numCargosSinRecibo,
    grupos: conc.filas.length,
  };
}

// ── Bloque (+): inconsistencias de origen ────────────────────────────────────────────────────────

/** Listas cualitativas de inconsistencias de origen (no se corrigen, §7). */
export interface InconsistenciasF6 {
  /** Cargos con `IdEsMa=0` (sin cabecera) — los 12, incluye el estampado 5811. */
  cargosSinCabecera: string[];
  /** # de cargos con maquilero sin mapeo en v2 (empresas viejas, F10). */
  cargosMaquileroSinMapeo: number;
  /** # de abonos/descuentos/pagos con maquilero sin mapeo en v2 (F10). */
  abonosSinMapeo: number;
  descuentosSinMapeo: number;
  pagosSinMapeo: number;
  /** # de pagos con `IdEsMa` sin cabecera. */
  pagosSinCabecera: number;
}

/** Calcula las inconsistencias de origen desde los CSV + los mapeos v2. */
async function calcularInconsistencias(cliente: PrismaClient): Promise<InconsistenciasF6> {
  const cabeceras = cargarCabecerasEsMa();
  const mapaMaquilero = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.proveedorPorIdMaquileros);
  const mapaEstampador = await cargarMapaNumerico(
    cliente,
    ENTIDAD_MAPEO.proveedorPorIdEstampadores,
  );

  const cargosSinCabecera: string[] = [];
  let cargosMaquileroSinMapeo = 0;
  for (const r of leerCsv('EsMa_Recibos.csv')) {
    const idEsMa = (r.IdEsMa ?? '').trim();
    const cab = cabeceras.get(idEsMa);
    if (cab === undefined) {
      cargosSinCabecera.push(
        `IdEsMa_Recibos=${(r.IdEsMa_Recibos ?? '').trim()} IdEsMa=${idEsMa} EsEstampado=${(r.EsEstampado ?? '').trim()}`,
      );
      continue;
    }
    if (resolverMaquileroCabecera(cab.idMaquileroViejo, mapaMaquilero, mapaEstampador) === null) {
      cargosMaquileroSinMapeo += 1;
    }
  }

  const contarSinMapeo = (archivo: string): { sinMapeo: number; sinCabecera: number } => {
    let sinMapeo = 0;
    let sinCabecera = 0;
    for (const r of leerCsv(archivo)) {
      const cab = cabeceras.get((r.IdEsMa ?? '').trim());
      if (cab === undefined) {
        sinCabecera += 1;
        continue;
      }
      if (resolverMaquileroCabecera(cab.idMaquileroViejo, mapaMaquilero, mapaEstampador) === null) {
        sinMapeo += 1;
      }
    }
    return { sinMapeo, sinCabecera };
  };

  const abonos = contarSinMapeo('EsMa_Abonos.csv');
  const descuentos = contarSinMapeo('EsMa_Desc.csv');
  const pagos = contarSinMapeo('EsMa_Pagos.csv');

  return {
    cargosSinCabecera,
    cargosMaquileroSinMapeo,
    abonosSinMapeo: abonos.sinMapeo,
    descuentosSinMapeo: descuentos.sinMapeo,
    pagosSinMapeo: pagos.sinMapeo,
    pagosSinCabecera: pagos.sinCabecera,
  };
}

// ── Cuadre completo ──────────────────────────────────────────────────────────────────────────────

/** Cuadre F6 completo (conteos + saldos + conciliación + inconsistencias). */
export interface CuadreF6 {
  conteos: RenglonCuadreF6[];
  saldos: SaldosF6;
  conciliacion: ConciliacionF6;
  inconsistencias: InconsistenciasF6;
}

/** Calcula el cuadre F6 completo. */
export async function calcularCuadreF6(cliente: PrismaClient): Promise<CuadreF6> {
  const conteos = await calcularConteos(cliente);
  const saldos = await calcularSaldos(cliente);
  const conciliacion = await calcularConciliacion(cliente);
  const inconsistencias = await calcularInconsistencias(cliente);
  return { conteos, saldos, conciliacion, inconsistencias };
}

/** Da formato de texto al cuadre F6. */
export function formatearCuadreF6(c: CuadreF6): string {
  const ventana = resolverVentana();
  const p: string[] = [];
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(' CUADRE F6 (CALIDAD + EsMa) — v1 (CSV) vs v2 (Postgres)');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(`  ${describirVentana(ventana)}`);
  if (ventana.corte !== null) {
    p.push(
      '  Con la ventana ACTIVA: v2 lleva SOLO lo dentro de ventana + los asientos "Saldo inicial de',
    );
    p.push(
      '  migración" (AbonoMaquilero por maquilero, fecha = corte); el v1 de este cuadre sigue siendo',
    );
    p.push(
      '  el histórico COMPLETO de los CSV → v2 < v1 en conteos es lo ESPERADO (excluidos en el reporte).',
    );
  }
  p.push(`${'Entidad'.padEnd(38)}${'v1'.padStart(8)}${'v2'.padStart(8)}   Nota`);
  p.push('─'.repeat(80));
  for (const r of c.conteos) {
    const v2 = r.v2 === 0 ? '   —' : String(r.v2);
    p.push(`${r.entidad.padEnd(38)}${String(r.v1).padStart(8)}${v2.padStart(8)}   ${r.nota}`);
  }

  const s = c.saldos;
  p.push('');
  p.push('── SALDOS por maquilero (v1 comparable vs v2, D3) ──');
  p.push(`  Maquileros comparados : ${String(s.comparados)}`);
  p.push(`  Cuadran (≤ 1 centavo) : ${String(s.cuadran)}`);
  p.push(`  Descuadran            : ${String(s.descuadran)}`);
  p.push(`  Saldo total v1        : ${s.totalV1.toFixed(2)}`);
  p.push(`  Saldo total v2        : ${s.totalV2.toFixed(2)}`);
  p.push(`  Diferencia (v2 − v1)  : ${(s.totalV2 - s.totalV1).toFixed(2)}`);
  p.push(
    `  Cargos excluidos por ORDEN NO MIGRADA (causa sistemática): ${String(s.cargosOrdenNoMigrada)} (monto ${s.montoCargosOrdenNoMigrada.toFixed(2)})`,
  );
  p.push(
    `  Cargos 'propuesto' excluidos (v2 solo validados): ${String(s.cargosPropuestoExcluidos)}`,
  );
  if (ventana.corte !== null) {
    p.push(
      '  Ventana ACTIVA: el saldo v1 comparable de arriba suma TODO el histórico de abonos/pagos/',
    );
    p.push(
      '  descuentos, mientras v2 lleva lo dentro de ventana + el asiento de saldo inicial; el residuo',
    );
    p.push(
      '  esperado del descuadre ≈ cargos excluidos por ORDEN NO MIGRADA (renglón de arriba). NO se',
    );
    p.push('  re-balancea (§7): el desglose por maquilero está en el reporte del ETL.');
  }
  if (s.totalTableroDominio !== null) {
    p.push(
      `  Cruce tablero de dominio (saldosDeTodosMaquileros, activos c/rol y saldo≠0): ${String(s.filasTableroDominio)} maquileros, total ${s.totalTableroDominio.toFixed(2)}`,
    );
  }
  if (s.detalle.length > 0) {
    p.push('  Descuadres (acotado a 30):');
    for (const d of s.detalle.slice(0, 30)) p.push(`    - ${d}`);
    if (s.detalle.length > 30) p.push(`    … y ${String(s.detalle.length - 30)} más.`);
  }

  const cc = c.conciliacion;
  p.push('');
  p.push('── CONCILIACIÓN recibido (F3) vs cargado (EsMa) — periodo histórico ──');
  p.push(`  Periodo               : ${cc.desde ?? '(sin recibos)'} … ${cc.hasta ?? ''}`);
  p.push(`  Grupos orden×maq×proc : ${String(cc.grupos)}`);
  p.push(`  Recibido (piezas)     : ${String(cc.recibido)}`);
  p.push(`  Cargado (piezas)      : ${String(cc.cargado)}`);
  p.push(`  Faltante por cargar   : ${String(cc.faltantePorCargar)}`);
  p.push(
    `  Cargos sin recibo ligado: ${String(cc.numCargosSinRecibo)} (ESPERADO: el histórico migra con idEtapaRecibo NULL — sin liga 1:1)`,
  );

  const inc = c.inconsistencias;
  p.push('');
  p.push('── INCONSISTENCIAS de origen LISTADAS (NO se corrigen, §7) ──');
  p.push(
    `  Cargos SIN cabecera EsMa (IdEsMa=0): ${String(inc.cargosSinCabecera.length)} (incluye el estampado IdEsMa_Recibos=5811)`,
  );
  for (const d of inc.cargosSinCabecera.slice(0, 20)) p.push(`    - ${d}`);
  p.push(
    `  Cargos con maquilero SIN mapeo en v2 (empresas viejas, F10): ${String(inc.cargosMaquileroSinMapeo)}`,
  );
  p.push(`  Abonos con maquilero SIN mapeo (F10)   : ${String(inc.abonosSinMapeo)}`);
  p.push(`  Descuentos con maquilero SIN mapeo (F10): ${String(inc.descuentosSinMapeo)}`);
  p.push(`  Pagos con maquilero SIN mapeo (F10)    : ${String(inc.pagosSinMapeo)}`);
  p.push(`  Pagos con IdEsMa SIN cabecera         : ${String(inc.pagosSinCabecera)}`);
  p.push('');
  p.push(
    '  Nota: un maquilero con Proceso=1 (estampado) puede no tener el rol `estampado` en v2 (solo',
  );
  p.push(
    '  `maquila-costura`); no afecta la validez del cargo, solo los filtros de UI por tipo (refinamiento F10).',
  );

  return p.join('\n');
}

/** Punto de entrada del script `cuadre-f6.ts` (solo lee/cuenta). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url);
  try {
    const cuadre = await calcularCuadreF6(cliente);
    console.log(formatearCuadreF6(cuadre));
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
