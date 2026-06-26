/**
 * Seed de CALIDAD (F6-E1) — IDEMPOTENTE (upserts por clave natural):
 *
 *  1. Una lista CORTA de TIPOS DE PRODUCTO de arranque (decisión (d)): Daniel entregará la lista
 *     real; estos son un punto de partida editable. Se siembran por `nombre`, sin pisar `activo`.
 *  2. UN plan de muestreo AQL default basado en ISO 2859-1 nivel general II (AQL 1.0 / 2.5 / 10),
 *     cargado como DATOS (tabla simple, sin motor estadístico — "no sobre-diseñar"). Es el único
 *     plan default activo (decisión (c)). Se siembra por `nombre`; si ya existe NO se re-escriben
 *     sus renglones (pudieron ajustarse en producción).
 *
 * NO siembra defectos (los 40 reales los carga el ETL de F6-E6). Los PERMISOS nuevos
 * (`calidad.ver`/`calidad.administrar-catalogo`/`admin.ver-bitacora`) ya entran por el seed de
 * permisos general (sincroniza el catálogo de `src/contrato`).
 */
import type { PrismaClient } from '../src/datos/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de producto base (lista corta y editable — decisión (d))
// ─────────────────────────────────────────────────────────────────────────────

const TIPOS_PRODUCTO_BASE: string[] = [
  'Playera',
  'Pantalón',
  'Sudadera',
  'Ropa interior',
  'Vestido',
  'Short',
  'Conjunto',
];

async function sembrarTiposProducto(prisma: PrismaClient): Promise<void> {
  for (const nombre of TIPOS_PRODUCTO_BASE) {
    await prisma.tipoProducto.upsert({
      where: { nombre },
      // No se pisa el activo si ya existe (pudo editarse/desactivarse en producción).
      update: {},
      create: { nombre },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan AQL default — ISO 2859-1, nivel general II, inspección normal (single)
// ─────────────────────────────────────────────────────────────────────────────

/** Nombre del plan default (clave natural del upsert). */
const NOMBRE_PLAN_DEFAULT = 'ISO 2859 — Nivel general II';

/**
 * Tabla de muestreo del plan default. Cada renglón es un RANGO de tamaño de lote → tamaño de
 * muestra (columna "code letter" → sample size de ISO 2859-1, nivel general II) y, por cada nivel
 * AQL (1.0 / 2.5 / 10), su par aceptar/rechazar (Ac/Re) de la tabla de inspección normal single.
 * Valores de la norma ISO 2859-1 (equivalente a ANSI/ASQ Z1.4). El último rango es abierto
 * (`loteMax: null`).
 */
const RENGLONES_PLAN_DEFAULT: {
  loteMin: number;
  loteMax: number | null;
  tamanoMuestra: number;
  // [aceptar, rechazar] por nivel: [AQL 1.0, AQL 2.5, AQL 10]
  aql1: [number, number];
  aql25: [number, number];
  aql10: [number, number];
}[] = [
  // lote 2–8 → letra A, muestra 2
  { loteMin: 2, loteMax: 8, tamanoMuestra: 2, aql1: [0, 1], aql25: [0, 1], aql10: [0, 1] },
  // lote 9–15 → letra B, muestra 3
  { loteMin: 9, loteMax: 15, tamanoMuestra: 3, aql1: [0, 1], aql25: [0, 1], aql10: [0, 1] },
  // lote 16–25 → letra C, muestra 5
  { loteMin: 16, loteMax: 25, tamanoMuestra: 5, aql1: [0, 1], aql25: [0, 1], aql10: [1, 2] },
  // lote 26–50 → letra D, muestra 8
  { loteMin: 26, loteMax: 50, tamanoMuestra: 8, aql1: [0, 1], aql25: [0, 1], aql10: [2, 3] },
  // lote 51–90 → letra E, muestra 13
  { loteMin: 51, loteMax: 90, tamanoMuestra: 13, aql1: [0, 1], aql25: [1, 2], aql10: [3, 4] },
  // lote 91–150 → letra F, muestra 20
  { loteMin: 91, loteMax: 150, tamanoMuestra: 20, aql1: [0, 1], aql25: [1, 2], aql10: [5, 6] },
  // lote 151–280 → letra G, muestra 32
  { loteMin: 151, loteMax: 280, tamanoMuestra: 32, aql1: [1, 2], aql25: [2, 3], aql10: [7, 8] },
  // lote 281–500 → letra H, muestra 50
  { loteMin: 281, loteMax: 500, tamanoMuestra: 50, aql1: [1, 2], aql25: [3, 4], aql10: [10, 11] },
  // lote 501–1200 → letra J, muestra 80
  { loteMin: 501, loteMax: 1200, tamanoMuestra: 80, aql1: [2, 3], aql25: [5, 6], aql10: [14, 15] },
  // lote 1201–3200 → letra K, muestra 125
  {
    loteMin: 1201,
    loteMax: 3200,
    tamanoMuestra: 125,
    aql1: [3, 4],
    aql25: [7, 8],
    aql10: [21, 22],
  },
  // lote 3201+ → letra L, muestra 200 (rango abierto)
  {
    loteMin: 3201,
    loteMax: null,
    tamanoMuestra: 200,
    aql1: [5, 6],
    aql25: [10, 11],
    aql10: [21, 22],
  },
];

async function sembrarPlanDefault(prisma: PrismaClient): Promise<void> {
  // Idempotente: si el plan ya existe NO se re-escriben sus renglones (pudieron ajustarse).
  const existente = await prisma.planMuestreoAQL.findUnique({
    where: { nombre: NOMBRE_PLAN_DEFAULT },
    select: { id: true },
  });
  if (existente !== null) {
    return;
  }

  const plan = await prisma.planMuestreoAQL.create({
    data: { nombre: NOMBRE_PLAN_DEFAULT, activo: true },
  });

  for (const r of RENGLONES_PLAN_DEFAULT) {
    await prisma.planMuestreoRenglon.create({
      data: {
        idPlan: plan.id,
        loteMin: r.loteMin,
        loteMax: r.loteMax,
        tamanoMuestra: r.tamanoMuestra,
        limites: {
          create: [
            { nivelAQL: 1, aceptar: r.aql1[0], rechazar: r.aql1[1] },
            { nivelAQL: 2.5, aceptar: r.aql25[0], rechazar: r.aql25[1] },
            { nivelAQL: 10, aceptar: r.aql10[0], rechazar: r.aql10[1] },
          ],
        },
      },
    });
  }
}

/** Siembra los catálogos de Calidad (tipos de producto + plan AQL default). Idempotente. */
export async function sembrarCalidad(prisma: PrismaClient): Promise<void> {
  await sembrarTiposProducto(prisma);
  await sembrarPlanDefault(prisma);
}
