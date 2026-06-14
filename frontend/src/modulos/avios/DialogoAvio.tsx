import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { numeroOpcionalACuerpo } from '@/api/esquemas';
import {
  useActualizarAvio,
  useCrearAvio,
  type Avio,
  type AvioCrear,
  type AvioEditar,
  type AvioProveedorEntrada,
} from '@/api/avios';
import { useProveedores } from '@/api/proveedores';
import type { Proveedor } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import {
  esquemaAvioFormulario,
  PRESENTACIONES_SUGERIDAS,
  type DatosAvioFormulario,
} from './esquemaAvio';
import { SelectorProveedoresAvio, type RenglonProveedorAvio } from './SelectorProveedoresAvio';

/** Tope alto: trae todos los proveedores activos para el selector (catálogo conocido). */
const QUERY_PROVEEDORES = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Valores por defecto de un alta (todo vacío; los proveedores se manejan aparte). */
const VALORES_INICIALES: DatosAvioFormulario = {
  clave: '',
  descripcion: '',
  unidad: '',
  presentacion: '',
  favorito: false,
  cantFav: '',
  esGenerico: false,
  precioReferencia: '',
};

/** Lee un campo de texto opcional del avío para el formulario (`null` -> ''). */
function texto(valor: string | null): string {
  return valor ?? '';
}

/** Lee un campo numérico opcional del avío como texto del `<input>` (`null` -> ''). */
function numeroTexto(valor: number | null): string {
  return valor === null ? '' : String(valor);
}

/**
 * Convierte los renglones de proveedores capturados (precio como texto) al arreglo del
 * cuerpo del API: precio -> number | omitido (vacío); condiciones -> texto | omitido
 * (vacío). El backend valida proveedores activos y sin repetidos (A1).
 */
function aProveedoresCuerpo(renglones: RenglonProveedorAvio[]): AvioProveedorEntrada[] {
  return renglones.map((renglon) => {
    const proveedor: AvioProveedorEntrada = { idProveedor: renglon.idProveedor };
    const precio = numeroOpcionalACuerpo(renglon.precio);
    if (precio !== undefined) {
      proveedor.precio = precio;
    }
    const condiciones = renglon.condiciones.trim();
    if (condiciones.length > 0) {
      proveedor.condiciones = condiciones;
    }
    return proveedor;
  });
}

/**
 * Traduce la captura al cuerpo del API para ALTA (POST): clave/descripción/unidad/
 * presentación siempre van (el form los exige); favorito/esGenerico como boolean; cantFav y
 * precioReferencia se omiten si están vacíos. Los proveedores van inline.
 */
function aCuerpoCrear(datos: DatosAvioFormulario, renglones: RenglonProveedorAvio[]): AvioCrear {
  const cuerpo: AvioCrear = {
    clave: datos.clave,
    descripcion: datos.descripcion,
    unidad: datos.unidad,
    presentacion: datos.presentacion,
    favorito: datos.favorito,
    esGenerico: datos.esGenerico,
    proveedores: aProveedoresCuerpo(renglones),
  };
  const cantFav = numeroOpcionalACuerpo(datos.cantFav);
  if (cantFav !== undefined) {
    cuerpo.cantFav = cantFav;
  }
  const precioReferencia = numeroOpcionalACuerpo(datos.precioReferencia);
  if (precioReferencia !== undefined) {
    cuerpo.precioReferencia = precioReferencia;
  }
  return cuerpo;
}

/**
 * Traduce la captura al cuerpo del PATCH (EDICIÓN). Igual que el alta pero cantFav y
 * precioReferencia vacíos viajan como `null` para BORRAR el dato (M1: en un PATCH parcial,
 * un campo omitido no se tocaría, así que omitirlo nunca permitiría vaciar un valor ya
 * capturado). Los proveedores SIEMPRE viajan (reemplazan el set; puede quedar en []).
 */
