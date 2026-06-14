import { X } from 'lucide-react';

import type { Proveedor } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Un renglon de proveedor del avio EN CAPTURA: a que proveedor se le compra y a que
 * precio/condiciones (R1). `precio` se captura como TEXTO (igual que todo numerico opcional
 * en formularios: `<input type="number">` siempre entrega string; vacio = sin precio). La
 * conversion a number la hace el dialogo al armar el cuerpo del API.
 */
export interface RenglonProveedorAvio {
  idProveedor: number;
  /** Precio como texto (vacio = sin precio). El dialogo lo convierte a number al enviar. */
  precio: string;
  condiciones: string;
}

/**
 * SELECTOR DE PROVEEDORES DE UN AVIO (F1-E3, R1): a diferencia del `SelectorRolesProveedor`
 * (checkboxes sin datos) o el `ArmadorCurva` (orden sin datos), aqui cada proveedor
 * elegido lleva DATOS propios — precio y condiciones — porque el mismo avio se compra a
 * varios proveedores a precios distintos (insight del dueño). El usuario:
 *   - elige un proveedor del catalogo (`/api/proveedores`, solo activos) y lo agrega;
 *   - captura su precio y condiciones en el renglon;
 *   - quita renglones.
 * Impide elegir un proveedor ya agregado (no se repite). Un avio PUEDE quedar sin
 * proveedores (≥0): puede ser generico o costearse por su precio de referencia.
 *
 * El estado vive en el dialogo padre (`renglones` + `alCambiar`), que los envia INLINE en
 * el cuerpo del API. El backend valida (proveedores activos, sin repetidos) y es la
 * autoridad (A1).
 */
export function SelectorProveedoresAvio({
  proveedores,
  cargando,
  error,
  renglones,
  alCambiar,
  deshabilitado = false,
}: {
  /** Catalogo de proveedores ACTIVOS disponibles. */
  proveedores: readonly Proveedor[];
  cargando: boolean;
  /** Mensaje de error al cargar el catalogo de proveedores, o `null` si cargo bien. */
  error: string | null;
  /** Renglones elegidos (proveedor + precio/condiciones). */
  renglones: RenglonProveedorAvio[];
  alCambiar: (renglones: RenglonProveedorAvio[]) => void;
  deshabilitado?: boolean;
}): React.JSX.Element {
  /** Mapa id → proveedor para pintar el nombre de los elegidos. */
  const porId = new Map(proveedores.map((proveedor) => [proveedor.id, proveedor]));
  /** Ids ya elegidos (para no repetir). */
  const elegidos = new Set(renglones.map((renglon) => renglon.idProveedor));
  /** Proveedores aun no elegidos (los que se pueden agregar). */
  const disponibles = proveedores.filter((proveedor) => !elegidos.has(proveedor.id));

  function agregar(id: number): void {
    if (id <= 0 || elegidos.has(id)) {
      return;
    }
    alCambiar([...renglones, { idProveedor: id, precio: '', condiciones: '' }]);
  }

  function quitar(id: number): void {
    alCambiar(renglones.filter((renglon) => renglon.idProveedor !== id));
  }

  function cambiarCampo(id: number, campo: 'precio' | 'condiciones', valor: string): void {
    alCambiar(
      renglones.map((renglon) =>
        renglon.idProveedor === id ? { ...renglon, [campo]: valor } : renglon,
      ),
    );
  }

  return (
    <Field role="group" aria-labelledby="selector-proveedores-avio-titulo">
      <FieldLabel id="selector-proveedores-avio-titulo" asChild>
        <span>Proveedores y precios</span>
      </FieldLabel>
      <FieldDescription>
        A quién se le compra este avío y a qué precio (opcional: un avío puede no tener
        proveedores).
      </FieldDescription>

      {cargando ? (
        <div className="flex flex-col gap-2" data-testid="proveedores-avio-cargando">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : error !== null ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <div className="space-y-3" data-testid="selector-proveedores-avio">
          {/* Agregar un proveedor (no repetible). */}
          <div className="flex items-center gap-2">
            <SelectNativo
              aria-label="Agregar proveedor"
              data-testid="agregar-proveedor-avio"
              disabled={deshabilitado || disponibles.length === 0}
              value=""
              onChange={(e) => {
                const id = Number(e.target.value);
                if (Number.isFinite(id) && id > 0) {
                  agregar(id);
                }
              }}
            >
              <option value="">
                {proveedores.length === 0
                  ? 'No hay proveedores activos'
                  : disponibles.length === 0
                    ? 'Ya agregaste todos los proveedores'
                    : 'Agregar proveedor…'}
              </option>
              {disponibles.map((proveedor) => (
                <option key={proveedor.id} value={String(proveedor.id)}>
                  {proveedor.nombre}
                </option>
              ))}
            </SelectNativo>
          </div>

          {/* Renglones elegidos (proveedor + precio + condiciones). */}
          {renglones.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              Aún no hay proveedores. Agrégalos arriba (opcional).
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="proveedores-avio-elegidos">
              {renglones.map((renglon) => {
                const proveedor = porId.get(renglon.idProveedor);
                const nombre = proveedor?.nombre ?? `#${String(renglon.idProveedor)}`;
                return (
                  <li
                    key={renglon.idProveedor}
                    className="rounded-lg border p-3"
                    data-testid={`proveedor-avio-${renglon.idProveedor}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{nombre}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-destructive"
                        disabled={deshabilitado}
                        onClick={() => quitar(renglon.idProveedor)}
                        aria-label={`Quitar ${nombre}`}
                        data-testid={`quitar-proveedor-avio-${renglon.idProveedor}`}
                      >
                        <X className="size-4" aria-hidden />
                      </Button>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr]">
                      <div>
                        <label
                          htmlFor={`precio-proveedor-${renglon.idProveedor}`}
                          className="text-xs text-muted-foreground"
                        >
                          Precio
                        </label>
                        <Input
                          id={`precio-proveedor-${renglon.idProveedor}`}
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          placeholder="0.00"
                          disabled={deshabilitado}
                          value={renglon.precio}
                          onChange={(e) =>
                            cambiarCampo(renglon.idProveedor, 'precio', e.target.value)
                          }
                          data-testid={`precio-proveedor-avio-${renglon.idProveedor}`}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`condiciones-proveedor-${renglon.idProveedor}`}
                          className="text-xs text-muted-foreground"
                        >
                          Condiciones
                        </label>
                        <Input
                          id={`condiciones-proveedor-${renglon.idProveedor}`}
                          type="text"
                          placeholder="p. ej. contado, mín. 1 caja…"
                          disabled={deshabilitado}
                          value={renglon.condiciones}
                          onChange={(e) =>
                            cambiarCampo(renglon.idProveedor, 'condiciones', e.target.value)
                          }
                          data-testid={`condiciones-proveedor-avio-${renglon.idProveedor}`}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <FieldError errors={[]} />
    </Field>
  );
}
