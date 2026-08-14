import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  useActualizarArte,
  useCrearArte,
  type Arte,
  type ArteCrear,
  type ArteEditar,
} from '@/api/artes';
import { useProveedores } from '@/api/proveedores';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  LeyendaObligatorios,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { FotoArte } from '@/modulos/arte/FotoArte';
import {
  ETIQUETAS_TIPO_ARTE,
  TIPOS_ARTE,
  esquemaArteFormulario,
  numeroOpcionalACuerpo,
  type DatosArteFormulario,
} from '@/modulos/arte/esquemas';

/** Tope alto: trae los proveedores activos para el selector (ordenados por nombre). */
const QUERY_PROVEEDORES = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Valores por defecto de un alta (todo vacío; el tipo arranca en BORDADO, como el backend). */
const VALORES_INICIALES: DatosArteFormulario = {
  nombre: '',
  tipo: 'BORDADO',
  descripcion: '',
  puntadas: '',
  precio: '',
  idProveedor: '',
};

/** Traduce la captura al cuerpo del ALTA (POST): los opcionales vacíos se OMITEN. */
function aCuerpoCrear(datos: DatosArteFormulario): ArteCrear {
  const cuerpo: ArteCrear = { nombre: datos.nombre, tipo: datos.tipo };
  if (datos.descripcion.length > 0) {
    cuerpo.descripcion = datos.descripcion;
  }
  const puntadas = numeroOpcionalACuerpo(datos.puntadas);
  if (puntadas !== undefined) {
    cuerpo.puntadas = puntadas;
  }
  const precio = numeroOpcionalACuerpo(datos.precio);
  if (precio !== undefined) {
    cuerpo.precio = precio;
  }
  if (datos.idProveedor.trim() !== '') {
    cuerpo.idProveedor = Number(datos.idProveedor);
  }
  return cuerpo;
}

/**
 * Traduce la captura al cuerpo del PATCH (EDICIÓN): a diferencia del alta, los opcionales que
 * quedan VACÍOS viajan como `null` para BORRAR el dato (M1) — en un PATCH parcial un campo
 * omitido no se tocaría.
 */
function aCuerpoEditar(datos: DatosArteFormulario): ArteEditar {
  return {
    nombre: datos.nombre,
    tipo: datos.tipo,
    descripcion: datos.descripcion.length > 0 ? datos.descripcion : null,
    puntadas: numeroOpcionalACuerpo(datos.puntadas) ?? null,
    precio: numeroOpcionalACuerpo(datos.precio) ?? null,
    idProveedor: datos.idProveedor.trim() === '' ? null : Number(datos.idProveedor),
  };
}

/**
 * Alta/edición de UN ARTE del modelo (V1-E3d, §Post-F9.35). El arte dejó de ser catálogo: se
 * captura DENTRO del modelo, con su nombre, tipo, puntadas, **precio** (el que viaja a la OP),
 * **proveedor** (quién lo hace) y su FOTO.
 *
 * La FOTO solo aparece en EDICIÓN: necesita el arte ya creado para subirla (flujo presigned, igual
 * que la foto del modelo). Validación de UX con Zod; el backend re-valida y es la autoridad (A1).
 */
