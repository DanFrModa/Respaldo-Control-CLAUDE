import type { Rol } from '@/api/tipos';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Selector MULTIPLE de roles (RBAC A4) para el alta/edicion de usuario. Lista los
 * roles disponibles (`GET /api/roles`) como checkboxes; el estado vive en el
 * dialogo padre (`seleccionados` + `alCambiar`), que lo envia dentro del cuerpo
 * del API (alta) o como reemplazo de roles (edicion). El backend valida y es la
 * autoridad (A1).
 *
 * Se usan checkboxes nativos (no hay componente Checkbox de shadcn en el proyecto
 * y un `<select multiple>` es peor UX para un catalogo corto y conocido). Muestra
 * su propio estado de carga y de error para no bloquear el resto del formulario.
 */
export function SelectorRoles({
  roles,
  cargando,
  error,
  seleccionados,
  alCambiar,
  deshabilitado = false,
}: {
  roles: readonly Rol[];
  cargando: boolean;
  /** Mensaje de error al cargar los roles, o `null` si cargaron bien. */
  error: string | null;
  seleccionados: number[];
  alCambiar: (ids: number[]) => void;
  deshabilitado?: boolean;
}): React.JSX.Element {
  function alternar(id: number, marcado: boolean): void {
    if (marcado) {
      alCambiar([...seleccionados, id]);
    } else {
      alCambiar(seleccionados.filter((actual) => actual !== id));
    }
  }

  return (
    <Field role="group" aria-labelledby="selector-roles-titulo">
      <FieldLabel id="selector-roles-titulo" asChild>
        <span>Roles</span>
      </FieldLabel>
      <FieldDescription>Determinan los permisos del usuario en el sistema.</FieldDescription>

      {cargando ? (
        <div className="flex flex-col gap-2" data-testid="roles-cargando">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-32" />
        </div>
      ) : error !== null ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : roles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay roles disponibles.</p>
      ) : (
        <div
          className="grid grid-cols-1 gap-1.5 rounded-lg border p-3 sm:grid-cols-2"
          data-testid="selector-roles"
        >
          {roles.map((rol) => {
            const idCheckbox = `rol-${rol.id}`;
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
                  className="size-4 rounded border-input accent-primary"
                  checked={marcado}
                  disabled={deshabilitado}
                  onChange={(e) => alternar(rol.id, e.target.checked)}
                  data-testid={`rol-opcion-${rol.id}`}
                />
                <span title={rol.descripcion}>{rol.nombre}</span>
              </label>
            );
          })}
        </div>
      )}
    </Field>
  );
}
