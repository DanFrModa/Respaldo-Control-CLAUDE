import { ChevronDownIcon, X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * ¿La clase es una utilidad de ANCHO de Tailwind (`w-*`, `min-w-*`, `max-w-*`),
 * con o sin variantes (`md:w-40`)? Se usa para REFLEJAR el ancho pedido al
 * contenedor del select (ver abajo).
 */
function esClaseDeAncho(clase: string): boolean {
  return /^(?:[^:]+:)*(?:w-|min-w-|max-w-)/.test(clase);
}

/**
 * Select NATIVO (`<select>`) estilizado para combinar con el `Input` de shadcn.
 *
 * Se usa un select del navegador (en vez del componente Select de Radix) porque
 * para catalogos cortos y cerrados (p. ej. el tipo de almacen: PT/TELA/AVIO) es
 * mas simple, totalmente accesible y sin dependencias extra. Cuando un caso
 * necesite busqueda dentro de las opciones, se incorporara el Select de Radix.
 *
 * ANCHO (fix de fidelidad R9): el select vive dentro de un contenedor
 * `relative` (para posicionar el chevron) que por default es `w-full`. Antes
 * ese `w-full` era FIJO, asi que un `w-auto`/`w-52` pasado en `className` solo
 * acotaba al `<select>` interno y el contenedor seguia ocupando el renglon
 * entero — por eso los toolbars salian apilados en vez de compactos como el
 * prototipo. Ahora las utilidades de ANCHO del `className` se REFLEJAN también
 * al contenedor (ganan sobre el `w-full` default via tailwind-merge); el resto
 * (`h-8`, `text-sm`, `mt-1`, …) sigue aplicando SOLO al `<select>`, como
 * siempre. Ademas `claseContenedor` permite estilar el contenedor explicito
 * (gana sobre todo lo demas). Backwards-compatible: sin clases de ancho ni
 * `claseContenedor`, el comportamiento es identico al anterior (`w-full`), y
 * los wrappers locales tipo `<div className="w-52"><SelectNativo …/></div>`
 * siguen funcionando (el contenedor `w-full` llena ese padre).
 *
 * LIMPIAR (aditivo, jul-2026 — petición de Daniel en los filtros de Órdenes):
 * con la prop opcional `alLimpiar`, cuando el select tiene un valor distinto
 * del default (`value` no vacío) el chevron se sustituye por un botón ✕ que
 * invoca `alLimpiar` (el padre regresa el filtro a "Todos"). Mismo look que la
 * ✕ del `ComboboxBuscable` para que toda la barra de filtros sea consistente.
 * Sin `alLimpiar` el componente se comporta EXACTAMENTE igual que antes.
 */
function SelectNativo({
  className,
  claseContenedor,
  alLimpiar,
  children,
  ...props
}: React.ComponentProps<'select'> & {
  /** Clases extra para el CONTENEDOR del select (no el `<select>` interno). */
  claseContenedor?: string;
  /** Con valor no vacío pinta una ✕ (en lugar del chevron) que limpia el filtro. */
  alLimpiar?: () => void;
}): React.JSX.Element {
  const clasesDeAncho = (className ?? '').split(/\s+/).filter(esClaseDeAncho);
  // La ✕ solo aparece con un valor "real" (no el default '' de los filtros) y select habilitado.
  const limpiable =
    alLimpiar !== undefined &&
    props.value !== undefined &&
    props.value !== '' &&
    props.disabled !== true;
  const testid = (props as { 'data-testid'?: string })['data-testid'];
  return (
    <div className={cn('relative w-full', clasesDeAncho, claseContenedor)}>
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
      {limpiable ? (
        <button
          type="button"
          onClick={alLimpiar}
          aria-label="Quitar filtro"
          {...(testid !== undefined ? { 'data-testid': `${testid}-limpiar` } : {})}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : (
        <ChevronDownIcon
          className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      )}
    </div>
  );
}

export { SelectNativo };
