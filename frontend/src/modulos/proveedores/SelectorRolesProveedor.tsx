import type { RolProveedor } from '@/api/tipos';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Selector MULTIPLE de roles/servicios de proveedor (F1-E1B, R15). Lista los roles
 * activos (`GET /api/roles-proveedor`) como checkboxes; el estado vive en el dialogo
 * padre (`seleccionados` + `alCambiar`), que los envia INLINE en el cuerpo del API
 * (alta/edicion, misma transaccion A2). El backend exige ≥1 y es la autoridad (A1);
 * aqui se muestra el mismo requisito como ayuda de captura (`mensajeError`).
 *
 * Usa checkboxes nativos (mismo patron que el `SelectorRoles` de Usuarios): para un
 * catalogo corto y conocido son la mejor UX y son totalmente accesibles.
 */
export function SelectorRolesProveedor({
  roles,
  cargando,
  error,
  seleccionados,
  alCambiar,
  mensajeError,
  deshabilitado = false,
}: {
  roles: readonly RolProveedor[];
  cargando: boolean;
  /** Mensaje de error al cargar el catalogo de roles, o `null` si cargaron bien. */
  error: string | null;
  seleccionados: number[];
  alCambiar: (ids: number[]) => void;
  /** Mensaje de validacion de captura (p. ej. "Elige al menos un rol"), o `null`. */
  mensajeError?: string | null;
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
    <Field
      role="group"
      aria-labelledby="selector-roles-proveedor-titulo"
      data-invalid={Boolean(mensajeError)}
    >
      <FieldLabel id="selector-roles-proveedor-titulo" asChild>
        <span>Roles / servicios</span>
      </FieldLabel>
      <FieldDescription>Qué hace este proveedor (elige al menos uno).</FieldDescription>

      {cargando ? (
        <div className="flex flex-col gap-2" data-testid="roles-proveedor-cargando">
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
          data-testid="selector-roles-proveedor"
        >
          {roles.map((rol) => {
            const idCheckbox = `rol-proveedor-${rol.id}`;
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
                  data-testid={`rol-proveedor-opcion-${rol.id}`}
                />
                <span>{rol.nombre}</span>
              </label>
            );
          })}
        </div>
      )}
      {mensajeError ? <FieldError errors={[{ message: mensajeError }]} /> : null}
    </Field>
  );
}
