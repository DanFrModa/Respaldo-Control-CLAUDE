import { EyeOff } from 'lucide-react';

import { ETIQUETA_MOSTRAR_CERRADAS, textoAvisoCerradasOcultas } from '@/lib/orden-cerrada';
import { cn } from '@/lib/utils';

/**
 * ⭐ 0.227 (§Post-F9.244, etapa 2) — EL INTERRUPTOR «Mostrar cerradas» de los selectores de CAPTURA.
 *
 * Daniel: *«todas las pantallas donde sean de meter información, ya no deberían aparecer esas
 * órdenes»* + *«no quisiera que las órdenes sean invisibles»*. Por eso el selector de una captura
 * OCULTA las cerradas por omisión, pero SIEMPRE con este interruptor a la vista: filtrar el selector
 * por estado ya rompió la operación una vez (26-jul-2026, `SelectorOrden.tsx`) porque nadie podía
 * saber por qué no aparecía una orden. Elegir una cerrada con el interruptor encendido sigue
 * funcionando como en la etapa 1: la pantalla avisa y apaga el guardar.
 *
 * Es un `checkbox` nativo con su `<label>` (el patrón de «Incluir inactivos» de la app): accesible
 * por teclado y por nombre sin piezas nuevas.
 */
export function InterruptorCerradas({
  activo,
  alCambiar,
  deshabilitado = false,
  className,
  testid = 'mostrar-cerradas',
}: {
  activo: boolean;
  alCambiar: (activo: boolean) => void;
  deshabilitado?: boolean;
  className?: string;
  testid?: string;
}): React.JSX.Element {
  return (
    <label
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={activo}
        disabled={deshabilitado}
        onChange={(e) => alCambiar(e.target.checked)}
        data-testid={testid}
      />
      {ETIQUETA_MOSTRAR_CERRADAS}
    </label>
  );
}

/**
 * ⭐ 0.227 — EL AVISO de que hay órdenes CERRADAS que coinciden y no se muestran. Con `total` en
 * cero no pinta nada (el llamador puede pasar el conteo tal cual). Es `role="status"`: no es un
 * error, es la razón de por qué una orden no aparece.
 */
export function AvisoCerradasOcultas({
  folios,
  total,
  className,
  testid = 'aviso-cerradas-ocultas',
}: {
  folios: readonly (number | string)[];
  total: number;
  className?: string;
  testid?: string;
}): React.JSX.Element | null {
  if (total <= 0 || folios.length === 0) return null;
  return (
    <p
      className={cn('flex items-start gap-1.5 text-xs text-muted-foreground', className)}
      role="status"
      data-testid={testid}
    >
      <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{textoAvisoCerradasOcultas(folios, total)}</span>
    </p>
  );
}
