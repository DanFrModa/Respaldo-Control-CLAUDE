import { ChevronDownIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Select NATIVO (`<select>`) estilizado para combinar con el `Input` de shadcn.
 *
 * Se usa un select del navegador (en vez del componente Select de Radix) porque
 * para catalogos cortos y cerrados (p. ej. el tipo de almacen: PT/TELA/AVIO) es
 * mas simple, totalmente accesible y sin dependencias extra. Cuando un caso
 * necesite busqueda dentro de las opciones, se incorporara el Select de Radix.
 */
function SelectNativo({
  className,
  children,
  ...props
}: React.ComponentProps<'select'>): React.JSX.Element {
  return (
    <div className="relative w-full">
      <select
        data-slot="select-nativo"
        className={cn(
          'h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}

export { SelectNativo };
