import { Trash2Icon } from 'lucide-react';
import {
  Controller,
  useFieldArray,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectorModelo } from '@/modulos/inventarios/SelectorModelo';

import type { DatosPedidoFormulario } from './esquemas';

/**
 * Editor del GRID de renglones de un pedido (modelo + cantidad + precio), montado dentro del
 * formulario del pedido (`react-hook-form` field array). Reemplaza la captura renglón-a-renglón
 * del viejo por una tabla con "Agregar renglón" / quitar. El precio solo se muestra/captura si
 * `puedeVerImportes` (ocultamiento de importes, doc 02 §3): sin permiso, la columna se omite y
 * el precio NO viaja (el backend lo conserva/0 según corresponda).
 *
 * No tiene lógica de negocio: solo captura; el backend valida y es la autoridad (A1).
 *
 * ⭐ **FILA 0.209 — el modelo se BUSCA en el servidor; antes se elegía de una lista de 100.**
 * Este selector era un `<select>` nativo alimentado por una consulta FIJA de `porPagina: 100` **sin
 * `busqueda`**, y 100 es el tope REAL del contrato (`comun/paginacion.ts` → `.max(100)`), así que no
 * había forma de pedir más: sólo se alcanzaban los primeros 100 códigos y el resto era
 * **inalcanzable, sin aviso** — se leía como «ese modelo no existe». El docblock de esa consulta
 * decía *«Tope alto»*, y **era razonable cuando se escribió**: lo caducó el dato del negocio, no un
 * cambio de código. ⇒ Pasa al patrón que la casa ya tiene (`SelectorModelo` sobre
 * `ComboboxBuscable`, igual que hizo la fila 0.192 con los colores): con **~5,400 modelos (Daniel,
 * 19-sep-2026)** se teclea y aparece. Es la CUARTA vez que el mismo tope muerde en este proyecto
 * (proveedores, colores, el conteo cíclico y ahora los modelos).
 *
 * ⭐ **Y por eso arranca con `recientesPrimero`:** aquí el orden por código no era neutral. Los
 * modelos de PRODUCCIÓN son 5 dígitos y los de DESARROLLO llevan letras (`CYA-26-71-001`), y en
 * orden de texto los dígitos van **antes** ⇒ los ~4,987 migrados de Access agotaban la página de 100
 * **antes de la primera letra**, así que **ningún modelo de desarrollo llegaba nunca** a este
 * selector. Eso rompía de raíz lo que `origen-buscadores.test.tsx` dice proteger —que haya manera
 * manual de llegar a «generar la OP»— mientras esa prueba seguía en verde, porque medía que el
 * modelo estuviera INVITADO (`origen: 'todos'`) y no que fuera ALCANZABLE.
 *
 * ⚠️ `origen: 'todos'` (V1-E3n) se mantiene EXPLÍCITO en la llamada, aunque hoy sea el default del
 * selector: sin esto un modelo de DESARROLLO no se podría poner en un pedido, y con ello quedaría
 * INALCANZABLE por captura manual el camino que la etapa construye — que generar la OP de ese
 * renglón es lo que lo hace entrar a producción. ⭐ V1-E3 (§Post-F9.172(b)) precisa CÓMO: el renglón
 * se queda con su modelo de desarrollo (no se transforma) y la OP hace **nacer** un modelo de
 * producción por COLOR, con su nº de 5 dígitos y compartiendo la receta del desarrollo. Lo fija
 * `origen-buscadores.test.tsx`.
 */
