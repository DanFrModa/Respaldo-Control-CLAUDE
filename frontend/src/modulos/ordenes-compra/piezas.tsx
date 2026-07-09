import type { EstatusOrdenCompra } from '@/api/tipos';
import { ChipEstado, type TonoEstado } from '@/components/dominio/ChipEstado';

/**
 * Piezas compartidas del módulo ÓRDENES DE COMPRA (F4-E2): el chip de estatus y los helpers de
 * presentación que reusan el listado, la captura y la bandeja de autorización. SOLO presentación
 * (A1): el estatus lo deriva y controla el backend; aquí únicamente se pinta. El chip usa los tonos
 * semánticos del rediseño (ChipEstado) para leerse igual que en el resto de la app.
 */

/** Etiqueta legible (es) de cada estatus de OC. */
export const ETIQUETA_ESTATUS_OC: Record<EstatusOrdenCompra, string> = {
  borrador: 'Borrador',
  pendiente_autorizacion: 'Pendiente',
  autorizada: 'Autorizada',
  recibida_parcial: 'Recibida parcial',
  recibida_total: 'Recibida total',
  cancelada: 'Cancelada',
};

/** Tono semántico por estatus (borrador apagado; pendiente atención; recibida total = ok; cancelada crítica). */
const TONO_ESTATUS: Record<EstatusOrdenCompra, TonoEstado> = {
  borrador: 'neutro',
  pendiente_autorizacion: 'warn',
  autorizada: 'info',
  recibida_parcial: 'info',
  recibida_total: 'ok',
  cancelada: 'crit',
};

/** Chip del estatus DERIVADO de una orden de compra. */
export function EstatusOcBadge({ estatus }: { estatus: EstatusOrdenCompra }): React.JSX.Element {
  return (
    <ChipEstado tono={TONO_ESTATUS[estatus]} data-testid="estatus-oc">
      {ETIQUETA_ESTATUS_OC[estatus]}
    </ChipEstado>
  );
}

/** Formatea una fecha date-only `YYYY-MM-DD` como "13 jun 2026" sin desfase de zona. */
export function fechaCortaOc(valor: string | null): string {
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

/** Descripción legible del material de un renglón (tela / avío / libre). */
export function descripcionMaterial(linea: {
  tela: string | null;
  avio: string | null;
  descripcionLibre: string | null;
}): string {
  return linea.tela ?? linea.avio ?? linea.descripcionLibre ?? 'Renglón sin material';
}
