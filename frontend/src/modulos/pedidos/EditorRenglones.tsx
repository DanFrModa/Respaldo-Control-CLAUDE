import { Trash2Icon } from 'lucide-react';
import {
  useFieldArray,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from 'react-hook-form';

import { useModelos, type Modelo } from '@/api/modelos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import type { DatosPedidoFormulario } from './esquemas';

/** Tope alto: trae los modelos activos para el selector de renglón. */
const QUERY_MODELOS = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'codigo',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/**
 * Editor del GRID de renglones de un pedido (modelo + cantidad + precio), montado dentro del
 * formulario del pedido (`react-hook-form` field array). Reemplaza la captura renglón-a-renglón
 * del viejo por una tabla con "Agregar renglón" / quitar. El precio solo se muestra/captura si
 * `puedeVerImportes` (ocultamiento de importes, doc 02 §3): sin permiso, la columna se omite y
 * el precio NO viaja (el backend lo conserva/0 según corresponda).
 *
 * No tiene lógica de negocio: solo captura; el backend valida y es la autoridad (A1).
 */
export function EditorRenglones({
  control,
  registrar,
  errores,
  puedeVerImportes,
  deshabilitado,
}: {
  control: Control<DatosPedidoFormulario>;
  registrar: UseFormRegister<DatosPedidoFormulario>;
  errores: FieldErrors<DatosPedidoFormulario>;
  puedeVerImportes: boolean;
  deshabilitado: boolean;
}): React.JSX.Element {
  const { fields, append, remove } = useFieldArray({ control, name: 'renglones' });
  const modelos = useModelos(QUERY_MODELOS);
  const listaModelos: Modelo[] = modelos.data?.datos ?? [];

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
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Modelo</span>
                  <SelectNativo
                    disabled={deshabilitado}
                    aria-invalid={Boolean(errorFila?.idModelo)}
                    aria-label="Modelo del renglón"
                    {...registrar(`renglones.${indice}.idModelo` as const)}
                  >
                    <option value="">Elige un modelo…</option>
                    {listaModelos.map((m) => (
                      <option key={m.id} value={String(m.id)}>
                        {m.codigo}
                        {m.descripcion ? ` — ${m.descripcion}` : ''}
                      </option>
                    ))}
                  </SelectNativo>
                  {errorFila?.idModelo ? (
                    <span role="alert" className="mt-1 block text-destructive">
                      {errorFila.idModelo.message}
                    </span>
                  ) : null}
                </label>

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
