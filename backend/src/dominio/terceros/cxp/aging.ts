/**
 * ANTIGÜEDAD DE SALDOS (aging) de CxP — pieza PURA y testeable (F9-E2; D15d). Aquí viven, en UN SOLO
 * lugar, los LÍMITES de las cubetas (E2 los deja fijos; E5 los hará configurables) y la mecánica de
 * netear los abonos/pagos contra las cubetas. Sin BD, sin permisos, sin fechas del reloj: recibe los
 * montos ya agregados por el servicio y devuelve las cuatro cubetas netas.
 *
 * Convención (misma del proto `vCxp`): `saldo = corriente + d1a30 + d31a60 + mas60`, con `vencido =
 * d1a30 + d31a60 + mas60`. La cubeta se decide por los DÍAS DE ATRASO sobre `fechaVencimiento` (fecha
 * del cargo + días de crédito del proveedor). "Vencido HOY" = 0 días de atraso = todavía CORRIENTE
 * (el contado, 0 días de crédito, vence el mismo día → corriente ese día).
 *
 * NETEO de créditos (abonos/pagos/notas de crédito, que no tienen fecha de vencimiento): se aplican de
 * MÁS VIEJO A MÁS NUEVO (+60 → 31–60 → 1–30 → corriente) — la convención estándar de AP (un pago sin
 * asignar salda primero lo más atrasado). Si el crédito supera todos los cargos (sobrepago / saldo a
 * favor), la última cubeta (corriente) queda NEGATIVA: `saldo` neto = negativo, coherente con D3.
 */

/** Límites (en días de atraso) de las cubetas de aging de CxP. UN SOLO lugar de verdad (E5 = config). */
export const LIMITES_AGING_CXP = {
  /** Fin de la cubeta "1–30 días" (atraso ≤ 30). */
  d30: 30,
  /** Fin de la cubeta "31–60 días" (atraso ≤ 60); más allá cae en "+60". */
  d60: 60,
} as const;

/** Las cuatro cubetas de antigüedad de un proveedor (importes con signo, netos de créditos). */
export interface CubetasAging {
  /** No vencido (atraso ≤ 0), neto de los créditos que ya no alcanzaron cubetas vencidas. */
  corriente: number;
  /** Vencido 1–30 días. */
  d1a30: number;
  /** Vencido 31–60 días. */
  d31a60: number;
  /** Vencido +60 días. */
  mas60: number;
}

/** Cargos ya agregados por cubeta (BRUTOS, antes de netear créditos) + el total de créditos a aplicar. */
export interface CubetasBrutas {
  /** Σ cargos NO vencidos (atraso ≤ 0). */
  corriente: number;
  /** Σ cargos vencidos 1–30 días. */
  d1a30: number;
  /** Σ cargos vencidos 31–60 días. */
  d31a60: number;
  /** Σ cargos vencidos +60 días. */
  mas60: number;
  /** Total POSITIVO de créditos (abonos/pagos/NC) a netear de más viejo a más nuevo. */
  creditos: number;
}

/** Redondeo monetario a 2 decimales. */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Clasifica un cargo en su cubeta por sus DÍAS DE ATRASO (`hoy − fechaVencimiento`). ≤ 0 → corriente;
 * 1..30 → d1a30; 31..60 → d31a60; > 60 → mas60. Usa {@link LIMITES_AGING_CXP} (un solo lugar).
 */
export function cubetaPorAtraso(diasAtraso: number): keyof CubetasAging {
  if (diasAtraso <= 0) {
    return 'corriente';
  }
  if (diasAtraso <= LIMITES_AGING_CXP.d30) {
    return 'd1a30';
  }
  if (diasAtraso <= LIMITES_AGING_CXP.d60) {
    return 'd31a60';
  }
  return 'mas60';
}

/**
 * Netea los créditos contra las cubetas brutas de MÁS VIEJO A MÁS NUEVO y devuelve las cuatro cubetas
 * netas. Se cumple `corriente + d1a30 + d31a60 + mas60 = (Σ cargos) − creditos = saldo`. El sobrepago
 * empuja `corriente` a negativo (saldo a favor).
 *
 * NOTA (aplicación SUPUESTA de créditos, S2): los abonos/pagos NO están amarrados a un cargo concreto
 * (el motor no liga pago↔factura todavía), así que el reparto "más viejo primero" es una CONVENCIÓN de
 * presentación, no la asignación real. En consecuencia, una cubeta puede quedar sobre/subestimada
 * frente al emparejamiento real factura-pago; el `saldo` TOTAL siempre es exacto. Es aceptable hasta
 * que exista aplicación explícita de pagos (fase posterior); el total —lo que decide a quién pagar—
 * nunca se ve afectado.
 */
export function netearCubetas(brutas: CubetasBrutas): CubetasAging {
  let restante = brutas.creditos;
  const neta: CubetasAging = {
    corriente: brutas.corriente,
    d1a30: brutas.d1a30,
    d31a60: brutas.d31a60,
    mas60: brutas.mas60,
  };
  // Orden de aplicación: lo más atrasado primero; el remanente cae al final en corriente (puede ser <0).
  for (const cubeta of ['mas60', 'd31a60', 'd1a30'] as const) {
    if (restante <= 0) {
      break;
    }
    const aplica = Math.min(restante, neta[cubeta]);
    neta[cubeta] = redondear2(neta[cubeta] - aplica);
    restante = redondear2(restante - aplica);
  }
  // El remanente (crédito que sobra, o cargos negativos por inversos) ajusta corriente sin piso.
  neta.corriente = redondear2(neta.corriente - restante);
  return neta;
}
