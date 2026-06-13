import { createColumnHelper } from '@tanstack/react-table';
import {
  KeyRoundIcon,
  LockOpenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PowerIcon,
  PowerOffIcon,
} from 'lucide-react';

import type { Usuario } from '@/api/tipos';
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
 * Acciones por fila COMPARTIDAS de la tabla de usuarios (editar, desactivar,
 * reactivar): se inyectan por el `meta` generico de la tabla
 * (`@/modulos/tabla-meta`), igual que en los catalogos. Las acciones propias de
 * usuarios (desbloquear, cambiar contraseña) no caben en ese `meta` generico, asi
 * que se pasan a la fabrica de columnas por cierre (`AccionesExtraUsuario`).
 */
export type AccionesUsuario = AccionesFila<Usuario>;

/** Acciones especificas de usuarios que no forman parte del `meta` generico. */
export interface AccionesExtraUsuario {
  /** Desbloquea un usuario bloqueado por intentos fallidos. */
  alDesbloquear: (usuario: Usuario) => void;
  /** Abre el dialogo de cambio de contraseña. */
  alCambiarContrasena: (usuario: Usuario) => void;
}

const columnHelper = createColumnHelper<Usuario>();

/**
 * Columnas de la tabla de usuarios (TanStack Table). `username` y `nombre` son
 * ordenables (coinciden con lo que el backend sabe ordenar); roles y estado no.
 * Es una FABRICA porque las acciones de desbloqueo/contraseña se pasan por cierre
 * (no caben en el `meta` generico); las de editar/desactivar/reactivar siguen
 * leyendose del `meta` de la tabla.
 */
export function columnasUsuarios(extra: AccionesExtraUsuario) {
  return [
    columnHelper.accessor('username', {
      header: 'Usuario',
      enableSorting: true,
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
    }),
    columnHelper.accessor('nombre', {
      header: 'Nombre',
      enableSorting: true,
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor('roles', {
      id: 'roles',
      header: 'Roles',
      enableSorting: false,
      cell: (info) => {
        const roles = info.getValue();
        if (roles.length === 0) {
          return <span className="text-muted-foreground">Sin roles</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {roles.map((rol) => (
              <Badge key={rol.id} variant="outline">
                {rol.nombre}
              </Badge>
            ))}
          </div>
        );
      },
    }),
    columnHelper.display({
      id: 'estado',
      header: 'Estado',
      cell: ({ row }) => {
        const usuario = row.original;
        if (!usuario.activo) {
          return (
            <Badge variant="outline" className="text-muted-foreground">
              Inactivo
            </Badge>
          );
        }
        if (usuario.bloqueado) {
          return (
            <Badge variant="destructive" title={`${usuario.intentosFallidos} intentos fallidos`}>
              Bloqueado
            </Badge>
          );
        }
        return <Badge variant="secondary">Activo</Badge>;
      },
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
        const usuario = row.original;
        return (
          <div className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Acciones de ${usuario.username}`}
                  data-testid="acciones-usuario"
                >
                  <MoreHorizontalIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => alEditar(usuario)} data-testid="editar-usuario">
                  <PencilIcon aria-hidden />
                  Editar
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => extra.alCambiarContrasena(usuario)}
                  data-testid="contrasena-usuario"
                >
                  <KeyRoundIcon aria-hidden />
                  Cambiar contraseña
                </DropdownMenuItem>
                {usuario.bloqueado ? (
                  <DropdownMenuItem
                    onSelect={() => extra.alDesbloquear(usuario)}
                    data-testid="desbloquear-usuario"
                  >
                    <LockOpenIcon aria-hidden />
                    Desbloquear
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                {usuario.activo ? (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => alDesactivar(usuario)}
                    data-testid="desactivar-usuario"
                  >
                    <PowerOffIcon aria-hidden />
                    Desactivar
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() => alReactivar(usuario)}
                    data-testid="activar-usuario"
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
