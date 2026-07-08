import { cn } from '@/lib/utils';

/**
 * Piezas visuales del tablero "Análisis RC" (R7): un SPARKLINE SVG inline simple y accesible (para la
 * tendencia de entregas a tiempo) y una BARRA de peso (para los cuellos de botella). CERO lógica de
 * negocio (A1): los valores los DERIVA el backend; aquí solo se pintan. Los números que acompañan van
 * en `tabular-nums` en la página.
 */

/**
 * Sparkline de línea (tendencia): dibuja `valores` como una polilínea normalizada a su min/max, con un
 * punto en el último dato. Decorativo + `aria-label` que enuncia la serie (el color no basta). Sin
 * dependencias (SVG inline). Vacío/1 punto → una línea plana.
 */
export function Sparkline({
  valores,
  sufijo = '',
  ancho = 96,
  alto = 28,
  className,
}: {
  valores: readonly number[];
  /** Sufijo para la etiqueta accesible (p. ej. "%"). */
  sufijo?: string;
  ancho?: number;
  alto?: number;
  className?: string;
}): React.JSX.Element {
  const n = valores.length;
  const pad = 3;
  const min = n > 0 ? Math.min(...valores) : 0;
  const max = n > 0 ? Math.max(...valores) : 1;
  const rango = max - min || 1;
  const x = (i: number): number => (n <= 1 ? pad : pad + (i * (ancho - 2 * pad)) / (n - 1));
  const y = (v: number): number => alto - pad - ((v - min) / rango) * (alto - 2 * pad);
  const puntos = valores.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const ultimo = n > 0 ? (valores[n - 1] ?? 0) : 0;
  const etiqueta = `Tendencia: ${valores.join(', ')}${sufijo}`;

  return (
    <svg
      role="img"
      aria-label={etiqueta}
      viewBox={`0 0 ${ancho} ${alto}`}
      width={ancho}
      height={alto}
      className={cn('text-ok', className)}
      data-testid="sparkline"
    >
      {n > 1 ? (
        <polyline
          points={puntos}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {n > 0 ? <circle cx={x(n - 1)} cy={y(ultimo)} r={2.25} fill="currentColor" /> : null}
    </svg>
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
