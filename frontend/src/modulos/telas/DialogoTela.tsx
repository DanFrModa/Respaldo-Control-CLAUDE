import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon, PlusIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  useActualizarTela,
  useCrearTela,
  useCrearTelaCategoria,
  useTelasCategorias,
  type Tela,
  type TelaCategoria,
  type TelaCrear,
  type TelaEditar,
  type TipoComponenteTela,
} from '@/api/telas';
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

import { aColoresCuerpo, aRenglones, type RenglonColor } from './colores-tela';
import { EditorColoresTela } from './EditorColoresTela';

/** Tipos de componente (D5) y sus etiquetas legibles. */
const TIPOS_COMPONENTE: readonly TipoComponenteTela[] = ['CUERPO', 'CARDIGAN', 'OTRO'];
const ETIQUETA_TIPO_COMPONENTE: Record<TipoComponenteTela, string> = {
  CUERPO: 'Cuerpo',
  CARDIGAN: 'Cardigán',
  OTRO: 'Otro',
};

/** Unidades de medida sugeridas (lista de ayuda; el campo es texto libre). */
const UNIDADES_SUGERIDAS = ['KILOGRAMO', 'METRO', 'YARDA', 'PIEZA', 'ROLLO', 'CONO'] as const;

/** Valor "sin categoría" del `<select>` (texto vacío). */
const SIN_CATEGORIA = '';

/**
 * Captura del formulario de tela (alta y edición comparten forma). Solo el `nombre` es
 * obligatorio; los `colores` (grid con precio) y la categoría se gestionan como estado
 * aparte (no son texto del schema). Los numéricos opcionales se capturan como texto (vacío
 * = sin valor). Validación SOLO de UX: el backend re-valida y es la autoridad (A1).
 */
const esquemaTelaFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
  descripcion: z
    .string()
    .trim()
    .max(500, { error: 'La descripción no puede tener más de 500 caracteres' }),
  unidadMedida: z
    .string()
    .trim()
    .max(30, { error: 'La unidad de medida no puede tener más de 30 caracteres' }),
  tipoComponente: z.enum(TIPOS_COMPONENTE),
  precioSugerido: z
    .string()
    .refine((v) => v.trim() === '' || (Number.isFinite(Number(v)) && Number(v) >= 0), {
      error: 'El precio sugerido debe ser un número no negativo',
    }),
  favorito: z.boolean(),
  paraProduccion: z.boolean(),
});

/** Datos del formulario de tela. */
type DatosTelaFormulario = z.infer<typeof esquemaTelaFormulario>;

/** Valores por defecto de un alta. */
const VALORES_INICIALES: DatosTelaFormulario = {
  nombre: '',
  descripcion: '',
  unidadMedida: '',
  tipoComponente: 'OTRO',
  precioSugerido: '',
  favorito: false,
  paraProduccion: true,
};

/** Lee un campo de texto opcional de la tela para el formulario (`null` -> ''). */
function texto(valor: string | null): string {
  return valor ?? '';
}

/** Convierte el `precioSugerido` capturado (texto) a `number`, o `undefined` si vacío. */
function precioACuerpo(valor: string): number | undefined {
  const t = valor.trim();
  return t === '' ? undefined : Number(t);
}

/** Texto opcional para EDICION: vacío -> `null` (BORRA el dato); con valor -> el texto. */
function textoONull(valor: string): string | null {
  return valor.trim().length > 0 ? valor.trim() : null;
}

/**
 * Diálogo de alta y edición de tela UNIFICADA (F1-E3). Replica el patrón de Maquilero
 * (react-hook-form + Zod) sumando el editor del GRID DE COLORES con precio y un selector de
 * categoría con alta rápida. Si recibe una `tela` edita (PATCH); si no, da de alta (POST).
 *
 * - Los `colores` (N:N con precio) y la categoría van INLINE en el cuerpo de crear/editar
 *   (misma transacción A2). Su estado vive aquí; el grid PUEDE quedar vacío.
 * - En ALTA, los campos opcionales vacíos se OMITEN. En EDICION, los textos vacíos viajan
 *   como `null` para BORRARLOS y la categoría/precio vacíos como `null` para quitarlos (M1).
 *
 * La validación de captura es solo UX: el backend re-valida y es la autoridad (A1).
 */