export function EditorRenglones({
  control,
  registrar,
  errores,
  puedeVerImportes,
  deshabilitado,
  codigosPorModelo,
}: {
  control: Control<DatosPedidoFormulario>;
  registrar: UseFormRegister<DatosPedidoFormulario>;
  errores: FieldErrors<DatosPedidoFormulario>;
  puedeVerImportes: boolean;
  deshabilitado: boolean;
  /**
   * Código de cada modelo YA GUARDADO en el pedido que se edita (id → código), que el padre conoce
   * por `pedido.lineas[].codigoModelo`.
   *
   * 🔑 **Para qué**: con búsqueda server-side la primera página son 8 códigos, y el modelo de un
   * renglón guardado casi nunca está entre ellos ⇒ al reabrir el pedido el campo se vería **VACÍO
   * aunque por dentro sí haya modelo elegido**, y guardar lo dejaría igual de vacío a la vista. Es
   * la trampa clásica de estos selectores. Sólo hace falta al MONTAR: en cuanto el usuario elige,
   * el combobox persiste la etiqueta por su cuenta.
   */
  codigosPorModelo?: ReadonlyMap<number, string> | undefined;
}): React.JSX.Element {
  const { fields, append, remove } = useFieldArray({ control, name: 'renglones' });

  return (
    <div className="space-y-3" data-testid="editor-renglones">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Renglones</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={deshabilitado}
          onClick={() => append({ idModelo: '', cantidadPedida: '', precio: '0' })}
          data-testid="agregar-renglon"
        >
          Agregar renglón
        </Button>
      </div>

      {fields.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          Sin renglones. Agrega los modelos del pedido.
        </p>
      ) : (
        <ul className="space-y-2">
          {fields.map((field, indice) => {
            const errorFila = errores.renglones?.[indice];
            return (
              <li
                key={field.id}
                className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[1fr_6rem_7rem_auto] sm:items-end"
                data-testid="fila-renglon"
              >
                {/* Contenedor `div`, no `label`: el combobox es un widget con popover propio, y
                    envolverlo en un `<label>` le daría dos veces el foco. Su nombre accesible lo
                    pone `etiqueta` (aria-label), igual que en las pantallas de inventario. */}
                <div className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Modelo</span>
                  <Controller
                    control={control}
                    name={`renglones.${indice}.idModelo` as const}
                    render={({ field }) => {
                      // El formulario guarda el id como TEXTO ('' = sin elegir); el selector habla
                      // de números. La conversión vive aquí y no toca el esquema ni el submit.
                      const idElegido = field.value === '' ? undefined : Number(field.value);
                      const codigoGuardado =
                        idElegido === undefined ? undefined : codigosPorModelo?.get(idElegido);
                      return (
                        <SelectorModelo
                          idSeleccionado={idElegido}
                          {...(codigoGuardado === undefined
                            ? {}
                            : { codigoSeleccionado: codigoGuardado })}
                          alSeleccionar={(m) => field.onChange(String(m.id))}
                          deshabilitado={deshabilitado}
                          invalido={Boolean(errorFila?.idModelo)}
                          recientesPrimero
                          origen="todos"
                          etiqueta="Modelo del renglón"
                          testid={`renglon-modelo-${indice}`}
                        />
                      );
                    }}
                  />
                  {errorFila?.idModelo ? (
                    <span role="alert" className="mt-1 block text-destructive">
                      {errorFila.idModelo.message}
                    </span>
                  ) : null}
                </div>

                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Cantidad</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step="1"
                    placeholder="Ej. 500"
                    disabled={deshabilitado}
                    aria-invalid={Boolean(errorFila?.cantidadPedida)}
                    aria-label="Cantidad del renglón"
                    {...registrar(`renglones.${indice}.cantidadPedida` as const)}
                  />
                  {errorFila?.cantidadPedida ? (
                    <span role="alert" className="mt-1 block text-destructive">
                      {errorFila.cantidadPedida.message}
                    </span>
                  ) : null}
                </label>

                {puedeVerImportes ? (
                  <label className="block text-xs">
                    <span className="mb-1 block text-muted-foreground">Precio</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      disabled={deshabilitado}
                      aria-invalid={Boolean(errorFila?.precio)}
                      aria-label="Precio del renglón"
                      {...registrar(`renglones.${indice}.precio` as const)}
                    />
                    {errorFila?.precio ? (
                      <span role="alert" className="mt-1 block text-destructive">
                        {errorFila.precio.message}
                      </span>
                    ) : null}
                  </label>
                ) : (
                  // Sin permiso de importes: el precio NO se captura, pero se conserva el valor
                  // que trae el formulario (campo oculto) para no perderlo al guardar.
                  <input type="hidden" {...registrar(`renglones.${indice}.precio` as const)} />
                )}

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={deshabilitado}
                  onClick={() => remove(indice)}
                  aria-label="Quitar renglón"
                  data-testid="quitar-renglon"
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
