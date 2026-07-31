import { InfoIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Aviso "qué sigue en el detalle" para los diálogos de ALTA que dejan piezas por armar
 * después de guardar (p. ej. un modelo deja su receta y sus fotos; un cliente, sus
 * departamentos, campos y listas de precios). Es una nota informativa (no un error): caja
 * suave con un ícono, al pie del cuerpo del formulario. Puramente presentacional.
 */
export function AvisoAlta({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="aviso-alta"
      className={cn(
        'flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground',
        className,
      )}
      {...props}
    >
      <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
