import { cn } from '@/lib/utils';

/**
 * CHIPS DE FILTRO del rediseño (proto `.chip` / `.chip.active`): la fila de
 * pastillas excluyentes con que el prototipo filtra las tablas ("Todos |
 * Activos | Borrador", "Abiertas | Todas", "Vigentes | Entregados |
 * Cancelados", …) — en lugar del checkbox "Incluir inactivos" heredado.
 *
 * Metricas EXACTAS del proto: 30px de alto, padding 0 10px, radio 8px, borde
 * `--border` sobre `--panel-2`, texto 12px/500 atenuado; hover con borde
 * fuerte + texto pleno; el ACTIVO usa el realce suave de marca (`--brand-soft`)
 * con semibold y borde transparente. El activo NO reacciona al hover (igual
 * que el proto: `.chip.active` pisa al `:hover`).
 *
 * Dos formas, mismas metricas:
 *  - `ChipsFiltro`: el selector EXCLUYENTE (uno activo siempre) — botones con
 *    `aria-pressed` dentro de un `role="group"` etiquetado, con conteo opcional
 *    y `testid` propio por opcion (los e2e heredados dependen de testids como
 *    `mostrar-desactivados`).
 *  - `ChipFiltro`: el chip SUELTO (toggle independiente o estatico), para
 *    casos que no son una fila excluyente ("Solo bloqueados", "Incluir
 *    canceladas"). Acepta cualquier prop de `<button>`.
 */

/** Clases del chip del proto (compartidas por `ChipsFiltro` y `ChipFiltro`). */
function claseChip(activo: boolean): string {
  return cn(
    'inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[8px] border px-2.5 text-[12px] whitespace-nowrap transition-colors',
    activo
      ? 'border-transparent bg-primary-soft font-semibold text-primary-soft-foreground'
      : 'bg-panel-2 font-medium text-muted-foreground hover:border-border-strong hover:text-foreground',
  );
}

/**
 * CHIP suelto (proto `.chip`) como boton individual: toggle independiente o
 * chip estatico. Para filas excluyentes usar `ChipsFiltro`.
 */
export function ChipFiltro({
  activo = false,
  className,
  children,
  ...props
}: React.ComponentProps<'button'> & { activo?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={activo}
      data-slot="chip-filtro"
      className={cn(claseChip(activo), className)}
      {...props}
    >
      {children}
    </button>
  );
}

/** Una opcion de la fila de chips. */
export interface OpcionChip<V extends string = string> {
  /** Valor estable de la opcion (key de React). */
  valor: V;
  /** Texto del chip (p. ej. "Todos", "Activos", "Canceladas"). */
  etiqueta: string;
  /** Conteo opcional mostrado dentro del chip (formateado es-MX). */
  conteo?: number;
  /**
   * `data-testid` del chip; sin el, `chip-{valor}`. Permite conservar EXACTOS
   * los testids heredados que los e2e ya clickean (`mostrar-desactivados`…).
   */
  testid?: string;
}

/** Fila de chips de filtro excluyentes (proto `.chip`). */
export function ChipsFiltro<V extends string>({
  opciones,
  valor,
  alCambiar,
  etiqueta,
  className,
}: {
  opciones: readonly OpcionChip<V>[];
  /** El valor ACTIVO (excluyente: siempre hay exactamente uno). */
  valor: V;
  /** Se llama con el valor elegido; el clic al chip ya activo NO re-dispara. */
  alCambiar: (valor: V) => void;
  /** Nombre accesible del grupo (p. ej. "Filtrar por estado"). */
  etiqueta: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={etiqueta}
      data-slot="chips-filtro"
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {opciones.map((opcion) => {
        const activo = opcion.valor === valor;
        return (
          <button
            key={opcion.valor}
            type="button"
            aria-pressed={activo}
            data-testid={opcion.testid ?? `chip-${opcion.valor}`}
            onClick={() => {
              if (!activo) {
                alCambiar(opcion.valor);
              }
            }}
            className={claseChip(activo)}
          >
            {opcion.etiqueta}
            {opcion.conteo === undefined ? null : (
              <span className="num text-[11px] opacity-70">
                {opcion.conteo.toLocaleString('es-MX')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
