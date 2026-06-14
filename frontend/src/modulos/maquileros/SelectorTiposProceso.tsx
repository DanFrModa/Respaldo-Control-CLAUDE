import type { TipoProceso } from '@/api/tipos';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Selector MULTIPLE de tipos de proceso (capacidades del maquilero, F1-E2; maquila
 * unificada). Lista los tipos activos (`GET /api/tipos-proceso`) como checkboxes; el
 * estado vive en el dialogo padre (`seleccionados` + `alCambiar`), que los envia INLINE
 * en el cuerpo del API (alta/edicion, misma transaccion A2). El backend exige ≥1 y es la
 * autoridad (A1); aqui se muestra el mismo requisito como ayuda de captura (`mensajeError`).
 *
 * Clon de `SelectorRolesProveedor` (Proveedores): checkboxes nativos, la mejor UX para un
 * catalogo corto y conocido, y totalmente accesibles.
 */
export function SelectorTiposProceso({
  tipos,
  cargando,
  error,
  seleccionados,
  alCambiar,
  mensajeError,
  deshabilitado = false,
}: {
  tipos: readonly TipoProceso[];
  cargando: boolean;
  /** Mensaje de error al cargar el catalogo de tipos, o `null` si cargaron bien. */
  error: string | null;
  seleccionados: number[];
  alCambiar: (ids: number[]) => void;
  /** Mensaje de validacion de captura (p. ej. "Elige al menos un tipo"), o `null`. */
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
      aria-labelledby="selector-tipos-proceso-titulo"
      data-invalid={Boolean(mensajeError)}
    >
      <FieldLabel id="selector-tipos-proceso-titulo" asChild>
        <span>Tipos de proceso</span>
      </FieldLabel>
      <FieldDescription>Qué procesos hace este maquilero (elige al menos uno).</FieldDescription>

      {cargando ? (
        <div className="flex flex-col gap-2" data-testid="tipos-proceso-cargando">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-32" />
        </div>
      ) : error !== null ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : tipos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay tipos de proceso disponibles.</p>
      ) : (
        <div
          className="grid grid-cols-1 gap-1.5 rounded-lg border p-3 sm:grid-cols-2"
          data-testid="selector-tipos-proceso"
        >
          {tipos.map((tipo) => {
            const idCheckbox = `tipo-proceso-${tipo.id}`;
            const marcado = seleccionados.includes(tipo.id);
            return (
              <label
                key={tipo.id}
                htmlFor={idCheckbox}
                className="flex items-center gap-2 text-sm leading-snug"
              >
                <input
                  id={idCheckbox}
                  type="checkbox"
                  className="size-4 rounded border-input accent-primary"
                  checked={marcado}
                  disabled={deshabilitado}
                  onChange={(e) => alternar(tipo.id, e.target.checked)}
                  data-testid={`tipo-proceso-opcion-${tipo.id}`}
                />
                <span>{tipo.nombre}</span>
              </label>
            );
          })}
        </div>
      )}
      {mensajeError ? <FieldError errors={[{ message: mensajeError }]} /> : null}
    </Field>
  );
}
