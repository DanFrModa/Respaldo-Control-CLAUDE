/**
 * Helpers de aritmética monetaria COMPARTIDOS del módulo de costos (F7/F8). Se extraen aquí para que
 * el pre-costo "al vuelo" de F7 (`pre-costo.ts`) y el precosto PERSISTIDO de F8-E3 (`../desarrollo/
 * precostos.ts`) usen EXACTAMENTE la misma aritmética/redondeo (A1: no duplicar el cálculo). Son
 * funciones puras sin dependencias de BD (las ejercitan los tests de ambos módulos).
 */
import type { Prisma } from '../../datos/index.js';

/** Redondeo monetario a 2 decimales (evita artefactos de float en las sumas). */
export function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Nº de un `Decimal` opcional (null → 0). Patrón ceronulo (para sumar importes/consumos). */
export function num(d: Prisma.Decimal | null | undefined): number {
  return d == null ? 0 : d.toNumber();
}

/** Nº de un `Decimal` opcional CONSERVANDO el null (para la cascada de resolución de precios). */
export function numOrNull(d: Prisma.Decimal | null | undefined): number | null {
  return d == null ? null : d.toNumber();
}
