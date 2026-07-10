/**
 * Utilidades compartidas de la pantalla de Reportes fiscales (F9-E5). Vive aparte de los componentes
 * para no mezclar exportaciones de funciones con las de componentes (regla fast-refresh).
 */

/**
 * Formatea un importe en pesos (o "—" si es `null`). El backend devuelve `null` cuando el usuario NO
 * tiene `consultas.ver-importes` (ocultamiento de importes).
 */
export function moneda(monto: number | null): string {
  if (monto === null) {
    return '—';
  }
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);
}

/** Etiquetas legibles de los orígenes/conceptos del libro de terceros (para la columna "Concepto"). */
const ETIQUETAS_ORIGEN: Record<string, string> = {
  factura_proveedor: 'Factura de proveedor',
  factura_cliente: 'Factura de venta',
  entrada_sin_factura: 'Entrada sin factura',
  recibo_maquila: 'Recibo de maquila',
  nota_credito: 'Nota de crédito',
  pago: 'Pago',
  abono: 'Abono',
  descuento: 'Descuento',
};

/** Etiqueta de un origen (cae al valor crudo si no lo conoce). */
export function etiquetaOrigen(origen: string): string {
  return ETIQUETAS_ORIGEN[origen] ?? origen;
}
