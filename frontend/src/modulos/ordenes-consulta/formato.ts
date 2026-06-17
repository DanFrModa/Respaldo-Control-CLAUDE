/**
 * Formateo compartido de las vistas de CONSULTA de órdenes (F2-E4). Vive aparte de `piezas.tsx`
 * (que exporta componentes) para no romper el fast-refresh de Vite.
 */

/** Formatea una fecha date-only `YYYY-MM-DD` como "30 jun 2026" sin desfase de zona. */
export function fechaCorta(valor: string | null): string {
  if (valor === null) {
    return '—';
  }
  const [a, m, d] = valor.split('-').map(Number);
  if (a === undefined || m === undefined || d === undefined) {
    return '—';
  }
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
