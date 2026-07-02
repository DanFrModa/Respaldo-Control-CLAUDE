/**
 * Utilidades compartidas de las pantallas de EsMa (F6-E4). Vive aparte de los componentes para no
 * mezclar exportaciones de funciones con las de componentes (regla fast-refresh).
 */

/**
 * Formatea un importe en pesos (o "—" si es `null`). El backend devuelve `null` cuando el usuario
 * NO tiene `consultas.ver-importes`, así que "—" es el ocultamiento de importes.
 */
export function moneda(monto: number | null): string {
  if (monto === null) {
    return '—';
  }
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);
}
