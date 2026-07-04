/**
 * Helpers de presentación del módulo EDR (F7-E2). Módulo de DATOS (no componentes) para no romper
 * fast-refresh. Todo el EDR es financiero (no hay ocultamiento de importes): los números siempre se
 * muestran.
 */

/** Formatea un importe en pesos MXN. */
export function moneda(monto: number | null | undefined): string {
  if (monto === null || monto === undefined) {
    return '—';
  }
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);
}

/** Nombres de mes en español (índice 0 = Enero). */
export const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

/** Etiqueta legible de un mes 1-12 + año. */
export function etiquetaMes(mes: number, anio: number): string {
  return `${MESES[mes - 1] ?? mes} ${anio}`;
}

/** Etiqueta legible del origen de una línea. */
export function etiquetaOrigen(origen: 'automatica' | 'ajustada' | 'manual'): string {
  return origen === 'automatica' ? 'Automática' : origen === 'ajustada' ? 'Ajustada' : 'Manual';
}
