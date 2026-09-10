/**
 * Utilidades compartidas de las pantallas de CxP (F9-E2). Vive aparte de los componentes para no
 * mezclar exportaciones de funciones con las de componentes (regla fast-refresh).
 */
import type { CxpBandejaQuery, CxpOrigen } from '@/api/tipos';

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

/**
 * ⭐ LOS DÍAS VENCIDOS de un proveedor, como TEXTO de su celda.
 *
 * **La definición ÚNICA de esta redacción** (fila 0.186): la usan la BANDEJA de CxP y la CORRIDA
 * semanal de pagos (`modulos/pagos/comun.ts` la envuelve para su fila, que además tiene el caso
 * «concepto»). Vive aquí, del lado de CxP, porque el número lo calcula CxP
 * (`dominio/terceros/dias-vencidos.ts`) y pagos lo consume — la misma dirección que ya tiene la
 * dependencia en el backend. Copiarla en cada pantalla sería dejar que la lista del viernes y la
 * corrida del jueves llamaran distinto al mismo proveedor.
 *
 * Los tres estados dicen cosas DISTINTAS y por eso no se colapsan en uno:
 *  • `null` → **«—»**: no hay nada que envejecer (no debe, o los pagos ya lo cubrieron);
 *  • `0` → **«al día»**: sí debe, pero está dentro de su plazo;
 *  • `n > 0` → **«n d»**: su cargo más viejo sin pagar lleva `n` días vencido.
 *
 * ⚠️ Un «0» a secas se leería como «no debe nada», que es justo lo contrario de lo que significa.
 * Y el número lo calcula el SERVIDOR (A1: nada de restar fechas en el cliente); aquí sólo se redacta.
 */
export function textoDiasVencidos(dias: number | null): string {
  if (dias === null) {
    return '—';
  }
  if (dias === 0) {
    return 'al día';
  }
  return `${String(dias)} d`;
}

/** Fecha de hoy en formato YYYY-MM-DD (default de los campos fecha). */
export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Etiquetas legibles de los orígenes capturables de CxP (para el formulario y la tabla). */
export const ETIQUETAS_ORIGEN_CXP: Record<CxpOrigen, string> = {
  entrada_sin_factura: 'Entrada sin factura (cargo)',
  nota_credito: 'Nota de crédito',
  pago: 'Pago',
  abono: 'Abono',
  descuento: 'Descuento',
};

/** Etiqueta de un origen del libro (incluye los del motor/EsMa que la captura de CxP no ofrece). */
export function etiquetaOrigen(origen: string): string {
  const otros: Record<string, string> = {
    recibo_maquila: 'Recibo de maquila',
    factura_proveedor: 'Factura de proveedor',
  };
  return (ETIQUETAS_ORIGEN_CXP as Record<string, string>)[origen] ?? otros[origen] ?? origen;
}

// ── SEGMENTO con/sin factura (fila 0.132, §Post-F9.192(5)) ───────────────────────────────────────
//
// Daniel, sobre la bandeja del viernes ("a quién le debo"): *"debería partirse en Con factura / Sin
// factura, con totales y antigüedad por separado, porque son dos relaciones de pago distintas"*. Es
// el MISMO vocabulario que ya usan el estado de cuenta del proveedor y la corrida semanal de pagos.

/**
 * Los tres segmentos, tomados del CONTRATO (no re-escritos): si el backend añadiera o quitara uno,
 * el `Record` de abajo dejaría de compilar en vez de quedarse callado con una etiqueta de menos.
 */
export type SegmentoCxp = NonNullable<CxpBandejaQuery['segmento']>;

/** Etiqueta legible de cada segmento — una sola vez: chips, títulos y mensajes vacíos dicen lo mismo. */
export const TITULOS_SEGMENTO_CXP: Record<SegmentoCxp, string> = {
  todos: 'Con y sin factura',
  con: 'Con factura',
  sin: 'Sin factura',
};

/**
 * ¿El texto es un segmento válido? Se usa con lo que llega de FUERA del código —el `?segmento=` de la
 * URL (que el usuario puede teclear) y el `state` del router—: sin esta guarda, un valor inventado
 * viajaría al API y volvería como un 400 en una pantalla que se abrió por un enlace.
 */
export function esSegmentoCxp(valor: string | null | undefined): valor is SegmentoCxp {
  return valor === 'todos' || valor === 'con' || valor === 'sin';
}
