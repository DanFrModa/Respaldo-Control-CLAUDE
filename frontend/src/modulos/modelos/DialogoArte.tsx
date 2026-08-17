import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  useActualizarArte,
  useArtesModelo,
  useCrearArte,
  type Arte,
  type ArteCrear,
  type ArteEditar,
} from '@/api/artes';
import { useTiposArte } from '@/api/tipos-proceso';
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
import { SelectorProveedor } from '@/modulos/cxp/SelectorProveedor';
import { FotosArte } from '@/modulos/arte/FotosArte';
import {
  esquemaArteFormulario,
  numeroOpcionalACuerpo,
  type DatosArteFormulario,
} from '@/modulos/arte/esquemas';

/** Valores por defecto de un alta (todo vacío; el tipo se elige del catálogo). */
const VALORES_INICIALES: DatosArteFormulario = {
  descripcion: '',
  posicion: '',
  idTipoArte: '',
  puntadas: '',
  precio: '',
  idProveedor: '',
};

/** Traduce la captura al cuerpo del ALTA (POST): los opcionales vacíos se OMITEN. */
function aCuerpoCrear(datos: DatosArteFormulario): ArteCrear {
  const cuerpo: ArteCrear = {
    descripcion: datos.descripcion,
    idTipoArte: Number(datos.idTipoArte),
  };
  if (datos.posicion.length > 0) {
    cuerpo.posicion = datos.posicion;
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
    descripcion: datos.descripcion,
    idTipoArte: Number(datos.idTipoArte),
    posicion: datos.posicion.length > 0 ? datos.posicion : null,
    puntadas: numeroOpcionalACuerpo(datos.puntadas) ?? null,
    precio: numeroOpcionalACuerpo(datos.precio) ?? null,
    idProveedor: datos.idProveedor.trim() === '' ? null : Number(datos.idProveedor),
  };
}

