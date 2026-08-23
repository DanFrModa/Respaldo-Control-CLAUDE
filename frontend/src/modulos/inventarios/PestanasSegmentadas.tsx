import { cn } from '@/lib/utils';

/** Una pestaña del control segmentado. */
export interface PestanaSegmentada<V extends string = string> {
  valor: V;
  etiqueta: string;
  /** `data-testid` del botón (conserva los testids heredados de los toggles viejos). */
  testid?: string;
}

/**
 * CONTROL SEGMENTADO del proto (`.tabs`): riel con borde sobre `--panel-2` donde la pestaña activa
 * "flota" con fondo de tarjeta y sombra. Es el reemplazo estándar de los toggles viejos
 * `rounded-md border` + `bg-primary` que quedaban del teal en las pantallas de inventarios
 * (kardex por modelo/folio, telas/avíos, entrada/salida) y el mismo riel que usa Existencias PT
 * para navegar Existencias / Movimientos / Traspasos.
 */
export function PestanasSegmentadas<V extends string>({
  opciones,
  valor,
  alCambiar,
  etiqueta,
  className,
}: {
  opciones: readonly PestanaSegmentada<V>[];
  /** La pestaña ACTIVA (excluyente: siempre hay exactamente una). */
  valor: V;
  /** Se llama con la pestaña elegida; el clic a la ya activa NO re-dispara. */
  alCambiar: (valor: V) => void;
  /** Nombre accesible del grupo (p. ej. "Vistas de inventario PT"). */
  etiqueta: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-[9px] border bg-panel-2 p-[3px]',
        className,
      )}
      role="tablist"
      aria-label={etiqueta}
    >
      {opciones.map((opcion) => {
        const activa = opcion.valor === valor;
        return (
          <button
            key={opcion.valor}
            type="button"
            role="tab"
            aria-selected={activa}
            data-testid={opcion.testid}
            onClick={() => {
              if (!activa) {
                alCambiar(opcion.valor);
              }
            }}
            className={cn(
              'rounded-[7px] px-3 py-[3px] text-xs font-semibold transition-colors',
              activa
                ? 'bg-card shadow-(--shadow)'
                : 'cursor-pointer text-muted-foreground hover:text-foreground',
            )}
          >
            {opcion.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
