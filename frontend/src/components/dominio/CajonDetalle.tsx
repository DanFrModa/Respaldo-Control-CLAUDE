import * as React from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * CAJON DE DETALLE deslizante del rediseño (proto `.drawer`): panel lateral
 * derecho sobre `ui/sheet` con encabezado fijo (titulo + subtitulo + acciones)
 * y CUERPO SCROLLEABLE. Es el patron "tabla-first": la lista ocupa la pantalla
 * y el detalle del renglon elegido se asoma sin navegar.
 *
 * Controlado por el llamador (`abierto`/`alCambiarAbierto`); el contenido lo
 * arma cada pantalla (secciones, chips, tablas). Cerrar: la X del sheet, Esc o
 * clic fuera.
 */
export function CajonDetalle({
  abierto,
  alCambiarAbierto,
  titulo,
  subtitulo,
  acciones,
  children,
  className,
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
}): React.JSX.Element {
  return (
    <Sheet open={abierto} onOpenChange={alCambiarAbierto}>
      <SheetContent
        side="right"
        data-slot="cajon-detalle"
        className={cn('w-full gap-0 p-0 sm:max-w-md', className)}
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