export function DialogoTela({
  abierto,
  alCambiarAbierto,
  tela,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Tela a editar; `undefined` -> alta. */
  tela: Tela | undefined;
}): React.JSX.Element {
  const esEdicion = tela !== undefined;
  const crear = useCrearTela();
  const actualizar = useActualizarTela();
  const guardando = crear.isPending || actualizar.isPending;

  const categoriasConsulta = useTelasCategorias({ porPagina: 100 });
  const categorias = categoriasConsulta.data?.datos ?? [];

  // Grid de colores y categoría: estado local (no son texto del schema).
  const [colores, setColores] = useState<RenglonColor[]>([]);
  const [idCategoria, setIdCategoria] = useState<string>(SIN_CATEGORIA);
  // Diálogo de alta rápida de categoría.
  const [dialogoCategoria, setDialogoCategoria] = useState(false);

  const formulario = useForm<DatosTelaFormulario>({
    resolver: zodResolver(esquemaTelaFormulario),
    defaultValues: VALORES_INICIALES,
  });

  // Al abrir, sincroniza el formulario, los colores y la categoría con la tela en edición.
  useEffect(() => {
    if (!abierto) {
      return;
    }
    if (tela) {
      formulario.reset({
        nombre: tela.nombre,
        descripcion: texto(tela.descripcion),
        unidadMedida: texto(tela.unidadMedida),
        tipoComponente: tela.tipoComponente,
        precioSugerido: tela.precioSugerido === null ? '' : String(tela.precioSugerido),
        favorito: tela.favorito,
        paraProduccion: tela.paraProduccion,
      });
      setColores(aRenglones(tela.colores));
      setIdCategoria(tela.idCategoria === null ? SIN_CATEGORIA : String(tela.idCategoria));
    } else {
      formulario.reset(VALORES_INICIALES);
      setColores([]);
      setIdCategoria(SIN_CATEGORIA);
    }
  }, [abierto, tela, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    const coloresCuerpo = aColoresCuerpo(colores);
    const categoria = idCategoria === SIN_CATEGORIA ? null : Number(idCategoria);
    const precio = precioACuerpo(datos.precioSugerido);

    if (esEdicion) {
      // EDICION (PATCH): textos vacíos -> null (borrar); categoría/precio vacíos -> null.
      const cuerpo: TelaEditar = {
        nombre: datos.nombre,
        descripcion: textoONull(datos.descripcion),
        unidadMedida: textoONull(datos.unidadMedida),
        tipoComponente: datos.tipoComponente,
        favorito: datos.favorito,
        paraProduccion: datos.paraProduccion,
        idCategoria: categoria,
        precioSugerido: precio ?? null,
        colores: coloresCuerpo,
      };
      actualizar.mutate(
        { id: tela.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Tela "${resultado.nombre}" actualizada.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    // ALTA (POST): los opcionales vacíos se OMITEN (el backend los deja en null/default).
    const cuerpo: TelaCrear = {
      nombre: datos.nombre,
      tipoComponente: datos.tipoComponente,
      favorito: datos.favorito,
      paraProduccion: datos.paraProduccion,
      colores: coloresCuerpo,
      ...(datos.descripcion.trim() === '' ? {} : { descripcion: datos.descripcion.trim() }),
      ...(datos.unidadMedida.trim() === '' ? {} : { unidadMedida: datos.unidadMedida.trim() }),
      ...(categoria === null ? {} : { idCategoria: categoria }),
      ...(precio === undefined ? {} : { precioSugerido: precio }),
    };
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        toast.success(`Tela "${resultado.nombre}" creada.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;
  const registrar = formulario.register;

  return (
    <>
      <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={(e) => void enviar(e)} noValidate>
            <DialogHeader>
              <DialogTitle>{esEdicion ? 'Editar tela' : 'Nueva tela'}</DialogTitle>
              <DialogDescription>
                {esEdicion
                  ? 'Cambia los datos de esta tela y sus colores.'
                  : 'Captura los datos de la nueva tela del catálogo y sus colores.'}
              </DialogDescription>
            </DialogHeader>

            {/* Cuerpo desplazable: el formulario puede crecer. */}
            <div className="max-h-[60vh] overflow-y-auto py-4 pr-1">
              <FieldGroup>
                <Field data-invalid={Boolean(errors.nombre)}>
                  <FieldLabel htmlFor="tela-nombre">Nombre</FieldLabel>
                  <Input
                    id="tela-nombre"
                    autoFocus
                    aria-invalid={Boolean(errors.nombre)}
                    disabled={guardando}
                    {...registrar('nombre')}
                  />
                  <FieldError errors={[errors.nombre]} />
                </Field>

                <Field data-invalid={Boolean(errors.descripcion)}>
                  <FieldLabel htmlFor="tela-descripcion">Descripción</FieldLabel>
                  <textarea
                    id="tela-descripcion"
                    rows={2}
                    aria-invalid={Boolean(errors.descripcion)}
                    disabled={guardando}
                    className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"
                    {...registrar('descripcion')}
                  />
                  <FieldError errors={[errors.descripcion]} />
                </Field>

                {/* Categoría (selector + alta rápida) */}
                <Field>
                  <FieldLabel htmlFor="tela-categoria">Categoría</FieldLabel>
                  <div className="flex items-center gap-2">
                    <SelectNativo
                      id="tela-categoria"
                      value={idCategoria}
                      onChange={(e) => setIdCategoria(e.target.value)}
                      disabled={guardando || categoriasConsulta.isPending}
                      data-testid="tela-categoria"
                    >
                      <option value={SIN_CATEGORIA}>Sin categoría</option>
                      {categorias.map((cat: TelaCategoria) => (
                        <option key={cat.id} value={String(cat.id)}>
                          {cat.nombre}
                        </option>
                      ))}
                    </SelectNativo>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDialogoCategoria(true)}
                      disabled={guardando}
                      data-testid="nueva-categoria-tela"
                    >
                      <PlusIcon aria-hidden />
                      Nueva
                    </Button>
                  </div>
                  <FieldDescription>Agrupa las telas (Felpa, Jersey, Rib…).</FieldDescription>
                </Field>

                {/* Unidad de medida (texto libre con lista sugerida) */}
                <Field data-invalid={Boolean(errors.unidadMedida)}>
                  <FieldLabel htmlFor="tela-unidad">Unidad de medida</FieldLabel>
                  <Input
                    id="tela-unidad"
                    list="unidades-sugeridas"
                    placeholder="p. ej. KILOGRAMO"
                    aria-invalid={Boolean(errors.unidadMedida)}
                    disabled={guardando}
                    {...registrar('unidadMedida')}
                  />
                  <datalist id="unidades-sugeridas">
                    {UNIDADES_SUGERIDAS.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                  <FieldError errors={[errors.unidadMedida]} />
                </Field>

                {/* Tipo de componente (D5) */}
                <Field data-invalid={Boolean(errors.tipoComponente)}>
                  <FieldLabel htmlFor="tela-tipo-componente">Tipo de componente</FieldLabel>
                  <SelectNativo
                    id="tela-tipo-componente"
                    aria-invalid={Boolean(errors.tipoComponente)}
                    disabled={guardando}
                    {...registrar('tipoComponente')}
                  >
                    {TIPOS_COMPONENTE.map((t) => (
                      <option key={t} value={t}>
                        {ETIQUETA_TIPO_COMPONENTE[t]}
                      </option>
                    ))}
                  </SelectNativo>
                  <FieldError errors={[errors.tipoComponente]} />
                </Field>

                {/* Precio sugerido */}
                <Field data-invalid={Boolean(errors.precioSugerido)}>
                  <FieldLabel htmlFor="tela-precio">Precio sugerido</FieldLabel>
                  <Input
                    id="tela-precio"
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    aria-invalid={Boolean(errors.precioSugerido)}
                    disabled={guardando}
                    {...registrar('precioSugerido')}
                  />
                  <FieldDescription>Referencia por unidad (vacío = sin precio).</FieldDescription>
                  <FieldError errors={[errors.precioSugerido]} />
                </Field>

                {/* Banderas */}
                <Field orientation="horizontal">
                  <input
                    id="tela-favorito"
                    type="checkbox"
                    className="size-4 rounded border-input accent-primary"
                    disabled={guardando}
                    data-testid="tela-favorito"
                    {...registrar('favorito')}
                  />
                  <FieldLabel htmlFor="tela-favorito" className="font-normal">
                    Tela de uso frecuente (favorita)
                  </FieldLabel>
                </Field>

                <Field orientation="horizontal">
                  <input
                    id="tela-para-produccion"
                    type="checkbox"
                    className="size-4 rounded border-input accent-primary"
                    disabled={guardando}
                    data-testid="tela-para-produccion"
                    {...registrar('paraProduccion')}
                  />
                  <FieldLabel htmlFor="tela-para-produccion" className="font-normal">
                    Es tela de producción (no muestra/insumo)
                  </FieldLabel>
                </Field>

                {/* Grid de colores con precio (inline, puede ir vacío) */}
                <EditorColoresTela
                  colores={colores}
                  alCambiar={setColores}
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
              <Button type="submit" disabled={guardando} data-testid="guardar-tela">
                {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                {esEdicion ? 'Guardar cambios' : 'Crear tela'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Alta rápida de categoría: al crearla, queda seleccionada. */}
      <DialogoNuevaCategoria
        abierto={dialogoCategoria}
        alCambiarAbierto={setDialogoCategoria}
        alCreada={(creada) => setIdCategoria(String(creada))}
      />
    </>
  );
}

/** Captura del alta rápida de categoría (solo el nombre). */
const esquemaCategoriaFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
});
type DatosCategoriaFormulario = z.infer<typeof esquemaCategoriaFormulario>;

/**
 * Diálogo de ALTA RÁPIDA de categoría de tela (se abre desde el selector de categoría del
 * form de tela). Al crearla con éxito, avisa el id al padre para dejarla seleccionada y
 * cierra. El backend exige el nombre único (A1); si choca, el toast muestra su mensaje.
 */
function DialogoNuevaCategoria({
  abierto,
  alCambiarAbierto,
  alCreada,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  alCreada: (idCategoria: number) => void;
}): React.JSX.Element {
  const crear = useCrearTelaCategoria();

  const formulario = useForm<DatosCategoriaFormulario>({
    resolver: zodResolver(esquemaCategoriaFormulario),
    defaultValues: { nombre: '' },
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset({ nombre: '' });
    }
  }, [abierto, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    crear.mutate(
      { nombre: datos.nombre },
      {
        onSuccess: (creada) => {
          toast.success(`Categoría "${creada.nombre}" creada.`);
          alCreada(creada.id);
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  });

  const { errors } = formulario.formState;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>Nueva categoría de tela</DialogTitle>
            <DialogDescription>Agrupa las telas (p. ej. Felpa, Jersey, Rib).</DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="categoria-nombre">Nombre</FieldLabel>
              <Input
                id="categoria-nombre"
                autoFocus
                aria-invalid={Boolean(errors.nombre)}
                disabled={crear.isPending}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => alCambiarAbierto(false)}
              disabled={crear.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={crear.isPending} data-testid="guardar-categoria-tela">
              {crear.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Crear categoría
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
