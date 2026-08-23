import type { EstadoDesarrollo } from '@/api/liga-orden';

/**
 * Etiquetas y variantes de badge por ESTADO DERIVADO de un desarrollo (F8). Se comparten entre la
 * sección "Desarrollo" del detalle de la orden (F8-E6) y el tablero por estado. El estado lo deriva
 * el backend (A1); aquí sólo se presenta.
 */

/** Etiqueta legible por estado derivado del desarrollo. */
export const ETIQUETA_ESTADO_DESARROLLO: Record<EstadoDesarrollo, string> = {
  'en-desarrollo': 'En desarrollo',
  cotizado: 'Cotizado',
  'en-lista': 'En lista',
  'ligado-produccion': 'Ligado a producción',
  apagado: 'Apagado',
};

/** Variante de badge por estado derivado. */
export const VARIANTE_ESTADO_DESARROLLO: Record<
  EstadoDesarrollo,
  'default' | 'secondary' | 'outline'
> = {
  'en-desarrollo': 'secondary',
  cotizado: 'default',
  'en-lista': 'default',
  'ligado-produccion': 'default',
  apagado: 'outline',
};

/** Estados en el orden de despliegue del tablero (apagado al final). */
export const ORDEN_ESTADOS_DESARROLLO: readonly EstadoDesarrollo[] = [
  'en-desarrollo',
  'cotizado',
  'en-lista',
  'ligado-produccion',
  'apagado',
];
