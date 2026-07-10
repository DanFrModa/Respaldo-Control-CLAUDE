import { Shirt } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Tamaños de la marca (el cuadro del icono y el texto escalan juntos). */
type TamanoMarca = 'sm' | 'md' | 'lg';

const CUADRO: Record<TamanoMarca, string> = {
  sm: 'size-7 rounded-lg',
  // `md` es el del riel: 30px y radio 8px EXACTOS del proto (`.logo`).
  md: 'size-7.5 rounded-[8px]',
  lg: 'size-12 rounded-2xl',
};

const ICONO: Record<TamanoMarca, string> = {
  sm: 'size-4',
  md: 'size-[17px]',
  lg: 'size-7',
};

const WORDMARK: Record<TamanoMarca, string> = {
  sm: 'text-sm',
  md: 'text-sm',
  lg: 'text-xl',
};

/**
 * Marca de la aplicacion (rediseño R1): cuadro con degradado del verde de marca
 * (brillante → pino, como el logo del prototipo) + icono textil, junto al
 * wordmark "Control v2" y (opcional) el subtitulo "FR Moda".
 *
 * `enRiel`: variante para el RIEL OSCURO del cascaron — el wordmark usa los
 * tokens `rail-*` (blanco verdoso + atenuado) en vez de los del panel claro.
 *
 * Accesibilidad: cuando la marca va dentro de un encabezado (`<h1>` del login,
 * p. ej.), el subtitulo NO debe colarse en el nombre accesible del heading. Por
 * eso el wordmark "Control v2" es el unico texto "real" del nombre y el subtitulo
 * se marca `aria-hidden`; el cuadro del icono tambien es decorativo. Asi un lector
 * de pantalla anuncia "Control v2" y no "Control v2 FR Moda".
 *
 * Modos del texto (cuadro del logo SIEMPRE visible):
 *   - `soloIcono`: NO renderiza el wordmark (lo desmonta). Para usos donde el
 *     texto no debe existir nunca (no aplica al riel colapsable animado).
 *   - `colapsado`: el wordmark SIGUE montado pero se anima a ancho/opacidad 0
 *     (se "desvanece" sin remontarse). Pensado para el riel colapsable: al
 *     alternar, el cuadro se queda quieto y solo las palabras entran/salen suave,
 *     sin parpadeo. `soloIcono` tiene prioridad si ambos vienen en true.
 */
export function Marca({
  soloIcono = false,
  colapsado = false,
  tamano = 'md',
  conSubtitulo = true,
  enRiel = false,
  className,
}: {
  /** Muestra solo el cuadro del icono (desmonta el wordmark). */
  soloIcono?: boolean;
  /**
   * Riel colapsable: mantiene el wordmark montado pero animado a ancho 0
   * (se desvanece sin remontar). Ignorado si `soloIcono` es true.
   */
  colapsado?: boolean;
  tamano?: TamanoMarca;
  /** Muestra "FR Moda" bajo el wordmark (ignorado si `soloIcono`). */
  conSubtitulo?: boolean;
  /** Colores del riel oscuro (tokens `rail-*`) para el wordmark. */
  enRiel?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    // Sin `gap` en el contenedor: el espacio cuadro<->wordmark vive como margen
    // izquierdo del wordmark (`ml-2.5`) para poder animarlo a 0 al colapsar y no
    // dejar un hueco fantasma cuando el texto se desvanece.
    <span className={cn('inline-flex items-center', className)}>
      <span
        aria-hidden
        className={cn(
          // Logo EXACTO del proto (`.logo`): degradado 150deg brand-bright → brand,
          // icono OSCURO (#04140c, constante en ambos temas) y halo verde suave.
          'flex shrink-0 items-center justify-center bg-linear-150 from-primary-bright to-primary text-[#04140c] shadow-[0_4px_12px_-4px_rgba(34,181,108,0.6)]',
          CUADRO[tamano],
        )}
      >
        <Shirt className={ICONO[tamano]} aria-hidden />
      </span>
      {soloIcono ? null : (
        <span
          className={cn(
            // En modo `colapsado` el wordmark se anima a ancho/margen/opacidad 0
            // (overflow oculto) sin desmontarse; expandido recupera su ancho.
            'flex min-w-0 flex-col overflow-hidden leading-tight whitespace-nowrap transition-[max-width,opacity,margin] duration-200 ease-in-out',
            colapsado ? 'ml-0 max-w-0 opacity-0' : 'ml-2.5 max-w-[12rem] opacity-100',
          )}
        >
          <span
            className={cn(
              'font-heading',
              // En el riel, la tipografía EXACTA del proto (`.brand-word b`): 14px,
              // peso 700 y tracking ancho .12em. El TEXTO sigue siendo "Control v2"
              // (regla de negocio: Marilyn/MJD NO va en la UI).
              enRiel
                ? 'text-[14px] font-bold tracking-[0.12em] text-rail-fg-strong'
                : cn('font-semibold tracking-tight', WORDMARK[tamano]),
            )}
          >
            Control <span className={enRiel ? 'text-rail-active-fg' : 'text-primary'}>v2</span>
          </span>
          {conSubtitulo ? (
            <span
              aria-hidden
              className={cn(
                'truncate uppercase',
                // Subtítulo del proto (`.brand-word span`): 10px, tracking .16em, 70 %.
                enRiel
                  ? 'text-[10px] tracking-[0.16em] text-rail-fg/70'
                  : 'text-xs tracking-wider text-muted-foreground',
              )}
            >
              FR Moda
            </span>
          ) : null}
        </span>
      )}
    </span>
  );
}
