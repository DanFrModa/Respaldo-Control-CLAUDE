/**
 * ANTIGÜEDAD DE SALDOS (aging) de CxC (F9-E4; D15d) — la MECÁNICA pura vive en `../aging-comun.ts`
 * (compartida con CxP/F9-E2, SIN copiar-pegar); aquí solo se fijan los LÍMITES de las cubetas de CxC y
 * se re-exporta la mecánica con esos límites. Los límites VIVOS son configurables por empresa desde
 * F9-E5 (`config-aging.ts`); este `LIMITES_AGING_CXC` es solo el DEFAULT (30/60) que aún usan la pieza
 * pura re-exportada y sus tests. A diferencia de CxP, CxC no tiene cubeta "maquila" (los clientes no maquilan).
 */
import {
  LIMITES_AGING_DEFECTO,
  cubetaPorAtraso as cubetaPorAtrasoComun,
  netearCubetas,
  type CubetasAging,
  type CubetasBrutas,
} from '../aging-comun.js';

export { netearCubetas };
export type { CubetasAging, CubetasBrutas };

/** Límites (en días de atraso) de las cubetas de aging de CxC. UN SOLO lugar de verdad (E5 = config). */
export const LIMITES_AGING_CXC = LIMITES_AGING_DEFECTO;

/**
 * Clasifica un cargo de CxC en su cubeta por sus DÍAS DE ATRASO, con los {@link LIMITES_AGING_CXC}.
 * ≤ 0 → corriente; 1..30 → d1a30; 31..60 → d31a60; > 60 → mas60.
 */
export function cubetaPorAtraso(diasAtraso: number): keyof CubetasAging {
  return cubetaPorAtrasoComun(diasAtraso, LIMITES_AGING_CXC);
}
