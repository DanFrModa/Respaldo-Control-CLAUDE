import type { EstatusNotaSalida, NotaSalidaLinea } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';

/**
 * Piezas compartidas del módulo NOTAS DE SALIDA (F4-E5): el badge de estatus y los helpers de
 * presentación que reusan el listado, la captura y las consultas. SOLO presentación (A1): el estatus
 * lo controla el backend (borrador → confirmada / cancelada); aquí únicamente se pinta.
 */

/** Etiqueta legible (es) de cada estatus de nota de salida. */
export const ETIQUETA_ESTATUS_NOTA: Record<EstatusNotaSalida, string> = {
  borrador: 'Borrador',
  confirmada: 'Confirmada',
  cancelada: 'Cancelada',
};

/** Variante del badge por estatus (cancelada = destructiva; confirmada = sólida). */
function varianteEstatus(
  estatus: EstatusNotaSalida,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (estatus === 'cancelada') {
    return 'destructive';
  }
  if (estatus === 'confirmada') {
    return 'default';
  }
  return 'secondary';
}

/** Badge del estatus de una nota de salida. */
export function EstatusNotaBadge({ estatus }: { estatus: EstatusNotaSalida }): React.JSX.Element {
  return (
    <Badge variant={varianteEstatus(estatus)} data-testid="estatus-nota">
      {ETIQUETA_ESTATUS_NOTA[estatus]}
    </Badge>
  );
}

/** Formatea una fecha date-only `YYYY-MM-DD` como "20 jun 2026" sin desfase de zona. */
export function fechaCortaNota(valor: string | null): string {
  if (valor === null || valor === '') {
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

/** Descripción legible del material de un renglón (avío o tela + lote). */
export function descripcionMaterialNota(linea: NotaSalidaLinea): string {
  if (linea.tipo === 'avio') {
    return linea.avio ?? 'Avío sin nombre';
  }
  const tela = linea.tela ?? 'Tela';
  return linea.loteClave !== null ? `${tela} · lote ${linea.loteClave}` : tela;
}
