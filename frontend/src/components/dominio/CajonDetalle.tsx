import * as React from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/** Ancho máximo del cajón — la elección la manda el CONTENIDO, no la pantalla. */
type AnchoCajon = 'normal' | 'amplio' | 'maximo';

/**
 * Anchos del cajón (tope en viewport ≥ sm; en móvil es ANCHO COMPLETO — ver el
 * override de ancho en `SheetContent` abajo).
 *
 * El prefijo `data-[side=right]:sm:` NO es decorativo: el `SheetContent` base fija
 * `data-[side=right]:sm:max-w-sm`, un selector CON ATRIBUTO de mayor especificidad
 * que cualquier `sm:max-w-*` plano — y `tailwind-merge` NO funde variantes distintas
 * (`data-[side=right]:sm` ≠ `sm`) —, así que solo un override con LA MISMA variante
 * lo derrota. Por eso hasta ahora los `className="sm:max-w-2xl"` de las páginas
 * quedaban sin efecto y el cajón salía SIEMPRE angosto (384px).
 */
const CLASES_ANCHO: Record<AnchoCajon, string> = {
  normal: 'data-[side=right]:sm:max-w-md', //  ~448px — VER un detalle simple (label/valor)
  amplio: 'data-[side=right]:sm:max-w-2xl', // ~672px — contenido DENSO: tablas, matrices, formularios largos
  maximo: 'data-[side=right]:sm:max-w-4xl', // ~896px — matrices ANCHAS de edición (p. ej. árbol de permisos)
};

/**
 * CAJON DE DETALLE deslizante del rediseño (proto `.drawer`): panel lateral
 * derecho sobre `ui/sheet` con encabezado fijo (titulo + subtitulo + acciones)
 * y CUERPO SCROLLEABLE. Es el patron "tabla-first": la lista ocupa la pantalla
 * y el detalle del renglon elegido se asoma sin navegar.
 *
 * Controlado por el llamador (`abierto`/`alCambiarAbierto`); el contenido lo
 * arma cada pantalla (secciones, chips, tablas). Cerrar: la X del sheet, Esc o
 * clic fuera.
 *
 * El `ancho` lo decide el CONTENIDO: `normal` para VER un detalle simple (default),
 * `amplio` / `maximo` para contenido denso o de edición (tablas, matrices,
 * checkboxes). Cuando se ensancha, el grid interno debe FLUIR (columnas responsivas
 * al ancho, nunca fijas que desborden), porque en móvil el cajón sigue angosto.
 */
export function CajonDetalle({
  abierto,
  alCambiarAbierto,
  titulo,
  subtitulo,
  acciones,
  children,
  className,
  ancho = 'normal',
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  titulo: React.ReactNode;
  /** Linea secundaria bajo el titulo (folio, fecha, etc.). */
  subtitulo?: React.ReactNode;
  /** Botones del encabezado (imprimir, editar, …). */
  acciones?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Ancho del cajón según su contenido (ver `CLASES_ANCHO`). Default `normal`. */
  ancho?: AnchoCajon;
}): React.JSX.Element {
  return (
    <Sheet open={abierto} onOpenChange={alCambiarAbierto}>
      <SheetContent
        side="right"
        data-slot="cajon-detalle"
        // En móvil (< sm) el cajón es ANCHO COMPLETO: el `w-full` plano PERDÍA contra el
        // `data-[side=right]:w-3/4` del SheetContent base (misma trampa de variante+especificidad
        // que el max-w de arriba) y el cajón salía a 75vw dejando ~98px muertos a la izquierda.
        // El override con LA MISMA variante (`data-[side=right]:w-full`) sí lo funde/derrota; desde
        // `sm` se restaura el 75vw base y manda el `ancho` (CLASES_ANCHO) como tope.
        className={cn(
          'data-[side=right]:w-full data-[side=right]:sm:w-3/4 gap-0 p-0',
          CLASES_ANCHO[ancho],
          className,
        )}
      >
        <SheetHeader className="border-b px-4 py-3 pr-12">
          <SheetTitle className="text-sm font-semibold">{titulo}</SheetTitle>
          {subtitulo === undefined ? null : (
            <SheetDescription className="text-xs">{subtitulo}</SheetDescription>
          )}
          {acciones === undefined ? null : (
            <div className="mt-1 flex flex-wrap items-center gap-2">{acciones}</div>
          )}
        </SheetHeader>
        {/* Cuerpo scrolleable (el encabezado queda fijo). */}
        <div data-slot="cajon-detalle-cuerpo" className="min-h-0 flex-1 overflow-y-auto p-4">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
