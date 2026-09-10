/**
 * Las ETAPAS del panel de avance de producción, como DATOS (V1-E3a).
 *
 * Viven en su propio módulo —sin componentes— porque las consumen dos pantallas: el panel
 * (`AvanceProduccion`, que les pone etiqueta y orden) y el Centro de Órdenes, que valida con
 * `esClaveEtapaAvance` la etapa que llega en el `state` de un deep-link (hoy desde la bandeja de la
 * Ruta Crítica: un pendiente de "recibo de estampado" debe aterrizar en SU etapa, no en Corte).
 * Nunca se confía en el `state` de la navegación: se valida contra estas claves.
 */

/**
 * Clave de cada etapa del stepper, en el orden del flujo.
 *
 * ⭐ `empaque` (0.114) va ENTRE el recibo de arte y la entrega a cliente, que es su lugar real en el
 * taller: se empaca lo que ya volvió terminado, justo antes de mandarlo. Es un SERVICIO sobre la
 * orden —no toca inventario y su cantidad es propia— pero se captura como cualquier otra etapa.
 */
export const CLAVES_ETAPA_AVANCE = [
  'corte',
  'entrega-maquila',
  'recibo-maquila',
  'entrega-aplicacion',
  'recibo-aplicacion',
  'empaque',
  'entrega-cliente',
] as const;

/** Una etapa del panel de avance. */
export type ClaveEtapaAvance = (typeof CLAVES_ETAPA_AVANCE)[number];

/** ¿El valor es una clave de etapa del panel? (valida el `state` de un deep-link). */
export function esClaveEtapaAvance(valor: unknown): valor is ClaveEtapaAvance {
  return typeof valor === 'string' && (CLAVES_ETAPA_AVANCE as readonly string[]).includes(valor);
}
