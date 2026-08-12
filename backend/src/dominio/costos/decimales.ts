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

/**
 * Redondeo a 4 decimales: la escala de las columnas de CONSUMO/cantidad (`Decimal(12,4)`), que
 * llevan más precisión que el dinero. Vive junto a {@link redondear2} para que no se reinvente:
 * la regla es la misma en las dos escalas — **lo que se guarda y lo que se usa para derivar
 * (importe = consumo × precio) tienen que ser EL MISMO número**. Si un promedio o un valor tecleado
 * llega con más decimales de los que la columna puede guardar, Postgres lo REDONDEA (half away from
 * zero, no trunca) al escribirlo y
 * el derivado calculado con el valor completo deja de cuadrar contra lo que el usuario ve.
 */
export function redondear4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Nº de un `Decimal` opcional (null → 0). Patrón ceronulo (para sumar importes/consumos). */
export function num(d: Prisma.Decimal | null | undefined): number {
  return d == null ? 0 : d.toNumber();
}

/** Nº de un `Decimal` opcional CONSERVANDO el null (para la cascada de resolución de precios). */
export function numOrNull(d: Prisma.Decimal | null | undefined): number | null {
  return d == null ? null : d.toNumber();
}
