import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  useActualizarModelo,
  useCrearModelo,
  useGeneros,
  type Modelo,
  type ModeloCrear,
  type ModeloEditar,
} from '@/api/modelos';
import { useCurvas } from '@/api/tallas';
import { useTemporadas } from '@/api/temporadas';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import {
  esquemaModeloFormulario,
  idSelectorACuerpo,
  numeroOpcionalACuerpo,
  type DatosModeloFormulario,
} from './esquemas';

/** Tope alto: trae los catálogos activos para los selectores (catálogos conocidos). */
const QUERY_SELECTOR = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Valores por defecto de un alta (todo vacío). */
const VALORES_INICIALES: DatosModeloFormulario = {
  codigo: '',
  descripcion: '',
  maquilaBase: '',
  idTemporada: '',
  idCurvaTalla: '',
  idGenero: '',
};

/** Lee un id de FK del modelo como texto para el `<select>` (`null` -> ''). */
function idTexto(valor: number | null): string {
  return valor === null ? '' : String(valor);
}

/**
 * Traduce la captura al cuerpo del API en ALTA (POST): los opcionales vacíos se OMITEN (el
 * backend los deja en null). `codigo` siempre va; los numéricos/selectores se convierten.
 */
function aCuerpoCrear(datos: DatosModeloFormulario): ModeloCrear {
  const cuerpo: ModeloCrear = { codigo: datos.codigo };
  if (datos.descripcion.length > 0) {
    cuerpo.descripcion = datos.descripcion;
  }
  const maquila = numeroOpcionalACuerpo(datos.maquilaBase);
  if (maquila !== undefined) {
    cuerpo.maquilaBase = maquila;
  }
  const idTemporada = idSelectorACuerpo(datos.idTemporada);
  if (idTemporada !== null) {
    cuerpo.idTemporada = idTemporada;
  }
  const idCurvaTalla = idSelectorACuerpo(datos.idCurvaTalla);
  if (idCurvaTalla !== null) {
    cuerpo.idCurvaTalla = idCurvaTalla;
  }
  const idGenero = idSelectorACuerpo(datos.idGenero);
  if (idGenero !== null) {
    cuerpo.idGenero = idGenero;
  }
  return cuerpo;
}

/**
 * Traduce la captura al cuerpo del PATCH (EDICIÓN): a diferencia del alta, los opcionales que
 * quedan VACÍOS viajan como `null` para BORRAR el dato (M1) — en un PATCH parcial un campo
 * omitido no se tocaría. `codigo` siempre va.
 */
function aCuerpoEditar(datos: DatosModeloFormulario): ModeloEditar {
  return {
    codigo: datos.codigo,
    descripcion: datos.descripcion.length > 0 ? datos.descripcion : null,
    maquilaBase: numeroOpcionalACuerpo(datos.maquilaBase) ?? null,
    idTemporada: idSelectorACuerpo(datos.idTemporada),
    idCurvaTalla: idSelectorACuerpo(datos.idCurvaTalla),
    idGenero: idSelectorACuerpo(datos.idGenero),
  };
}

/**
 * Diálogo de alta y edición de los DATOS GENERALES de un modelo (react-hook-form + Zod),
 * réplica del patrón de Bordados/Avíos. Si recibe un `modelo` edita (PATCH); si no, da de alta
 * (POST). El BOM y las fotos se gestionan en el detalle (necesitan el id del modelo). La
 * validación de captura es solo UX: el backend re-valida y es la autoridad (A1).
 */