/**
 * Alta/edición de UN ARTE del modelo (V1-E3d §Post-F9.35 + **V1-E3f §Post-F9.52**).
 *
 * El arte dejó de ser catálogo: se captura DENTRO del modelo. Y desde V1-E3f se captura **como
 * Daniel lo usa**:
 *  • **Sin NOMBRE** — *"Es completamente irrelevante el nombre del estampado. Creo que con la
 *    descripción sería suficiente."* La descripción es el campo visible y obligatorio. Como ya no
 *    hay unicidad, si otra descripción del mismo modelo se repite se AVISA (no se bloquea).
 *  • **Con POSICIÓN** (frente / espalda / manga…), texto LIBRE — *"a veces son cosas muy
 *    específicas, que no tendría caso tenerlas en un catálogo"*.
 *  • **Tipo del CATÁLOGO único** (`TipoProceso` con `esArte`, §Post-F9.58), no de una lista fija.
 *  • **Puntadas atadas al tipo**: solo se piden si el tipo elegido las usa (`usaPuntadas`).
 *  • **Proveedor con BUSCADOR** acotado al ROL del tipo (bordado/estampado/aplicación…): era la
 *    cuarta vez que el desplegable con tope de 100 escondía al proveedor que se buscaba.
 *  • **FOTOS en plural**, solo en EDICIÓN (necesitan el arte ya creado, flujo presigned).
 *
 * Validación de UX con Zod; el backend re-valida y es la autoridad (A1).
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
  const tipos = useTiposArte();
  // El arte que YA tiene el modelo: solo para AVISAR de una descripción repetida (ver abajo).
  const artesDelModelo = useArtesModelo(abierto ? idModelo : undefined);

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
            descripcion: arte.descripcion,
            posicion: arte.posicion ?? '',
            idTipoArte: String(arte.idTipoArte),
            puntadas: arte.puntadas === null ? '' : String(arte.puntadas),
            precio: arte.precio === null ? '' : String(arte.precio),
            idProveedor: arte.idProveedor === null ? '' : String(arte.idProveedor),
          },
    );
  }, [abierto, arte, formulario]);

  const idTipoElegido = formulario.watch('idTipoArte');
  const descripcionCapturada = formulario.watch('descripcion');
  const idProveedorElegido = formulario.watch('idProveedor');
  const tipoElegido = (tipos.data?.datos ?? []).find((t) => String(t.id) === idTipoElegido);

  /**
   * Aviso —NO bloqueo— cuando la descripción ya existe en este modelo. Al retirarse el `nombre`
   * único (§Post-F9.52 punto 1) la base ya no lo impide, y Daniel lo aceptó; pero repetir texto
   * suele ser un descuido, así que la pantalla lo dice y deja seguir.
   */
  const descripcionRepetida =
    descripcionCapturada.trim() !== '' &&
    (artesDelModelo.data?.datos ?? []).some(
      (a) =>
        a.id !== arte?.id &&
        a.descripcion.trim().toLocaleLowerCase() ===
          descripcionCapturada.trim().toLocaleLowerCase(),
    );

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
            El arte es del modelo: aquí se capturan su descripción, dónde va en la prenda, su precio
            (el que viaja a la orden), su proveedor y sus fotos.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void formulario.handleSubmit(alEnviar)(e)} noValidate>
          <FieldGroup>
            <LeyendaObligatorios />

            <Field>
              <FieldLabel htmlFor="arte-descripcion">Descripción *</FieldLabel>
              <Input
                id="arte-descripcion"
                {...formulario.register('descripcion')}
                aria-invalid={errores.descripcion !== undefined}
                data-testid="arte-descripcion"
              />
              <FieldDescription>
                Qué es el arte (p. ej. «Águila bordada a 3 hilos»).
              </FieldDescription>
              {descripcionRepetida ? (
                <FieldDescription data-testid="arte-descripcion-repetida">
                  ⚠️ Este modelo ya tiene otro arte con esta descripción. Se puede guardar igual,
                  pero conviene distinguirlos.
                </FieldDescription>
              ) : null}
              <FieldError>{errores.descripcion?.message}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="arte-posicion">Posición</FieldLabel>
              <Input
                id="arte-posicion"
                placeholder="frente, espalda, manga izquierda…"
                {...formulario.register('posicion')}
                aria-invalid={errores.posicion !== undefined}
                data-testid="arte-posicion"
              />
              <FieldDescription>Dónde va en la prenda. Texto libre.</FieldDescription>
              <FieldError>{errores.posicion?.message}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="arte-tipo">Tipo *</FieldLabel>
              <SelectNativo
                id="arte-tipo"
                {...formulario.register('idTipoArte')}
                disabled={tipos.isPending}
                data-testid="arte-tipo"
              >
                <option value="">Elige el tipo…</option>
                {(tipos.data?.datos ?? []).map((tipo) => (
                  <option key={tipo.id} value={String(tipo.id)}>
                    {tipo.nombre}
                  </option>
                ))}
              </SelectNativo>
              <FieldDescription>
                Sale del catálogo de tipos de proceso: un proceso nuevo se da de alta una sola vez.
              </FieldDescription>
              <FieldError>
                {errores.idTipoArte?.message ?? (tipos.isError ? tipos.error.message : undefined)}
              </FieldError>
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
              <SelectorProveedor
                idInput="arte-proveedor"
                idSeleccionado={
                  idProveedorElegido.trim() === '' ? undefined : Number(idProveedorElegido)
                }
                nombreSeleccionado={
                  arte?.idProveedor !== null &&
                  arte?.idProveedor !== undefined &&
                  String(arte.idProveedor) === idProveedorElegido
                    ? (arte.proveedor ?? undefined)
                    : undefined
                }
                alSeleccionar={(proveedor) =>
                  formulario.setValue('idProveedor', String(proveedor.id), { shouldDirty: true })
                }
                alLimpiar={() => formulario.setValue('idProveedor', '', { shouldDirty: true })}
                rol={tipoElegido?.codigoRolProveedor ?? undefined}
                testid="arte-proveedor"
              />
              <FieldDescription>
                Quién hace el arte. Se busca por cualquier palabra del nombre
                {tipoElegido?.codigoRolProveedor === null || tipoElegido === undefined
                  ? '.'
                  : `, entre los proveedores marcados como «${tipoElegido.nombre}».`}
              </FieldDescription>
              <FieldError>{errores.idProveedor?.message}</FieldError>
            </Field>

            {/* Las PUNTADAS solo aplican a los tipos que las usan (§Post-F9.52 punto 6): el campo
                no se borró —tirarlo destruiría el dato de los bordados existentes, D3— sino que
                se OCULTA cuando el tipo elegido no las lleva. */}
            {tipoElegido?.usaPuntadas === true ? (
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
            ) : null}

            {/* Las fotos necesitan el arte YA creado (flujo presigned): solo en edición. */}
            {arte === undefined ? (
              <FieldDescription>Guarda el arte para poder subirle sus fotos.</FieldDescription>
            ) : (
              <Field>
                <FieldLabel>Fotos</FieldLabel>
                <FotosArte arte={arte} deshabilitado={guardando} />
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
