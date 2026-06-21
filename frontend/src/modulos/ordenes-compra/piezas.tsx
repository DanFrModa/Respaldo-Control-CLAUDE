import type { EstatusOrdenCompra } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';

/**
 * Piezas compartidas del módulo ÓRDENES DE COMPRA (F4-E2): el badge de estatus y los helpers de
 * presentación que reusan el listado, la captura y la bandeja de autorización. SOLO presentación
 * (A1): el estatus lo deriva y controla el backend; aquí únicamente se pinta.
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

/** Variante del badge por estatus (cancelada = destructiva; autorizada/recibida = sólida). */
function varianteEstatus(
  estatus: EstatusOrdenCompra,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (estatus === 'cancelada') {
    return 'destructive';
  }
  if (estatus === 'autorizada' || estatus === 'recibida_total') {
    return 'default';
  }
  if (estatus === 'recibida_parcial') {
    return 'outline';
  }
  return 'secondary';
}

/** Badge del estatus DERIVADO de una orden de compra. */
export function EstatusOcBadge({ estatus }: { estatus: EstatusOrdenCompra }): React.JSX.Element {
  return (
    <Badge variant={varianteEstatus(estatus)} data-testid="estatus-oc">
      {ETIQUETA_ESTATUS_OC[estatus]}
    </Badge>
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
