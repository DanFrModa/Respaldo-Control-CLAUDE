import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';

import type { Talla } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * ARMADOR DE CURVA (F1-E2, PIEZA B — D4): selector ORDENADO de tallas para una curva.
 * A diferencia del `SelectorRolesProveedor` (checkboxes sin orden), aqui el ORDEN
 * importa: la posicion de cada talla en la curva la define su posicion en esta lista
 * (la asigna el backend por el orden del arreglo). El usuario:
 *   - agrega tallas del catalogo de DISPONIBLES (solo activas) a la curva;
 *   - las reordena con subir/bajar;
 *   - las quita.
 *
 * El estado vive en el dialogo padre (`seleccionados` = ids en orden + `alCambiar`),
 * que los envia INLINE en el cuerpo del API. El backend exige ≥1, sin repetidos y solo
 * tallas activas, y es la autoridad (A1); aqui se muestra el mismo requisito como ayuda
 * de captura (`mensajeError`).
 */
export function ArmadorCurva({
  tallas,
  cargando,
  error,
  seleccionados,
  alCambiar,
  mensajeError,
  deshabilitado = false,
}: {
  /** Catalogo de tallas ACTIVAS disponibles para armar la curva. */
  tallas: readonly Talla[];
  cargando: boolean;
  /** Mensaje de error al cargar el catalogo de tallas, o `null` si cargo bien. */
  error: string | null;
  /** Ids de talla ELEGIDOS, EN ORDEN (la posicion la define este orden). */
  seleccionados: number[];
  alCambiar: (ids: number[]) => void;
  /** Mensaje de validacion de captura (p. ej. "Agrega al menos una talla"), o `null`. */
  mensajeError?: string | null;
  deshabilitado?: boolean;
}): React.JSX.Element {
  /** Mapa id → talla para pintar las etiquetas de las elegidas en su orden. */
  const porId = new Map(tallas.map((talla) => [talla.id, talla]));
  /** Tallas aun no elegidas (las que se pueden agregar). */
  const disponibles = tallas.filter((talla) => !seleccionados.includes(talla.id));

  function agregar(id: number): void {
    if (!seleccionados.includes(id)) {
      alCambiar([...seleccionados, id]);
    }
  }

  function quitar(id: number): void {
    alCambiar(seleccionados.filter((actual) => actual !== id));
  }

  /** Intercambia la talla en `indice` con su vecina (`-1` arriba, `+1` abajo). */
  function mover(indice: number, delta: -1 | 1): void {
    const destino = indice + delta;
    if (destino < 0 || destino >= seleccionados.length) {
      return;
    }
    const copia = [...seleccionados];
    const actual = copia[indice];
    const otro = copia[destino];
    if (actual === undefined || otro === undefined) {
      return;
    }
    copia[indice] = otro;
    copia[destino] = actual;
    alCambiar(copia);
  }

  return (
    <Field role="group" aria-labelledby="armador-curva-titulo" data-invalid={Boolean(mensajeError)}>
      <FieldLabel id="armador-curva-titulo" asChild>
        <span>Tallas de la curva</span>
      </FieldLabel>
      <FieldDescription>
        Agrega las tallas en el orden de la curva (de la más chica a la más grande).
      </FieldDescription>

      {cargando ? (
        <div className="flex flex-col gap-2" data-testid="armador-curva-cargando">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : error !== null ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="armador-curva">
          {/* Elegidas, EN ORDEN */}
          <div className="rounded-lg border">
            <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
              En la curva ({seleccionados.length})
            </p>
            {seleccionados.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Aún no hay tallas. Agrégalas desde la derecha.
              </p>
            ) : (
              <ol className="flex flex-col gap-1 p-2" data-testid="armador-curva-elegidas">
                {seleccionados.map((id, indice) => {
                  const talla = porId.get(id);
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5"
                      data-testid={`curva-elegida-${id}`}
                    >
                      <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                        {indice + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {talla?.etiqueta ?? `#${String(id)}`}
                      </span>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          disabled={deshabilitado || indice === 0}
                          onClick={() => mover(indice, -1)}
                          aria-label={`Subir ${talla?.etiqueta ?? 'talla'}`}
                          data-testid={`subir-${id}`}
                        >
                          <ArrowUp className="size-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          disabled={deshabilitado || indice === seleccionados.length - 1}
                          onClick={() => mover(indice, 1)}
                          aria-label={`Bajar ${talla?.etiqueta ?? 'talla'}`}
                          data-testid={`bajar-${id}`}
                        >
                          <ArrowDown className="size-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                          disabled={deshabilitado}
                          onClick={() => quitar(id)}
                          aria-label={`Quitar ${talla?.etiqueta ?? 'talla'}`}
                          data-testid={`quitar-${id}`}
                        >
                          <X className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {/* Disponibles para agregar */}
          <div className="rounded-lg border">
            <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
              Disponibles ({disponibles.length})
            </p>
            {disponibles.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {tallas.length === 0
                  ? 'No hay tallas activas. Crea tallas primero.'
                  : 'Ya agregaste todas las tallas.'}
              </p>
            ) : (
              <ul
                className="flex max-h-56 flex-col gap-1 overflow-y-auto p-2"
                data-testid="armador-curva-disponibles"
              >
                {disponibles.map((talla) => (
                  <li key={talla.id}>
                    <button
                      type="button"
                      disabled={deshabilitado}
                      onClick={() => agregar(talla.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                        'hover:bg-primary-soft disabled:opacity-50',
                      )}
                      data-testid={`agregar-talla-${talla.id}`}
                    >
                      <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-medium">{talla.etiqueta}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {mensajeError ? <FieldError errors={[{ message: mensajeError }]} /> : null}
    </Field>
  );
}