export function DialogoModelo({
  abierto,
  alCambiarAbierto,
  modelo,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Modelo a editar; `undefined` -> alta. */
  modelo: Modelo | undefined;
}): React.JSX.Element {
  const esEdicion = modelo !== undefined;
  const crear = useCrearModelo();
  const actualizar = useActualizarModelo();
  const guardando = crear.isPending || actualizar.isPending;

  const temporadas = useTemporadas(QUERY_SELECTOR);
  const curvas = useCurvas(QUERY_SELECTOR);
  const generos = useGeneros();

  const formulario = useForm<DatosModeloFormulario>({
    resolver: zodResolver(esquemaModeloFormulario),
    defaultValues: VALORES_INICIALES,
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset(
        modelo
          ? {
              codigo: modelo.codigo,
              descripcion: modelo.descripcion ?? '',
              maquilaBase: modelo.maquilaBase === null ? '' : String(modelo.maquilaBase),
              idTemporada: idTexto(modelo.idTemporada),
              idCurvaTalla: idTexto(modelo.idCurvaTalla),
              idGenero: idTexto(modelo.idGenero),
            }
          : VALORES_INICIALES,
      );
    }
  }, [abierto, modelo, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      actualizar.mutate(
        { id: modelo.id, cuerpo: aCuerpoEditar(datos) },
        {
          onSuccess: (resultado) => {
            toast.success(`Modelo "${resultado.codigo}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(aCuerpoCrear(datos), {
      onSuccess: (resultado) => {
        toast.success(`Modelo "${resultado.codigo}" creado.`);
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
            <DialogTitle>{esEdicion ? 'Editar modelo' : 'Nuevo modelo'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia los datos generales de este modelo. La receta y las fotos se editan en el detalle.'
                : 'Captura los datos generales del modelo. Después podrás agregarle su receta y sus fotos.'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto py-4 pr-1">
            <FieldGroup>
              <Field data-invalid={Boolean(errors.codigo)}>
                <FieldLabel htmlFor="modelo-codigo">Código</FieldLabel>
                <Input
                  id="modelo-codigo"
                  autoFocus
                  aria-invalid={Boolean(errors.codigo)}
                  disabled={guardando}
                  {...registrar('codigo')}
                />
                <FieldError errors={[errors.codigo]} />
              </Field>

              <Field data-invalid={Boolean(errors.descripcion)}>
                <FieldLabel htmlFor="modelo-descripcion">Descripción</FieldLabel>
                <Input
                  id="modelo-descripcion"
                  placeholder="Opcional"
                  aria-invalid={Boolean(errors.descripcion)}
                  disabled={guardando}
                  {...registrar('descripcion')}
                />
                <FieldError errors={[errors.descripcion]} />
              </Field>

              <Field data-invalid={Boolean(errors.maquilaBase)}>
                <FieldLabel htmlFor="modelo-maquila">Maquila base</FieldLabel>
                <Input
                  id="modelo-maquila"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="Opcional"
                  aria-invalid={Boolean(errors.maquilaBase)}
                  disabled={guardando}
                  {...registrar('maquilaBase')}
                />
                <FieldDescription>Costo de maquila base que heredan las órdenes.</FieldDescription>
                <FieldError errors={[errors.maquilaBase]} />
              </Field>

              <Field>
                <FieldLabel htmlFor="modelo-temporada">Temporada</FieldLabel>
                <SelectNativo
                  id="modelo-temporada"
                  disabled={guardando}
                  {...registrar('idTemporada')}
                >
                  <option value="">Sin temporada</option>
                  {(temporadas.data?.datos ?? []).map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.nombre}
                    </option>
                  ))}
                </SelectNativo>
              </Field>

              <Field>
                <FieldLabel htmlFor="modelo-curva">Curva de tallas</FieldLabel>
                <SelectNativo id="modelo-curva" disabled={guardando} {...registrar('idCurvaTalla')}>
                  <option value="">Sin curva</option>
                  {(curvas.data?.datos ?? []).map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.nombre}
                    </option>
                  ))}
                </SelectNativo>
              </Field>

              <Field>
                <FieldLabel htmlFor="modelo-genero">Género</FieldLabel>
                <SelectNativo id="modelo-genero" disabled={guardando} {...registrar('idGenero')}>
                  <option value="">Sin género</option>
                  {(generos.data ?? []).map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.nombre}
                    </option>
                  ))}
                </SelectNativo>
              </Field>
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
            <Button type="submit" disabled={guardando} data-testid="guardar-modelo">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear modelo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
