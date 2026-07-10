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

/** Formatea una fecha date-only `YYYY-MM-DD` como "30 jun 2026" sin desfase de zona (o "—"). */
export function fechaCorta(valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') {
    return '—';
  }
  const [a, m, d] = valor.split('-').map(Number);
  if (a === undefined || m === undefined || d === undefined || Number.isNaN(a + m + d)) {
    return '—';
  }
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Etiqueta legible de una base de prorrateo. */
export function etiquetaBase(base: 'cortado' | 'recibido' | 'vendido'): string {
  return base === 'cortado'
    ? 'Cortado'
    : base === 'recibido'
      ? 'Recibido (costura)'
      : 'Vendido (entregado)';
}
