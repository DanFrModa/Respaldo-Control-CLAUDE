import { createColumnHelper } from '@tanstack/react-table';
import { MoreHorizontalIcon, PencilIcon, PowerIcon, PowerOffIcon } from 'lucide-react';

import type { Cortador } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AccionesFila } from '@/modulos/tabla-meta';

/** Acciones por fila de la tabla de cortadores (mismo patron que Almacenes). */
export type AccionesCortador = AccionesFila<Cortador>;

const columnHelper = createColumnHelper<Cortador>();

/** Formatea el precio de referencia (o un guion si no hay). */
const FORMATO_MONEDA = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
});

/**
 * Columnas de la tabla de cortadores (TanStack Table). Solo `nombre` es ordenable
 * (lo que el backend sabe ordenar); precio, teléfonos y estado no. Las acciones
 * leen `AccionesCortador` del `meta` de la tabla.
 */
export const columnasCortadores = [
  columnHelper.accessor('nombre', {
    header: 'Nombre',
    enableSorting: true,
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor('precioReferencia', {
    id: 'precioReferencia',
    header: 'Precio de referencia',
    enableSorting: false,
    cell: (info) => {
      const valor = info.getValue();
      return valor === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">{FORMATO_MONEDA.format(valor)}</span>
      );
    },
  }),
  columnHelper.accessor('telefonos', {
    id: 'telefonos',
    header: 'Teléfonos',
    enableSorting: false,
    cell: (info) => {
      const valor = info.getValue();
      return valor === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span>{valor}</span>
      );
    },
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
      const cortador = row.original;
      return (
        <div className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Acciones de ${cortador.nombre}`}
                data-testid="acciones-cortador"
              >
                <MoreHorizontalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => alEditar(cortador)} data-testid="editar-cortador">
                <PencilIcon aria-hidden />
                Editar
              </DropdownMenuItem>
              {cortador.activo ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => alDesactivar(cortador)}
                  data-testid="desactivar-cortador"
                >
                  <PowerOffIcon aria-hidden />
                  Desactivar
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={() => alReactivar(cortador)}
                  data-testid="activar-cortador"
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
