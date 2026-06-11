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

/**
 * Acciones por fila que la pagina inyecta a las columnas. Se pasan por `meta` de
 * la tabla para que las celdas las invoquen sin acoplar las columnas al estado
 * de la pagina. Segun el estado de la fila se ofrece desactivar (si esta activa)
 * o reactivar (si esta inactiva); editar siempre.
 */
export interface AccionesAlmacen {
  puedeAdministrar: boolean;
  alEditar: (almacen: Almacen) => void;
  alDesactivar: (almacen: Almacen) => void;
  alReactivar: (almacen: Almacen) => void;
}

/**
 * Las columnas leen las acciones por fila del `meta` de la tabla (TanStack
 * Table). Se augmenta `TableMeta` para que ese acceso sea TIPADO (sin `any` ni
 * casts): la tabla de almacenes provee {@link AccionesAlmacen} en su `meta`.
 */
declare module '@tanstack/react-table' {
  // El parametro TData es obligatorio en la firma de la interfaz original.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData> {
    acciones?: AccionesAlmacen;
  }
}

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
