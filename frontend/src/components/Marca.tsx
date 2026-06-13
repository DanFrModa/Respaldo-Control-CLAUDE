import { Shirt } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Tamaños de la marca (el cuadro del icono y el texto escalan juntos). */
type TamanoMarca = 'sm' | 'md' | 'lg';

const CUADRO: Record<TamanoMarca, string> = {
  sm: 'size-7 rounded-lg',
  md: 'size-9 rounded-xl',
  lg: 'size-12 rounded-2xl',
};

const ICONO: Record<TamanoMarca, string> = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-7',
};

const WORDMARK: Record<TamanoMarca, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl',
};

/**
 * Marca de la aplicacion: cuadro con degradado teal + icono textil, junto al
 * wordmark "Control v2" y (opcional) el subtitulo "FR Moda".
 *
 * Accesibilidad: cuando la marca va dentro de un encabezado (`<h1>` del login,
 * p. ej.), el subtitulo NO debe colarse en el nombre accesible del heading. Por
 * eso el wordmark "Control v2" es el unico texto "real" del nombre y el subtitulo
 * se marca `aria-hidden`; el cuadro del icono tambien es decorativo. Asi un lector
 * de pantalla anuncia "Control v2" y no "Control v2 FR Moda".
 */
export function Marca({
  soloIcono = false,
  tamano = 'md',
  conSubtitulo = true,
  className,
}: {
  /** Muestra solo el cuadro del icono (p. ej. sidebar colapsado). */
  soloIcono?: boolean;
  tamano?: TamanoMarca;
  /** Muestra "FR Moda" bajo el wordmark (ignorado si `soloIcono`). */
  conSubtitulo?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center bg-gradient-to-br from-teal-500 to-teal-700 text-white shadow-sm dark:from-teal-400 dark:to-teal-600',
          CUADRO[tamano],
        )}
      >
        <Shirt className={ICONO[tamano]} aria-hidden />
      </span>
      {soloIcono ? null : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className={cn('font-heading font-semibold tracking-tight', WORDMARK[tamano])}>
            Control <span className="text-primary">v2</span>
          </span>
          {conSubtitulo ? (
            <span aria-hidden className="truncate text-xs text-muted-foreground">
              FR Moda
            </span>
          ) : null}
        </span>
      )}
    </span>
  );
}
