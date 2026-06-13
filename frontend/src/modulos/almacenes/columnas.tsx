import { createColumnHelper } from '@tanstack/react-table';
import { MoreHorizontalIcon, PencilIcon, PowerIcon, PowerOffIcon } from 'lucide-react';

import { ETIQUETAS_TIPO_ALMACEN } from '@/api/esquemas';
import type { Almacen } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AccionesFila } from '@/modulos/tabla-meta';

/**
 * Acciones por fila de la tabla de almacenes. Se pasan por `meta` de la tabla
 * (augment generico unico en `@/modulos/tabla-meta`) para que las celdas las
 * invoquen sin acoplar las columnas al estado de la pagina. Editar siempre;
 * desactivar (si esta activa) o reactivar (si esta inactiva) segun el estado.
 */
export type AccionesAlmacen = AccionesFila<Almacen>;

const columnHelper = createColumnHelper<Almacen>();

/**
 * Definicion de columnas de la tabla de almacenes (TanStack Table). Solo
 * `nombre` y `tipo` son ordenables (coinciden con las columnas que el backend
 * sabe ordenar); `estado` y `acciones` no. Las acciones leen `AccionesAlmacen`
 * del `meta` de la tabla.
 */
export const columnasAlmacenes = [
  columnHelper.accessor('nombre', {
    header: 'Nombre',
    enableSorting: true,
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor('tipo', {
    header: 'Tipo',
    enableSorting: true,
    cell: (info) => <Badge variant="outline">{ETIQUETAS_TIPO_ALMACEN[info.getValue()]}</Badge>,
  }),
  columnHelper.accessor('activo', {
    id: 'estado',
    header: 'Estado',
    enableSorting: false,
    // El badge de inactivo va atenuado (variante suave) para distinguirlo de un
    // estado de error: es un estado valido, no una alarma.
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
      const almacen = row.original;
      return (
        <div className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Acciones de ${almacen.nombre}`}
                data-testid="acciones-almacen"
              >
                <MoreHorizontalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => alEditar(almacen)} data-testid="editar-almacen">
                <PencilIcon aria-hidden />
                Editar
              </DropdownMenuItem>
              {almacen.activo ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => alDesactivar(almacen)}
                  data-testid="desactivar-almacen"
                >
                  <PowerOffIcon aria-hidden />
                  Desactivar
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={() => alReactivar(almacen)}
                  data-testid="activar-almacen"
                >
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
