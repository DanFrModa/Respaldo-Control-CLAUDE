import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * CADENA DE TRAZABILIDAD del flujo de captura (rediseño R3, §4.1 — proto `cadenaTraza`):
 * `OC cliente → Desarrollo → Lista de precios → Pedido interno → OP · producción`. Cada nodo es
 * una tarjetita etiqueta+valor; los ACTIVOS navegan a su pantalla, los que no existen para ese
 * registro se pintan APAGADOS (p. ej. un modelo histórico sin ficha de desarrollo lleva la nota
 * "modelo anterior al módulo de Desarrollo" en su tooltip). El nodo de la OC del cliente se
 * distingue con borde PUNTEADO (es la referencia externa, no una pantalla del sistema).
 *
 * Presentación PURA (A1): no conoce pedidos ni órdenes; el padre arma los nodos y su navegación.
 */

/** Un nodo de la cadena. */
export interface NodoTraza {
  /** Clave estable del nodo (`oc` pinta el estilo punteado de referencia externa). */
  clave: 'oc' | 'desarrollo' | 'lista' | 'pedido' | 'op';
  /** Etiqueta chica en mayúsculas (p. ej. "Desarrollo"). */
  etiqueta: string;
  /** Valor mono (p. ej. "#12", "1502-F", "OC-CA-4471"); '—' cuando no existe. */
  valor: string;
  /** ¿El nodo existe/navega? Apagado si no. */
  activo: boolean;
  /** Navegación al hacer clic (solo si `activo`). */
  onNavegar?: () => void;
  /** Tooltip (p. ej. la nota "modelo anterior al módulo de Desarrollo"). */
  titulo?: string;
}

/** Props de {@link CadenaTrazabilidad}. */
export interface PropsCadenaTrazabilidad {
  nodos: readonly NodoTraza[];
  /** Variante compacta (paneles laterales): tarjetas más chicas. */
  compacta?: boolean;
  className?: string;
}

/** La cadena de trazabilidad navegable (nodos + flechas). */
export function CadenaTrazabilidad({
  nodos,
  compacta = false,
  className,
}: PropsCadenaTrazabilidad): React.JSX.Element {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      data-testid="cadena-trazabilidad"
    >
      {nodos.map((nodo, indice) => (
        <span key={nodo.clave} className="flex items-center gap-1.5">
          {indice > 0 ? (
            <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden />
          ) : null}
          <button
            type="button"
            disabled={!nodo.activo || nodo.onNavegar === undefined}
            onClick={nodo.onNavegar}
            title={nodo.titulo}
            data-testid={`traza-${nodo.clave}`}
            className={cn(
              'flex flex-col items-start gap-0 rounded-lg border bg-card text-left transition-colors',
              compacta ? 'px-2 py-1' : 'px-3 py-1.5',
              nodo.clave === 'oc' && 'border-dashed',
              nodo.activo
                ? 'border-primary/50 hover:border-primary hover:bg-primary-soft'
                : 'opacity-60',
              (!nodo.activo || nodo.onNavegar === undefined) && 'cursor-default',
            )}
          >
            <span className="text-[9.5px] font-semibold tracking-wide text-faint uppercase">
              {nodo.etiqueta}
            </span>
            <span
              className={cn(
                'num font-semibold',
                compacta ? 'text-[11.5px]' : 'text-xs',
                nodo.activo ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {nodo.valor}
            </span>
          </button>
        </span>
      ))}
    </div>
  );
}
