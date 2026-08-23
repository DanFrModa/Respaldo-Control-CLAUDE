import type { NotaSalida } from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { cn } from '@/lib/utils';

import { TONO_ESTATUS_NOTA, fechaCortaNota, ordenesDeNota } from './piezas';

/**
 * TARJETA MÓVIL de una nota de salida (ola 2): el mismo renglón de la tabla densa, apilado para
 * teléfono (<lg). La comparten el listado (NotasSalidaPagina) y la consulta (ConsultaNotasPagina):
 * mismos datos y handler de selección; en escritorio (≥lg) sigue la tabla intacta. Presentación
 * pura — el estatus lo controla el backend, aquí solo se pinta.
 */
export function TarjetaNota({
  nota,
  nombreEmpresa,
  seleccionada,
  onClick,
  testid,
}: {
  nota: NotaSalida;
  /** Nombre de la empresa (lookup del catálogo; el listado solo trae `idEmpresa`). */
  nombreEmpresa: string;
  seleccionada: boolean;
  onClick: () => void;
  /** Base del `data-testid` de la tarjeta (p. ej. "nota" → `nota-tarjeta`). */
  testid: string;
}): React.JSX.Element {
  const chip = TONO_ESTATUS_NOTA[nota.estatus];
  const ordenes = ordenesDeNota(nota);

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`${testid}-tarjeta`}
      className={cn(
        'w-full rounded-lg border bg-card p-3 text-left',
        seleccionada && 'ring-2 ring-primary',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="flex size-[30px] shrink-0 items-center justify-center rounded-[7px] bg-linear-150 from-[#7bd6a6] to-[#2f9c66] text-[11px] font-bold text-[#04140c]"
          >
            NS
          </span>
          <span className="min-w-0">
            <span className="block font-medium">Nota {nota.numNota}</span>
            <span className="num block text-[11px] text-faint">
              {fechaCortaNota(nota.fechaElaboracion)}
            </span>
          </span>
        </span>
        <ChipEstado tono={chip.tono}>{chip.texto}</ChipEstado>
      </div>
      <p className="mt-1 truncate text-sm font-medium">{nota.maquilero}</p>
      <p className="truncate text-xs text-muted-foreground">{nombreEmpresa}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground">Órdenes:</span>
          {ordenes.slice(0, 3).map((folio) => (
            <span
              key={folio}
              className="num inline-flex h-5 items-center rounded-md bg-primary-soft px-[7px] text-[11.5px] font-semibold text-primary-soft-foreground"
            >
              {folio}
            </span>
          ))}
          {ordenes.length > 3 ? (
            <span className="num inline-flex h-5 items-center rounded-md bg-muted px-[7px] text-[11.5px] font-semibold text-muted-foreground">
              +{ordenes.length - 3}
            </span>
          ) : null}
          {ordenes.length === 0 ? <span className="text-faint">—</span> : null}
        </span>
        <span>
          <span className="text-muted-foreground">Renglones:</span>{' '}
          <span className="num font-semibold">{nota.lineas.length}</span>
        </span>
      </div>
    </button>
  );
}
