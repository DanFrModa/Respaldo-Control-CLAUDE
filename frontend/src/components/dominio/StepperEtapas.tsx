import { cn } from '@/lib/utils';

/**
 * STEPPER DE ETAPAS del avance de producción (rediseño R2, §4.3 — proto `.proc-steps`): las 5
 * etapas del flujo (Corte / Entrega a maquila / Recibo de maquila / Entrega aplicación / Recibo
 * aplicación) como botones con su avance `hecho/total` y color de estado:
 *
 *  - `done`    (verde)  → hecho ≥ total (y total > 0): la etapa está completa.
 *  - `partial` (ámbar)  → hay avance pero no llega al total.
 *  - vacía     (neutro) → sin movimientos.
 *
 * Presentación PURA (A1): los totales vienen DERIVADOS del servidor (Σ de movimientos vivos);
 * aquí solo se pintan y se emite el cambio de etapa activa.
 */

/** Un paso del stepper. */
export interface PasoEtapa {
  /** Clave estable de la etapa (p. ej. "corte", "entrega-maquila"). */
  clave: string;
  /** Etiqueta visible ("Corte", "Entrega a maquila"…). */
  etiqueta: string;
  /** Piezas hechas en la etapa (Σ de movimientos vivos, derivado en servidor). */
  hecho: number;
  /** Total de referencia de la orden (lo ordenado). */
  total: number;
}

/** Estado visual de un paso (exportado para probarlo por unit). */
export function estadoPaso(paso: PasoEtapa): 'done' | 'partial' | 'vacia' {
  if (paso.total > 0 && paso.hecho >= paso.total) {
    return 'done';
  }
  if (paso.hecho > 0) {
    return 'partial';
  }
  return 'vacia';
}

/** Props de {@link StepperEtapas}. */
export interface PropsStepperEtapas {
  pasos: readonly PasoEtapa[];
  /** Clave de la etapa activa (controlada por el padre). */
  activa: string;
  onCambiar: (clave: string) => void;
  /** Base de los `data-testid` (default "stepper"). */
  testid?: string;
}

/** Punto de estado del paso (color semántico). */
const PUNTO_POR_ESTADO: Record<ReturnType<typeof estadoPaso>, string> = {
  done: 'bg-ok',
  partial: 'bg-warn',
  vacia: 'bg-faint/50',
};

/** Stepper horizontal de etapas con avance `x/total` (cifras tabulares) y color de estado. */
export function StepperEtapas({
  pasos,
  activa,
  onCambiar,
  testid = 'stepper',
}: PropsStepperEtapas): React.JSX.Element {
  return (
    <div
      className="flex flex-wrap gap-1.5"
      role="tablist"
      aria-label="Etapas de producción"
      data-testid={testid}
    >
      {pasos.map((paso) => {
        const estado = estadoPaso(paso);
        const activo = paso.clave === activa;
        return (
          <button
            key={paso.clave}
            type="button"
            role="tab"
            aria-selected={activo}
            data-estado={estado}
            data-testid={`${testid}-${paso.clave}`}
            onClick={() => onCambiar(paso.clave)}
            className={cn(
              'flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
              activo
                ? 'border-primary bg-primary-soft text-primary-soft-foreground shadow-[inset_0_0_0_1px_var(--primary)]'
                : 'bg-card hover:border-border-strong',
            )}
          >
            <span
              aria-hidden
              className={cn('size-2 shrink-0 rounded-full', PUNTO_POR_ESTADO[estado])}
            />
            <span className="min-w-0 truncate font-medium">{paso.etiqueta}</span>
            <span className="num shrink-0 text-xs text-muted-foreground">
              {paso.hecho.toLocaleString('es-MX')}/{paso.total.toLocaleString('es-MX')}
            </span>
          </button>
        );
      })}
    </div>
  );
}
