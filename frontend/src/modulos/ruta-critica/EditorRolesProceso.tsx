import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useRoles } from '@/api/roles';
import { useFijarRolesProcesoRc } from '@/api/ruta-critica';
import type { ProcesoRc } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Editor de los ROLES RESPONSABLES de un proceso de la RC (N:M sobre el RBAC único, A4). Lista los
 * roles (`GET /api/roles`) como checkboxes y guarda el set COMPLETO con `PUT .../{id}/roles`. El
 * backend valida y es la autoridad (A1). Solo se muestra a quien puede administrar el catálogo.
 *
 * Nota: `GET /api/roles` exige `roles.administrar`; en el seed, quien administra la RC es el admin
 * (que tiene ambos permisos). Si la lista de roles no carga, se muestra el error sin romper la UI.
 */
export function EditorRolesProceso({
  proceso,
  puedeAdministrar,
}: {
  proceso: ProcesoRc;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const consultaRoles = useRoles();
  const fijarRoles = useFijarRolesProcesoRc();

  const [seleccionados, setSeleccionados] = useState<number[]>(() =>
    proceso.roles.map((r) => r.idRol),
  );

  // Al cambiar de proceso, reinicia el set local con sus roles actuales.
  useEffect(() => {
    setSeleccionados(proceso.roles.map((r) => r.idRol));
  }, [proceso.id, proceso.roles]);

  function alternar(id: number, marcado: boolean): void {
    setSeleccionados((actual) => (marcado ? [...actual, id] : actual.filter((x) => x !== id)));
  }

  function guardar(): void {
    fijarRoles.mutate(
      { id: proceso.id, cuerpo: { idsRoles: seleccionados } },
      {
        onSuccess: () => toast.success('Roles responsables actualizados.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  if (consultaRoles.isPending) {
    return (
      <div className="flex flex-col gap-2" data-testid="roles-proceso-cargando">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-5 w-40" />
      </div>
    );
  }
  if (consultaRoles.isError) {
    return <p className="text-sm text-destructive">{consultaRoles.error.message}</p>;
  }

  const roles = consultaRoles.data;
  if (roles.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay roles disponibles.</p>;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="editor-roles-proceso">
      <div className="grid grid-cols-1 gap-1.5 rounded-lg border p-3 sm:grid-cols-2">
        {roles.map((rol) => {
          const idCheckbox = `rol-proceso-${rol.id}`;
          const marcado = seleccionados.includes(rol.id);
          return (
            <label
              key={rol.id}
              htmlFor={idCheckbox}
              className="flex items-center gap-2 text-sm leading-snug"
            >
              <input
                id={idCheckbox}
                type="checkbox"
                className="size-4 rounded border-input accent-primary disabled:opacity-50"
                checked={marcado}
                disabled={!puedeAdministrar || fijarRoles.isPending}
                onChange={(e) => alternar(rol.id, e.target.checked)}
                data-testid={`rol-proceso-opcion-${rol.id}`}
              />
              <span>{rol.nombre}</span>
            </label>
          );
        })}
      </div>
      {puedeAdministrar ? (
        <div>
          <Button
            type="button"
            size="sm"
            onClick={guardar}
            disabled={fijarRoles.isPending}
            data-testid="guardar-roles-proceso"
          >
            {fijarRoles.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Guardar roles
          </Button>
        </div>
      ) : null}
    </div>
  );
}
