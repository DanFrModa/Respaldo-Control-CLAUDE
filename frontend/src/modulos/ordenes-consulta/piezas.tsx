import type { EstadoOrden, SemaforoOrden } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';

/**
 * Piezas compartidas (COMPONENTES) de las vistas de CONSULTA de órdenes (F2-E4): el badge del estado
 * derivado y el punto del semáforo de antigüedad. El formateo de fechas vive en `formato.ts` (no es
 * componente). CERO lógica de negocio: el estado y el semáforo los DERIVA el backend; aquí solo se
 * PRESENTAN (A1).
 */

/** Texto + variante del badge de estado DERIVADO de la orden. */
function badgeEstado(estado: EstadoOrden): {
  texto: string;
  variante: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  if (estado === 'completa') {
    return { texto: 'Completa', variante: 'default' };
  }
  if (estado === 'cancelada') {
    return { texto: 'Cancelada', variante: 'destructive' };
  }
  if (estado === 'cerrada') {
    // 0.061: la orden terminó su vida administrativa y su costo quedó CONGELADO. `outline` la
    // distingue de la cancelada (que es un fracaso) sin gritar: cerrar es el final NORMAL.
    return { texto: 'Cerrada', variante: 'outline' };
  }
  return { texto: 'Capturada', variante: 'secondary' };
}

/** Badge del estado de una orden (estado derivado por el backend). */
export function EstadoOrdenBadge({ estado }: { estado: EstadoOrden }): React.JSX.Element {
  const { texto, variante } = badgeEstado(estado);
  return (
    <Badge variant={variante} data-testid="estado-orden">
      {texto}
    </Badge>
  );
}

/** Color de relleno del punto del semáforo (verde/amarillo/urgente). */
const COLOR_SEMAFORO: Record<SemaforoOrden, string> = {
  verde: 'bg-emerald-500',
  amarillo: 'bg-amber-500',
  urgente: 'bg-red-600',
};

/** Etiqueta legible del semáforo (para el title/aria). */
const ETIQUETA_SEMAFORO: Record<SemaforoOrden, string> = {
  verde: 'A tiempo',
  amarillo: 'Atención',
  urgente: 'Urgente',
};

/**
 * Indicador de SEMÁFORO de antigüedad de una orden incompleta: un punto de color + la etiqueta. El
 * valor lo DERIVA el backend (> 7 días = urgente); aquí solo se pinta.
 */
export function SemaforoBadge({ semaforo }: { semaforo: SemaforoOrden }): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm"
      data-testid="semaforo"
      data-semaforo={semaforo}
    >
      <span
        aria-hidden
        className={`inline-block size-2.5 rounded-full ${COLOR_SEMAFORO[semaforo]}`}
      />
      {ETIQUETA_SEMAFORO[semaforo]}
    </span>
  );
}
