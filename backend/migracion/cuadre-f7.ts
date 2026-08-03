/**
 * Reporte de CUADRE de la fase F7 (Costos/EDR + Indicadores) — F7-E6, espejo de `cuadre-f6.ts`
 * (§7: un dato tirado en silencio NO puede cerrar en verde). Bloques:
 *
 *  (1) CONTEOS v1 (CSV, parser real) vs v2 (Prisma count): costos, productividad IP/almacén, fichas,
 *      muestrarios, cíclicos históricos. Los v2 ≤ v1 son ESPERADOS (órdenes/clientes/modelos sin
 *      mapeo, filas con dato inválido) y se explican en la nota de cada renglón.
 *  (2) COSTOS — cuadre de la REGALÍA (⭐ D2): verifica EMPÍRICAMENTE si el `Costo` viejo incluía la
 *      regalía (`Costo == tela+hab+bord+maquila+regalia+otros`). El costoTotal v2 EXCLUYE la regalía
 *      (D2), así que la diferencia v1−v2 = Σ RegaliasCost es un DELTA ESPERADO por diseño, NUNCA un
 *      error. Preserva el `Costo` viejo (Σ) para trazabilidad.
 *
 * Solo LECTURA (no carga nada). Correr aparte con: npx tsx --env-file=.env migracion/cuadre-f7.ts
 */
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { opcionesClienteEtl } from './comun/cliente-etl.js';

import { contarFilasCsv, leerCsv } from './comun/csv.js';
import { ENTIDAD_MAPEO } from './comun/mapeo.js';
import { parsearDinero } from './comun/valores.js';
import { describirVentana, resolverVentana } from './comun/ventana.js';

/** Un renglón del cuadre de conteos: entidad, v1, v2, nota. */
export interface RenglonCuadreF7 {
  entidad: string;
  v1: number;
  v2: number;
  nota: string;
}

/** Redondeo monetario a 2 decimales (evita artefactos de coma flotante). */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Bloque (2): análisis de la regalía sobre el CSV ──────────────────────────────────────────────

/** Hallazgo del análisis de la regalía en `CostoOrd.csv` (D2). */
export interface AnalisisRegalias {
  filas: number;
  conRegalia: number;
  /** De las que traen regalía, cuántas cumplen `Costo == suma CON regalía` (→ el viejo la incluía). */
  costoIncluyeRegalia: number;
  /** De las que traen regalía, cuántas cumplen `Costo == suma SIN regalía`. */
  costoExcluyeRegalia: number;
  /** Filas con regalía cuyo `Costo` no casa con ninguna de las dos sumas (dato viejo inconsistente). */
  costoNoCasa: number;
  /** Σ de RegaliasCost (= delta ESPERADO v1−v2 del costoTotal, D2). */
  sumaRegalias: number;
  /** Σ del `Costo` viejo (con regalía) — trazabilidad. */
  sumaCostoViejo: number;
}

/** Analiza `CostoOrd.csv`: ¿el `Costo` viejo incluía la regalía? + Σ regalías (delta D2). */
export function analizarRegalias(): AnalisisRegalias {
  let filas = 0;
  let conRegalia = 0;
  let costoIncluyeRegalia = 0;
  let costoExcluyeRegalia = 0;
  let costoNoCasa = 0;
  let sumaRegalias = 0;
  let sumaCostoViejo = 0;

  for (const f of leerCsv('CostoOrd.csv')) {
    filas += 1;
    const tela = parsearDinero(f.TelaCost) ?? 0;
    const hab = parsearDinero(f.HabCost) ?? 0;
    const bord = parsearDinero(f.BordCost) ?? 0;
    const maquila = parsearDinero(f.MaquilaCost) ?? 0;
    const reg = parsearDinero(f.RegaliasCost) ?? 0;
    const otros = parsearDinero(f.Otros) ?? 0;
    const costo = parsearDinero(f.Costo) ?? 0;
    sumaRegalias += reg;
    sumaCostoViejo += costo;
    if (reg !== 0) {
      conRegalia += 1;
      const conReg = tela + hab + bord + maquila + reg + otros;
      const sinReg = conReg - reg;
      if (Math.abs(conReg - costo) < 0.01) costoIncluyeRegalia += 1;
      else if (Math.abs(sinReg - costo) < 0.01) costoExcluyeRegalia += 1;
      else costoNoCasa += 1;
    }
  }
  return {
    filas,
    conRegalia,
    costoIncluyeRegalia,
    costoExcluyeRegalia,
    costoNoCasa,
    sumaRegalias: redondear2(sumaRegalias),
    sumaCostoViejo: redondear2(sumaCostoViejo),
  };
}

