import { Search } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * BUSCADOR de la barra de herramientas (proto `.tool-search`): caja de 30×200
 * con la lupa adentro y el input sin borde propio. Compartido por las pantallas
 * tabla-first (catálogos, consultas, listados). Vivía en `TablaCatalogo`; se
 * movió al kit en la pasada global R9 para que TODAS las pantallas usen la
 * misma pieza (misma métrica que los chips: 30px, radio 8).
 */
export function BuscadorToolbar({
  valor,
  alCambiar,
  placeholder = 'Buscar…',
  etiqueta,
  testid,
  className,
}: {
  valor: string;
  alCambiar: (valor: string) => void;
  placeholder?: string;
  /** Etiqueta accesible del input. */
  etiqueta: string;
  testid?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-[30px] w-[200px] items-center gap-1.5 rounded-[8px] border bg-panel-2 px-2 text-faint transition-colors focus-within:border-ring',
        className,
      )}
    >
      <Search className="size-3.5 shrink-0" aria-hidden />
      <input
        type="search"
        className="w-full min-w-0 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-faint"
        placeholder={placeholder}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        aria-label={etiqueta}
        {...(testid === undefined ? {} : { 'data-testid': testid })}
      />
    </div>
  );
}
