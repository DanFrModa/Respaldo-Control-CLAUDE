import { cn } from '@/lib/utils';

/**
 * Piezas visuales del tablero "Análisis RC" (R7): un SPARKLINE SVG inline simple y accesible (para la
 * tendencia de entregas a tiempo) y una BARRA de peso (para los cuellos de botella). CERO lógica de
 * negocio (A1): los valores los DERIVA el backend; aquí solo se pintan. Los números que acompañan van
 * en `tabular-nums` en la página.
 */

/**
 * Sparkline de MINI-BARRAS (proto `spark()`): una barrita de 9px por valor (escala 0-100, altura
 * proporcional con piso de 4px), color de marca. Decorativo + `aria-label` que enuncia la serie
 * (el color no basta); cada barra lleva `title` con su valor. Sin dependencias.
 */
export function Sparkline({
  valores,
  sufijo = '',
  alto = 26,
  className,
}: {
  valores: readonly number[];
  /** Sufijo para las etiquetas (p. ej. "%"). */
  sufijo?: string;
  alto?: number;
  className?: string;
}): React.JSX.Element {
  const etiqueta = `Tendencia: ${valores.join(', ')}${sufijo}`;
  return (
    <span
      role="img"
      aria-label={etiqueta}
      className={cn('inline-flex items-end gap-[3px] text-primary', className)}
      style={{ height: alto }}
      data-testid="sparkline"
    >
      {valores.map((v, i) => (
        <span
          // La serie es posicional (semanas consecutivas): el índice es la llave natural.
          key={i}
          className="w-[9px] rounded-[2px] bg-current"
          style={{ height: Math.max(4, Math.round((v / 100) * alto)) }}
          title={`${v}${sufijo}`}
        />
      ))}
    </span>
  );
}

/**
 * Barra de PESO relativa (0-100): una franja horizontal rellena al porcentaje dado. Decorativa
 * (`aria-hidden`): el número que representa ya está en la celda contigua.
 */
export function BarraPeso({
  pct,
  className,
}: {
  pct: number;
  className?: string;
}): React.JSX.Element {
  const ancho = Math.max(0, Math.min(100, pct));
  return (
    <span
      aria-hidden
      className={cn('block h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      data-testid="barra-peso"
    >
      <span className="block h-full rounded-full bg-primary" style={{ width: `${ancho}%` }} />
    </span>
  );
}