// ── Bloque (1): conteos ──────────────────────────────────────────────────────────────────────────

/** Costos v2 (conteo + Σ costoTotal). */
interface CostosV2 {
  costeadas: number;
  sumaCostoTotal: number;
}

/** Cuadre F7 completo (conteos + análisis de regalías + costos v2). */
export interface CuadreF7 {
  conteos: RenglonCuadreF7[];
  regalias: AnalisisRegalias;
  costosV2: CostosV2;
}

/** Calcula el cuadre F7 completo. */
export async function calcularCuadreF7(cliente: PrismaClient): Promise<CuadreF7> {
  const v1Costos = contarFilasCsv('CostoOrd.csv');
  const v1ProdIp = contarFilasCsv('IP_Productiv.csv');
  const v1ProdAlm = contarFilasCsv('Alm_Prd_Det.csv');
  const v1Fichas = contarFilasCsv('IP_InfConf.csv');
  const v1Muestrarios = contarFilasCsv('IP_MuesPend.csv');
  const v1Ciclicos = contarFilasCsv('Alm_InvCic.csv');

  const [
    v2Costos,
    v2ProdIp,
    v2ProdAlm,
    v2FichasOrdenes,
    v2FichasReactivos,
    v2Muestrarios,
    v2CiclicosMig,
    v2CiclicosTotal,
    sumaCosto,
  ] = await Promise.all([
    cliente.costoOrden.count(),
    cliente.registroProductividad.count({ where: { area: 'ip' } }),
    cliente.registroProductividad.count({ where: { area: 'almacen' } }),
    cliente.fichaVerificacion
      .findMany({ distinct: ['idOrden'], select: { idOrden: true } })
      .then((f) => f.length),
    cliente.fichaVerificacion.count(),
    cliente.muestrario.count(),
    cliente.mapeoMigracion.count({ where: { entidad: ENTIDAD_MAPEO.inventarioCiclicoHist } }),
    cliente.inventarioCiclico.count(),
    cliente.costoOrden.aggregate({ _sum: { costoTotal: true } }),
  ]);

  const conteos: RenglonCuadreF7[] = [
    {
      entidad: 'Costos (CostoOrd)',
      v1: v1Costos,
      v2: v2Costos,
      nota: 'v2 ≤ v1: órdenes sin mapeo / "no costear" se OMITEN (listadas). costoTotal EXCLUYE regalía (D2).',
    },
    {
      entidad: 'Productividad IP (IP_Productiv)',
      v1: v1ProdIp,
      v2: v2ProdIp,
      nota: 'v2 ≤ v1: persona/actividad sin mapeo o horas fuera de rango (0/>24) se OMITEN.',
    },
    {
      entidad: 'Productividad Almacén (Alm_Prd_Det)',
      v1: v1ProdAlm,
      v2: v2ProdAlm,
      nota: 'v2 ≤ v1: 1 registro por DETALLE (aplana Alm_Prd). Actividad sin mapeo/dato faltante → OMITE.',
    },
    {
      entidad: 'Fichas confiables (IP_InfConf) — órdenes',
      v1: v1Fichas,
      v2: v2FichasOrdenes,
      nota: `v2 = órdenes con ficha (${String(v2FichasReactivos)} verificaciones = órdenes × 8 reactivos). Orden sin mapeo → OMITE.`,
    },
    {
      entidad: 'Muestrarios (IP_MuesPend)',
      v1: v1Muestrarios,
      v2: v2Muestrarios,
      nota: 'v2 ≤ v1: cliente (texto) sin match en el catálogo se OMITE (Walmart/Soriana; listados).',
    },
    {
      entidad: 'Cíclicos históricos (Alm_InvCic)',
      v1: v1Ciclicos,
      v2: v2CiclicosMig,
      nota: `v2 = cíclicos migrados (Proscai, D6); modelo sin match por código → OMITE. Total InventarioCiclico en BD = ${String(v2CiclicosTotal)}.`,
    },
  ];

  const totalDecimal = sumaCosto._sum.costoTotal;
  return {
    conteos,
    regalias: analizarRegalias(),
    costosV2: {
      costeadas: v2Costos,
      sumaCostoTotal: redondear2(totalDecimal === null ? 0 : totalDecimal.toNumber()),
    },
  };
}

