import { createColumnHelper } from '@tanstack/react-table';
import { MoreHorizontalIcon, PencilIcon, PowerIcon, PowerOffIcon } from 'lucide-react';

import type { EtiquetaMarca } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AccionesFila } from '@/modulos/tabla-meta';

/** Acciones por fila de la tabla de etiquetas de marca (mismo patron que Almacenes). */
export type AccionesEtiquetaMarca = AccionesFila<EtiquetaMarca>;

const columnHelper = createColumnHelper<EtiquetaMarca>();

/** Formatea el porcentaje de regalías (hasta 2 decimales, sin ceros sobrantes). */
const FORMATO_PORCENTAJE = new Intl.NumberFormat('es-MX', {
  maximumFractionDigits: 2,
});

/**
 * Columnas de la tabla de etiquetas de marca (TanStack Table). `nombre` y
 * `regalias` son ordenables (lo que el backend sabe ordenar); el estado no. Las
 * acciones leen `AccionesEtiquetaMarca` del `meta` de la tabla.
 */
export const columnasEtiquetasMarca = [
  columnHelper.accessor('nombre', {
    header: 'Nombre',
    enableSorting: true,
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor('regalias', {
    header: 'Regalías',
    enableSorting: true,
    cell: (info) => (
      <span className="tabular-nums">{FORMATO_PORCENTAJE.format(info.getValue())}%</span>
    ),
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
      const etiqueta = row.original;
      return (
        <div className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Acciones de ${etiqueta.nombre}`}
                data-testid="acciones-etiqueta-marca"
              >
                <MoreHorizontalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => alEditar(etiqueta)}
                data-testid="editar-etiqueta-marca"
              >
                <PencilIcon aria-hidden />
                Editar
              </DropdownMenuItem>
              {etiqueta.activo ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => alDesactivar(etiqueta)}
                  data-testid="desactivar-etiqueta-marca"
                >
                  <PowerOffIcon aria-hidden />
                  Desactivar
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={() => alReactivar(etiqueta)}
                  data-testid="activar-etiqueta-marca"
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
