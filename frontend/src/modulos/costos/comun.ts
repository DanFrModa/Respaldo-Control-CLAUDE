/**
 * Helpers de presentación del módulo Costos (F7-E1). Módulo de DATOS (no componentes) para no romper
 * fast-refresh. Los importes/márgenes que el backend oculta (sin `consultas.ver-importes`) llegan en
 * `null` → se muestran como "—".
 */

/** Formatea un importe en pesos MXN (o "—" si es null). */
export function moneda(monto: number | null | undefined): string {
  if (monto === null || monto === undefined) {
    return '—';
  }
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);
}

/** Formatea una fracción (0.30) como porcentaje ("30.0%"), o "—" si es null. */
export function porcentaje(fraccion: number | null | undefined): string {
  if (fraccion === null || fraccion === undefined) {
    return '—';
  }
  return `${(fraccion * 100).toLocaleString('es-MX', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/** Etiqueta legible de una base de prorrateo. */
export function etiquetaBase(base: 'cortado' | 'recibido' | 'vendido'): string {
  return base === 'cortado'
    ? 'Cortado'
    : base === 'recibido'
      ? 'Recibido (costura)'
      : 'Vendido (entregado)';
}