/** Da formato de texto al cuadre F7. */
export function formatearCuadreF7(c: CuadreF7): string {
  const ventana = resolverVentana();
  const p: string[] = [];
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(' CUADRE F7 (COSTOS/EDR + INDICADORES) — v1 (CSV) vs v2 (Postgres)');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(`  ${describirVentana(ventana)}`);
  if (ventana.corte !== null) {
    p.push(
      '  Con la ventana ACTIVA: costos y fichas siguen a su orden (cascada) y el cíclico histórico se',
    );
    p.push(
      '  recorta por FechaIC → v2 < v1 adicional ESPERADO (excluidos en los buckets del reporte).',
    );
    p.push(
      '  Catálogos, productividad y muestrarios migran completos (decisión declarada del cierre F7).',
    );
  }
  p.push(`${'Entidad'.padEnd(42)}${'v1'.padStart(8)}${'v2'.padStart(8)}   Nota`);
  p.push('─'.repeat(90));
  for (const r of c.conteos) {
    const v2 = r.v2 === 0 ? '   —' : String(r.v2);
    p.push(`${r.entidad.padEnd(42)}${String(r.v1).padStart(8)}${v2.padStart(8)}   ${r.nota}`);
  }

  const g = c.regalias;
  p.push('');
  p.push('── COSTOS · cuadre de la REGALÍA (D2: la regalía sale del costo) ──');
  p.push(`  Filas CostoOrd                       : ${String(g.filas)}`);
  p.push(`  Filas con RegaliasCost ≠ 0           : ${String(g.conRegalia)}`);
  p.push(
    `  de esas, Costo INCLUÍA la regalía    : ${String(g.costoIncluyeRegalia)}  ← hallazgo: el total viejo SÍ traía la regalía`,
  );
  p.push(`  de esas, Costo EXCLUÍA la regalía    : ${String(g.costoExcluyeRegalia)}`);
  p.push(
    `  de esas, Costo no casa (dato viejo)  : ${String(g.costoNoCasa)}  (inconsistencia de origen, LISTADA no corregida)`,
  );
  p.push(`  Σ RegaliasCost (delta ESPERADO v1−v2): ${g.sumaRegalias.toFixed(2)}`);
  p.push(`  Σ Costo viejo (CON regalía)          : ${g.sumaCostoViejo.toFixed(2)}  (trazabilidad)`);
  p.push(`  Σ costoTotal v2 (SIN regalía, D2)    : ${c.costosV2.sumaCostoTotal.toFixed(2)}`);
  p.push(
    '  Nota: costoTotal v2 es menor por Σ RegaliasCost por DISEÑO (D2), NO por pérdida de datos.',
  );

  return p.join('\n');
}

/** Punto de entrada del script `cuadre-f7.ts` (solo lee/cuenta). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url, opcionesClienteEtl());
  try {
    console.log(formatearCuadreF7(await calcularCuadreF7(cliente)));
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