export function DialogoArte({
  abierto,
  alCambiarAbierto,
  idModelo,
  arte,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  idModelo: number;
  /** Arte a editar, o `undefined` para un alta. */
  arte?: Arte;
}): React.JSX.Element {
  const esEdicion = arte !== undefined;
  const crear = useCrearArte();
  const actualizar = useActualizarArte();
  const proveedores = useProveedores(QUERY_PROVEEDORES);

  const formulario = useForm<DatosArteFormulario>({
    resolver: zodResolver(esquemaArteFormulario),
    defaultValues: VALORES_INICIALES,
  });

  // Siembra el formulario cada vez que se abre (alta = limpio; edición = datos del arte).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    formulario.reset(
      arte === undefined
        ? VALORES_INICIALES
        : {
            nombre: arte.nombre,
            tipo: arte.tipo,
            descripcion: arte.descripcion ?? '',
            puntadas: arte.puntadas === null ? '' : String(arte.puntadas),
            precio: arte.precio === null ? '' : String(arte.precio),
            idProveedor: arte.idProveedor === null ? '' : String(arte.idProveedor),
          },
    );
  }, [abierto, arte, formulario]);

  function alEnviar(datos: DatosArteFormulario): void {
    if (arte === undefined) {
      crear.mutate(
        { idModelo, cuerpo: aCuerpoCrear(datos) },
        {
          onSuccess: () => {
            toast.success('Arte agregado.');
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    actualizar.mutate(
      { idModelo, idArte: arte.id, cuerpo: aCuerpoEditar(datos) },
      {
        onSuccess: () => {
          toast.success('Arte actualizado.');
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const guardando = crear.isPending || actualizar.isPending;
  const errores = formulario.formState.errors;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        data-testid="dialogo-arte"
      >
        <DialogHeader>
          <DialogTitle>{esEdicion ? 'Editar arte' : 'Agregar arte'}</DialogTitle>
          <DialogDescription>
            El arte es del modelo: aquí se capturan su precio (el que viaja a la orden), su
            proveedor y su foto.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void formulario.handleSubmit(alEnviar)(e)} noValidate>
          <FieldGroup>
            <LeyendaObligatorios />

            <Field>
              <FieldLabel htmlFor="arte-nombre">Nombre *</FieldLabel>
              <Input
                id="arte-nombre"
                {...formulario.register('nombre')}
                aria-invalid={errores.nombre !== undefined}
                data-testid="arte-nombre"
              />
              <FieldError>{errores.nombre?.message}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="arte-tipo">Tipo *</FieldLabel>
              <SelectNativo id="arte-tipo" {...formulario.register('tipo')} data-testid="arte-tipo">
                {TIPOS_ARTE.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {ETIQUETAS_TIPO_ARTE[tipo]}
                  </option>
                ))}
              </SelectNativo>
              <FieldError>{errores.tipo?.message}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="arte-precio">Precio</FieldLabel>
              <Input
                id="arte-precio"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                {...formulario.register('precio')}
                aria-invalid={errores.precio !== undefined}
                data-testid="arte-precio"
              />
              <FieldDescription>
                Es el precio que viaja hasta la orden de producción.
              </FieldDescription>
              <FieldError>{errores.precio?.message}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="arte-proveedor">Proveedor</FieldLabel>
              <SelectNativo
                id="arte-proveedor"
                {...formulario.register('idProveedor')}
                disabled={proveedores.isPending}
                data-testid="arte-proveedor"
              >
                <option value="">Sin proveedor</option>
                {(proveedores.data?.datos ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </SelectNativo>
              <FieldDescription>Quién hace el arte (bordador/estampador).</FieldDescription>
              <FieldError>{errores.idProveedor?.message}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="arte-puntadas">Puntadas</FieldLabel>
              <Input
                id="arte-puntadas"
                type="number"
                min={0}
                step="1"
                inputMode="numeric"
                {...formulario.register('puntadas')}
                aria-invalid={errores.puntadas !== undefined}
                data-testid="arte-puntadas"
              />
              <FieldError>{errores.puntadas?.message}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="arte-descripcion">Descripción</FieldLabel>
              <Input
                id="arte-descripcion"
                {...formulario.register('descripcion')}
                aria-invalid={errores.descripcion !== undefined}
                data-testid="arte-descripcion"
              />
              <FieldError>{errores.descripcion?.message}</FieldError>
            </Field>

            {/* La foto necesita el arte YA creado (flujo presigned): solo en edición. */}
            {arte === undefined ? (
              <FieldDescription>Guarda el arte para poder subirle su foto.</FieldDescription>
            ) : (
              <Field>
                <FieldLabel>Foto</FieldLabel>
                <FotoArte arte={arte} deshabilitado={guardando} />
              </Field>
            )}
          </FieldGroup>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => alCambiarAbierto(false)}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando} data-testid="guardar-arte">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
