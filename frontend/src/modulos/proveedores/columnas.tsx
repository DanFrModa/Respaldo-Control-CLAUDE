import { createColumnHelper } from '@tanstack/react-table';
import { MoreHorizontalIcon, PencilIcon, PowerIcon, PowerOffIcon } from 'lucide-react';

import { ETIQUETAS_TIPO_PROVEEDOR } from '@/api/esquemas';
import type { Proveedor } from '@/api/tipos';
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
 * Acciones por fila de la tabla de proveedores (mismo patron que Almacenes): se
 * inyectan por el `meta` generico de la tabla (`@/modulos/tabla-meta`). Editar
 * siempre; desactivar/reactivar segun el estado de la fila.
 */
export type AccionesProveedor = AccionesFila<Proveedor>;

const columnHelper = createColumnHelper<Proveedor>();

/**
 * Columnas de la tabla de proveedores (TanStack Table). `nombre` y `tipo` son
 * ordenables (coinciden con lo que el backend sabe ordenar); el contacto y el
 * estado no. Las acciones leen `AccionesProveedor` del `meta` de la tabla.
 */
export const columnasProveedores = [
  columnHelper.accessor('nombre', {
    header: 'Nombre',
    enableSorting: true,
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor('tipo', {
    header: 'Tipo',
    enableSorting: true,
    cell: (info) => <Badge variant="outline">{ETIQUETAS_TIPO_PROVEEDOR[info.getValue()]}</Badge>,
  }),
  columnHelper.accessor('contacto', {
    id: 'contacto',
    header: 'Contacto',
    enableSorting: false,
    cell: (info) => {
      const valor = info.getValue();
      const telefono = info.row.original.telefono;
      if (valor === null && telefono === null) {
        return <span className="text-muted-foreground">—</span>;
      }
      return (
        <div className="flex flex-col">
          {valor !== null ? <span>{valor}</span> : null}
          {telefono !== null ? (
            <span className="text-xs text-muted-foreground">{telefono}</span>
          ) : null}
        </div>
      );
    },
  }),
  columnHelper.accessor('activo', {
    id: 'estado',
    header: 'Estado',
    enableSorting: false,
    // El badge de inactivo va atenuado (variante suave): es un estado valido, no
    // una alarma.
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
      const proveedor = row.original;
      return (
        <div className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Acciones de ${proveedor.nombre}`}
                data-testid="acciones-proveedor"
              >
                <MoreHorizontalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => alEditar(proveedor)} data-testid="editar-proveedor">
                <PencilIcon aria-hidden />
                Editar
              </DropdownMenuItem>
              {proveedor.activo ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => alDesactivar(proveedor)}
                  data-testid="desactivar-proveedor"
                >
                  <PowerOffIcon aria-hidden />
                  Desactivar
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={() => alReactivar(proveedor)}
                  data-testid="activar-proveedor"
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