function aCuerpoEditar(datos: DatosAvioFormulario, renglones: RenglonProveedorAvio[]): AvioEditar {
  return {
    clave: datos.clave,
    descripcion: datos.descripcion,
    unidad: datos.unidad,
    presentacion: datos.presentacion,
    favorito: datos.favorito,
    esGenerico: datos.esGenerico,
    cantFav: numeroOpcionalACuerpo(datos.cantFav) ?? null,
    precioReferencia: numeroOpcionalACuerpo(datos.precioReferencia) ?? null,
    proveedores: aProveedoresCuerpo(renglones),
  };
}

/**
 * Diálogo de alta y edición de avío (F1-E3, R1). Replica el patrón de Maquileros
 * (react-hook-form + Zod) sumando el `SelectorProveedoresAvio` (proveedores con su
 * precio/condiciones, N:N CON datos). Si recibe un `avio` edita (PATCH); si no, da de alta
 * (POST).
 *
 * - Los `proveedores` van INLINE en el cuerpo (misma transacción A2). El estado vive aquí;
 *   en edición SIEMPRE se mandan (reemplazan el set; pueden quedar en [], que el backend
 *   acepta — un avío puede no tener proveedores).
 * - favorito ⇒ cantFav lo valida el form (UX) y el backend (autoridad, A1).
 * - unidad/presentación son obligatorias en el form (altas nuevas, ADR-0009).
 *
 * La validación de captura es solo UX: el backend re-valida y es la autoridad (A1). Al
 * guardar con éxito cierra y avisa con un toast.
 */
