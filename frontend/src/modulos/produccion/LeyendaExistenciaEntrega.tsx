import { cn } from '@/lib/utils';

import { leyendaExistencia } from './existencia-entrega';

/**
 * ⭐ Fila 0.219 — la existencia de UNA celda de la entrega a cliente, pintada bajo lo que se captura
 * («Hay N» · «Excede · hay N» · «Sin existencia»). Sólo se monta con la existencia CONOCIDA: cuando
 * no se sabe, quien la usa no la pinta (un cero inventado no se dice). Presentación pura (A1).
 */
export function LeyendaExistenciaEntrega({
  cantidad,
  existencia,
  testid,
}: {
  cantidad: number;
  existencia: number;
  testid: string;
}): React.JSX.Element {
  const leyenda = leyendaExistencia(cantidad, existencia);
  return (
    <span
      className={cn(
        'mt-0.5 block text-[10.5px] leading-tight tabular-nums',
        leyenda.tono === 'crit' ? 'font-semibold text-crit' : 'text-muted-foreground',
      )}
      data-testid={testid}
      data-tono={leyenda.tono}
    >
      {leyenda.texto}
    </span>
  );
}
