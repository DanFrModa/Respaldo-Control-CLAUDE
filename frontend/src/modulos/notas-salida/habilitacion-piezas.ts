import type { EstadoHabilitacion, HabilitacionAvio } from '@/api/tipos';
import type { TonoEstado } from '@/components/dominio/ChipEstado';

/**
 * Piezas compartidas de la HABILITACIÓN / SURTIDO de avíos por orden (rediseño R6, B13 — §4.6). SOLO
 * presentación (A1): el estado por avío (completo/parcial/pendiente/sobre-surtido/extra) y las
 * cantidades las decide el backend; aquí sólo se pintan y se calcula el default de "A surtir".
 */

/** Etiqueta legible (es) del estado de surtido de un avío. */
export const ETIQUETA_ESTADO_HAB: Record<EstadoHabilitacion, string> = {
  completo: 'Completo',
  parcial: 'Parcial',
  pendiente: 'Pendiente',
  'sobre-surtido': 'Sobre-surtido',
  extra: 'Extra',
};

/** Tono semántico del chip por estado (sobre-surtido/extra en INFO, no alarma). */
export function tonoEstadoHab(estado: EstadoHabilitacion): TonoEstado {
  switch (estado) {
    case 'completo':
      return 'ok';
    case 'parcial':
      return 'warn';
    case 'sobre-surtido':
    case 'extra':
      return 'info';
    case 'pendiente':
    default:
      return 'neutro';
  }
}

/** Color de la barra de avance por estado (mismo criterio que el chip). */
export function claseBarraHab(estado: EstadoHabilitacion): string {
  switch (estado) {
    case 'completo':
      return 'bg-ok';
    case 'parcial':
      return 'bg-warn';
    case 'sobre-surtido':
    case 'extra':
      return 'bg-info';
    case 'pendiente':
    default:
      return 'bg-border-strong';
  }
}

/**
 * Cantidad "A surtir" por defecto de un renglón: la FALTA (0 en completos/extras). El re-envío se
 * captura escribiendo una cantidad aunque la falta sea 0 (decisión de Daniel — sobre-surtido válido).
 */
export function aSurtirDefault(avio: HabilitacionAvio): number {
  return avio.esExtra ? 0 : avio.falta;
}
