import { createColumnHelper } from '@tanstack/react-table';
import {
  MoreHorizontalIcon,
  PencilIcon,
  PowerIcon,
  PowerOffIcon,
  SettingsIcon,
  StarIcon,
} from 'lucide-react';

import type { Empresa } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AccionesFila } from '@/modulos/tabla-meta';

/**
 * Acciones por fila COMPARTIDAS de la tabla de empresas (editar, desactivar,
 * reactivar): se inyectan por el `meta` generico de la tabla. OJO: en empresas el
 * flag de borrado suave es `activa` (femenino); las acciones genericas solo
 * reciben la entidad, asi que el `meta` generico sirve igual (la distincion
 * activa/activo solo importa al RENDERIZAR el estado, que se hace aqui).
 */
export type AccionesEmpresa = AccionesFila<Empresa>;

/** Accion especifica de empresas (no cabe en el `meta` generico). */
export interface AccionesExtraEmpresa {
  /** Abre la configuracion (seccion secundaria) de la empresa. */
  alConfigurar: (empresa: Empresa) => void;
}

const columnHelper = createColumnHelper<Empresa>();

/** Texto opcional o un guion atenuado si viene vacio. */
function textoOGuion(valor: string | null): React.ReactNode {
  return valor !== null && valor.length > 0 ? (
    valor
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

/**
 * Columnas de la tabla de empresas (TanStack Table). El orden/busqueda es en
 * cliente (la lista no viene paginada), asi que el ordenamiento de columnas lo
 * gobierna la propia tabla. La fabrica recibe la accion de configurar por cierre;
 * editar/desactivar/reactivar se leen del `meta` de la tabla.
 */
export function columnasEmpresas(extra: AccionesExtraEmpresa) {
  return [
    columnHelper.accessor('nombre', {
      header: 'Nombre',
      enableSorting: true,
      cell: (info) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{info.getValue()}</span>
          {info.row.original.favorita ? (
            <span title="Empresa favorita (predeterminada)">
              <StarIcon className="size-3.5 fill-amber-400 text-amber-400" aria-label="Favorita" />
            </span>
          ) : null}
        </div>
      ),
    }),
    columnHelper.accessor('identificador', {
      id: 'identificador',
      header: 'Identificador',
      enableSorting: false,
      cell: (info) => textoOGuion(info.getValue()),
    }),
    columnHelper.accessor('upc', {
      id: 'upc',
      header: 'UPC',
      enableSorting: false,
      cell: (info) => textoOGuion(info.getValue()),
    }),
    columnHelper.accessor('activa', {
      id: 'estado',
      header: 'Estado',
      enableSorting: false,
      cell: (info) =>
        info.getValue() ? (
          <Badge variant="secondary">Activa</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Inactiva
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
        const empresa = row.original;
        return (
          <div className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Acciones de ${empresa.nombre}`}
                  data-testid="acciones-empresa"
                >
                  <MoreHorizontalIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => alEditar(empresa)} data-testid="editar-empresa">
                  <PencilIcon aria-hidden />
                  Editar
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => extra.alConfigurar(empresa)}
                  data-testid="configurar-empresa"
                >
                  <SettingsIcon aria-hidden />
                  Configuración
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {empresa.activa ? (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => alDesactivar(empresa)}
                    data-testid="desactivar-empresa"
                  >
                    <PowerOffIcon aria-hidden />
                    Desactivar
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() => alReactivar(empresa)}
                    data-testid="activar-empresa"
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
}
