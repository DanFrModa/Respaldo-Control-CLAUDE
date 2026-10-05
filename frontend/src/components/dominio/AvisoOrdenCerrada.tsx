import { Lock } from 'lucide-react';

import { textoAvisoOrdenCerrada } from '@/lib/orden-cerrada';
import { cn } from '@/lib/utils';

/**
 * ⭐ 0.226b (§Post-F9.244): el AVISO de orden cerrada, ÚNICO para todas las pantallas de captura.
 *
 * Va arriba de la captura y junto con ella se APAGA el botón de guardar: así nadie llena un
 * formulario para enterarse al pulsar Guardar de que la orden ya no admite movimientos. Es la misma
 * forma que estrenó el costeo (0.061) — un aviso sobrio (`role="status"`, no una alerta: no es un
 * error, es el estado de la orden).
 *
 * Con `folios` vacío no pinta nada, para que el llamador pueda pasar la lista tal cual (una nota o
 * una OC llevan renglones de varias órdenes y pueden tener cerradas varias o ninguna).
 *
 * El texto vive en `textoAvisoOrdenCerrada` (`lib/orden-cerrada.ts`). El servidor rechaza igual
 * (A1): esto es la cortesía de no ofrecer un campo que va a rebotar.
 */
export function AvisoOrdenCerrada({
  folios,
  detalle,
  className,
  testid = 'aviso-orden-cerrada',
}: {
  folios: readonly (number | string)[];
  /** Una frase PROPIA de la pantalla que se agrega al texto común (p. ej. «su costo quedó congelado»). */
  detalle?: React.ReactNode;
  className?: string;
  testid?: string;
}): React.JSX.Element | null {
  if (folios.length === 0) return null;
  return (
    <p
      className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-muted/50 p-3 text-sm',
        className,
      )}
      role="status"
      data-testid={testid}
    >
      <Lock className="size-4 shrink-0" aria-hidden />
      <span>
        {textoAvisoOrdenCerrada(folios)}
        {detalle === undefined ? null : <> {detalle}</>}
      </span>
    </p>
  );
}
