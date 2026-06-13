import { createColumnHelper } from '@tanstack/react-table';
import { MoreHorizontalIcon, PencilIcon, PowerIcon, PowerOffIcon } from 'lucide-react';

import type { Color } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AccionesFila } from '@/modulos/tabla-meta';

/** Acciones por fila de la tabla de colores (mismo patron que Almacenes). */
export type AccionesColor = AccionesFila<Color>;

const columnHelper = createColumnHelper<Color>();

/**
 * Columnas de la tabla de colores (TanStack Table). Solo `nombre` es ordenable
 * (lo que el backend sabe ordenar); el estado no. Las acciones leen
 * `AccionesColor` del `meta` de la tabla.
 */
export const columnasColores = [
  columnHelper.accessor('nombre', {
    header: 'Nombre',
    enableSorting: true,
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor('activo', {
    id: 'estado',
    header: 'Estado',
    enableSorting: false,
    cell: (info) =>
      info.getValue() ? (
        <Badge variant="secondary">Activo</Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          Inactivo
        </Badge>
      ),
  }),
  columnHelper.display({
    id: 'acciones',
    header: () => <span className="sr-only">Acciones</span>,
    cell: ({ row, table }) => {
      const acciones = table.options.meta?.acciones;
      if (!acciones?.puedeAdministrar) {
        return null;
      }
      const { alEditar, alDesactivar, alReactivar } = acciones;
      const color = row.original;
      return (
        <div className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Acciones de ${color.nombre}`}
                data-testid="acciones-color"
              >
                <MoreHorizontalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => alEditar(color)} data-testid="editar-color">
                <PencilIcon aria-hidden />
                Editar
              </DropdownMenuItem>
              {color.activo ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => alDesactivar(color)}
                  data-testid="desactivar-color"
                >
                  <PowerOffIcon aria-hidden />
                  Desactivar
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => alReactivar(color)} data-testid="activar-color">
                  <PowerIcon aria-hidden />
                  Activar
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    },
  }),
];
