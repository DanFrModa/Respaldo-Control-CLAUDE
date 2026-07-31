/**
 * Utilidades compartidas de las pantallas de CxC (F9-E4). Vive aparte de los componentes para no
 * mezclar exportaciones de funciones con las de componentes (regla fast-refresh).
 */
import type { CxcOrigen } from '@/api/tipos';

/**
 * Formatea un importe en pesos (o "—" si es `null`). El backend devuelve `null` cuando el usuario NO
 * tiene `consultas.ver-importes`, así que "—" es el ocultamiento de importes.
 */
export function moneda(monto: number | null): string {
  if (monto === null) {
    return '—';
  }
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);
}

/** Importe de una cubeta de aging: "—" atenuado si es 0/null (como el proto). */
export function celdaAging(monto: number | null): string {
  if (monto === null || Math.abs(monto) < 0.005) {
    return '—';
  }
  return moneda(monto);
}

/** Fecha de hoy en formato YYYY-MM-DD (default de los campos fecha). */
export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Etiquetas legibles de los orígenes capturables de CxC (para el formulario y la tabla). */
export const ETIQUETAS_ORIGEN_CXC: Record<CxcOrigen, string> = {
  entrada_sin_factura: 'Cargo sin factura (venta)',
  nota_credito: 'Nota de crédito',
  pago: 'Cobro',
  abono: 'Abono',
  descuento: 'Descuento',
};

/** Etiqueta de un origen del libro (incluye los del motor que la captura de CxC no ofrece). */
export function etiquetaOrigen(origen: string): string {
  const otros: Record<string, string> = {
    factura_cliente: 'Factura de venta',
    recibo_maquila: 'Recibo de maquila',
    factura_proveedor: 'Factura de proveedor',
  };
  return (ETIQUETAS_ORIGEN_CXC as Record<string, string>)[origen] ?? otros[origen] ?? origen;
}