export function DialogoAvio({
  abierto,
  alCambiarAbierto,
  avio,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Avío a editar; `undefined` -> alta. */
  avio: Avio | undefined;
}): React.JSX.Element {
  const esEdicion = avio !== undefined;
  const crear = useCrearAvio();
  const actualizar = useActualizarAvio();
  const guardando = crear.isPending || actualizar.isPending;

  const proveedoresCatalogo = useProveedores(QUERY_PROVEEDORES);
  const proveedores: Proveedor[] = proveedoresCatalogo.data?.datos ?? [];

  // Proveedores elegidos: estado local (precio como texto). Se envían inline en el cuerpo.
  const [renglones, setRenglones] = useState<RenglonProveedorAvio[]>([]);

  const formulario = useForm<DatosAvioFormulario>({
    resolver: zodResolver(esquemaAvioFormulario),
    defaultValues: VALORES_INICIALES,
  });

  // Al abrir, sincroniza el formulario y los proveedores con el avío en edición (o limpia).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    if (avio) {
      formulario.reset({
        clave: avio.clave,
        descripcion: avio.descripcion,
        unidad: texto(avio.unidad),
        presentacion: texto(avio.presentacion),
        favorito: avio.favorito,
        cantFav: numeroTexto(avio.cantFav),
        esGenerico: avio.esGenerico,
        precioReferencia: numeroTexto(avio.precioReferencia),
      });
      setRenglones(
        avio.proveedores.map((proveedor) => ({
          idProveedor: proveedor.idProveedor,
          precio: numeroTexto(proveedor.precio),
          condiciones: texto(proveedor.condiciones),
        })),
      );
    } else {
      formulario.reset(VALORES_INICIALES);
      setRenglones([]);
    }
  }, [abierto, avio, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      const cuerpo = aCuerpoEditar(datos, renglones);
      actualizar.mutate(
        { id: avio.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Avío "${resultado.clave}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    const cuerpo = aCuerpoCrear(datos, renglones);
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        toast.success(`Avío "${resultado.clave}" creado.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;
  const registrar = formulario.register;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar avío' : 'Nuevo avío'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia los datos de este avío.'
                : 'Captura los datos del nuevo avío del catálogo.'}
            </DialogDescription>
          </DialogHeader>

          {/* Cuerpo desplazable: el formulario puede crecer. */}
          <div className="max-h-[60vh] overflow-y-auto py-4 pr-1">
            <FieldGroup>
              <Field data-invalid={Boolean(errors.clave)}>
                <FieldLabel htmlFor="avio-clave">Clave</FieldLabel>
                <Input
                  id="avio-clave"
                  autoFocus
                  aria-invalid={Boolean(errors.clave)}
                  disabled={guardando}
                  {...registrar('clave')}
                />
                <FieldError errors={[errors.clave]} />
              </Field>

              <Field data-invalid={Boolean(errors.descripcion)}>
                <FieldLabel htmlFor="avio-descripcion">Descripción</FieldLabel>
                <Input
                  id="avio-descripcion"
                  aria-invalid={Boolean(errors.descripcion)}
                  disabled={guardando}
                  {...registrar('descripcion')}
                />
                <FieldError errors={[errors.descripcion]} />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field data-invalid={Boolean(errors.unidad)}>
                  <FieldLabel htmlFor="avio-unidad">Unidad</FieldLabel>
                  <Input
                    id="avio-unidad"
                    placeholder="pza, m, kg…"
                    aria-invalid={Boolean(errors.unidad)}
                    disabled={guardando}
                    {...registrar('unidad')}
                  />
                  <FieldError errors={[errors.unidad]} />
                </Field>

                <Field data-invalid={Boolean(errors.presentacion)}>
                  <FieldLabel htmlFor="avio-presentacion">Presentación</FieldLabel>
                  {/* Combobox: lista sugerida + texto libre (datalist no restringe). */}
                  <Input
                    id="avio-presentacion"
                    list="avio-presentaciones"
                    placeholder="PIEZA, CAJA, ROLLO…"
                    aria-invalid={Boolean(errors.presentacion)}
                    disabled={guardando}
                    {...registrar('presentacion')}
                  />
                  <datalist id="avio-presentaciones">
                    {PRESENTACIONES_SUGERIDAS.map((opcion) => (
                      <option key={opcion} value={opcion} />
                    ))}
                  </datalist>
                  <FieldError errors={[errors.presentacion]} />
                </Field>
              </div>

              {/* Favorito + cantidad preestablecida (requerida si favorito). */}
              <Field orientation="horizontal">
                <input
                  id="avio-favorito"
                  type="checkbox"
                  className="size-4 rounded border-input accent-primary"
                  disabled={guardando}
                  data-testid="avio-favorito"
                  {...registrar('favorito')}
                />
                <FieldLabel htmlFor="avio-favorito" className="font-normal">
                  ¿Avío de uso frecuente (favorito)?
                </FieldLabel>
              </Field>

              <Field data-invalid={Boolean(errors.cantFav)}>
                <FieldLabel htmlFor="avio-cant-fav">Cantidad preestablecida</FieldLabel>
                <Input
                  id="avio-cant-fav"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  placeholder="Requerida si es favorito"
                  aria-invalid={Boolean(errors.cantFav)}
                  disabled={guardando}
                  {...registrar('cantFav')}
                />
                <FieldError errors={[errors.cantFav]} />
              </Field>

              {/* Genérico (R4). */}
              <Field orientation="horizontal">
                <input
                  id="avio-generico"
                  type="checkbox"
                  className="size-4 rounded border-input accent-primary"
                  disabled={guardando}
                  data-testid="avio-generico"
                  {...registrar('esGenerico')}
                />
                <FieldLabel htmlFor="avio-generico" className="font-normal">
                  ¿Avío genérico de stock? (no se compra por orden)
                </FieldLabel>
              </Field>

              <Field data-invalid={Boolean(errors.precioReferencia)}>
                <FieldLabel htmlFor="avio-precio-ref">Precio de referencia</FieldLabel>
                <Input
                  id="avio-precio-ref"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  placeholder="Opcional (fallback de precio)"
                  aria-invalid={Boolean(errors.precioReferencia)}
                  disabled={guardando}
                  {...registrar('precioReferencia')}
                />
                <FieldError errors={[errors.precioReferencia]} />
              </Field>

              {/* Proveedores y precios (inline, ≥0). */}
              <SelectorProveedoresAvio
                proveedores={proveedores}
                cargando={proveedoresCatalogo.isPending}
                error={proveedoresCatalogo.isError ? proveedoresCatalogo.error.message : null}
                renglones={renglones}
                alCambiar={setRenglones}
                deshabilitado={guardando}
              />
            </FieldGroup>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => alCambiarAbierto(false)}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando} data-testid="guardar-avio">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear avío'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
