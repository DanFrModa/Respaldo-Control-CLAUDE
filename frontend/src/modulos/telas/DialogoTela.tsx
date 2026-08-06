import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon, PlusIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  useActualizarTela,
  useComposicionesTela,
  useCrearComposicionTela,
  useCrearTela,
  useCrearTelaCategoria,
  useTelasCategorias,
  type ComposicionTela,
  type Tela,
  type TelaCategoria,
  type TelaCrear,
  type TelaEditar,
  type TipoComponenteTela,
  type UnidadTela,
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
import { AvisoAlta } from '@/components/ui/aviso-alta';
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

import { aColoresCuerpo, aRenglones, type RenglonColor } from './colores-tela';
import { EditorColoresTela } from './EditorColoresTela';

/** Tipos de componente (D5) y sus etiquetas legibles. */
const TIPOS_COMPONENTE: readonly TipoComponenteTela[] = ['CUERPO', 'CARDIGAN', 'OTRO'];
const ETIQUETA_TIPO_COMPONENTE: Record<TipoComponenteTela, string> = {
  CUERPO: 'Cuerpo',
  CARDIGAN: 'Cardigán',
  OTRO: 'Otro',
};

/**
 * Unidades: SOLO kilos y metros (Daniel, 30-jul-2026: *"todo lo que se compra en kilos se consume
 * en kilos y lo que se compra en metros se consume en metros… no hay otras medidas"*). Era un texto
 * libre con lista sugerida (KILOGRAMO/YARDA/ROLLO/CONO…) y venía vacío en todas las telas; de esa
 * unidad dependen el stock, el consumo y el costo por prenda, así que ahora es una ELECCIÓN
 * obligatoria de dos, sin default: una tela de metros marcada en kilos ensucia todo en silencio.
 */
const UNIDADES: readonly UnidadTela[] = ['KG', 'M'];
const ETIQUETA_UNIDAD: Record<UnidadTela, string> = {
  KG: 'Kilos (kg)',
  M: 'Metros (m)',
};

/** Valor "sin elegir" de los `<select>` de tipo de tela y composición (texto vacío). */
const SIN_CATEGORIA = '';
const SIN_COMPOSICION = '';

/**
 * Captura del formulario de tela (alta y edición comparten forma). Solo el `nombre` es
 * obligatorio en el schema; los `colores` (grid con precios y pantone), el tipo de tela
 * (categoría), la composición y el PROVEEDOR se gestionan como estado aparte (no son texto
 * del schema). Los numéricos opcionales se capturan como texto (vacío = sin valor).
 * Validación SOLO de UX: el backend re-valida y es la autoridad (A1).
 */
const esquemaTelaFormulario = z
  .object({
    nombre: z
      .string({ error: 'El nombre es obligatorio' })
      .trim()
      .min(1, { error: 'El nombre es obligatorio' })
      .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
    descripcion: z
      .string()
      .trim()
      .max(500, { error: 'La descripción no puede tener más de 500 caracteres' }),
    /** Cómo le llama el proveedor a esta tela ("Felpa Suiza"), buscable. Opcional. */
    nombreProveedor: z
      .string()
      .trim()
      .max(150, { error: 'El nombre del proveedor no puede tener más de 150 caracteres' }),
    // El '' es el estado "todavía no elegida" del select; el `refine` lo rechaza. Sin default y sin
    // opción preseleccionada, el alta OBLIGA a elegir: si arrancara en kilos, una popelina (metros)
    // nacería mal marcada nada más por no tocar el combo — justo el fallo silencioso que esta regla
    // existe para evitar (hallazgo del reviewer).
    unidadMedida: z
      .union([z.literal('KG'), z.literal('M'), z.literal('')])
      .refine((v) => v !== '', { error: 'Elige la unidad: kilos o metros' }),
    tipoComponente: z.enum(TIPOS_COMPONENTE),
    precioSugerido: z
      .string()
      .refine((v) => v.trim() === '' || (Number.isFinite(Number(v)) && Number(v) >= 0), {
        error: 'El precio sugerido debe ser un número no negativo',
      }),
    favorito: z.boolean(),
    paraProduccion: z.boolean(),
    /** ¿La tela lleva COMPLEMENTO (cardigan)? Se declara desde el alta (§Post-F9.11). */
    llevaComplemento: z.boolean(),
    /** Nombre del componente cuerpo ("Felpa"). Opcional. */
    nombreCuerpo: z
      .string()
      .trim()
      .max(100, { error: 'El nombre del cuerpo no puede tener más de 100 caracteres' }),
    /** Nombre del complemento ("Cardigan"): obligatorio SI la tela lo lleva. */
    nombreComplemento: z
      .string()
      .trim()
      .max(100, { error: 'El nombre del complemento no puede tener más de 100 caracteres' }),
  })
  .superRefine((datos, contexto) => {
    if (datos.llevaComplemento && datos.nombreComplemento.trim() === '') {
      contexto.addIssue({
        code: 'custom',
        path: ['nombreComplemento'],
        message: 'Ponle nombre al complemento (p. ej. Cardigán)',
      });
    }
  });

/**
 * Datos del formulario de tela. Se distinguen los DOS lados del esquema porque la unidad admite
 * `''` mientras no se ha elegido (lo que el usuario teclea) pero nunca llega así al submit (lo que
 * el esquema garantiza): sin esa distinción, el valor inicial vacío no compilaría.
 */
type DatosTelaFormulario = z.input<typeof esquemaTelaFormulario>;

/** Los mismos datos ya validados (la unidad ya es KG o M). */
type DatosTelaValidados = z.output<typeof esquemaTelaFormulario>;

/** Valores por defecto de un alta. */
const VALORES_INICIALES: DatosTelaFormulario = {
  nombre: '',
  descripcion: '',
  nombreProveedor: '',
  unidadMedida: '',
  tipoComponente: 'OTRO',
  precioSugerido: '',
  favorito: false,
  paraProduccion: true,
  llevaComplemento: false,
  nombreCuerpo: '',
  nombreComplemento: '',
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
 * Diálogo de alta y edición de tela UNIFICADA (F1-E3; reestructura A1 §Post-F9.11).
 * Replica el patrón de Maquilero (react-hook-form + Zod) sumando la IDENTIDAD EN 4 DATOS
 * (tipo de tela = la categoría, composición del catálogo nuevo con alta rápida, PROVEEDOR
 * dueño con combobox buscable y el nombre que él le da), el COMPLEMENTO como parte de la
 * misma tela (¿lleva? + nombres de cuerpo/complemento) y el grid de colores con pantone y
 * dos precios. Si recibe una `tela` edita (PATCH); si no, da de alta (POST).
 *
 * - El PROVEEDOR es OBLIGATORIO solo en el ALTA (el contrato del backend lo exige). En
 *   EDICIÓN de una tela migrada sin proveedor NO se exige, pero se puede poner (la
 *   depuración); una vez con dueño, el proveedor se corrige a otro, no se quita.
 * - Los `colores` y los ids de catálogo van INLINE en el cuerpo de crear/editar (misma
 *   transacción A2). Su estado vive aquí; el grid PUEDE quedar vacío.
 * - En ALTA, los campos opcionales vacíos se OMITEN. En EDICION, los textos vacíos viajan
 *   como `null` para BORRARLOS y los ids de catálogo vacíos como `null` para quitarlos
 *   (M1). Desmarcar "lleva complemento" VACÍA el nombre del complemento (la bandera es
 *   justamente que sea null).
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
  const composicionesConsulta = useComposicionesTela({ porPagina: 100 });
  const composiciones = composicionesConsulta.data?.datos ?? [];

  // Grid de colores, tipo de tela, composición y proveedor: estado local (no texto del schema).
  const [colores, setColores] = useState<RenglonColor[]>([]);
  const [idCategoria, setIdCategoria] = useState<string>(SIN_CATEGORIA);
  const [idComposicion, setIdComposicion] = useState<string>(SIN_COMPOSICION);
  const [idProveedor, setIdProveedor] = useState<number | null>(null);
  const [nombreProveedorDueno, setNombreProveedorDueno] = useState<string | undefined>(undefined);
  const [errorProveedor, setErrorProveedor] = useState<string | null>(null);
  // Diálogos de alta rápida (categoría y composición).
  const [dialogoCategoria, setDialogoCategoria] = useState(false);
  const [dialogoComposicion, setDialogoComposicion] = useState(false);

  const formulario = useForm<DatosTelaFormulario, unknown, DatosTelaValidados>({
    resolver: zodResolver(esquemaTelaFormulario),
    defaultValues: VALORES_INICIALES,
  });

  // Al abrir, sincroniza el formulario, los colores y los catálogos con la tela en edición.
  useEffect(() => {
    if (!abierto) {
      return;
    }
    if (tela) {
      formulario.reset({
        nombre: tela.nombre,
        descripcion: texto(tela.descripcion),
        nombreProveedor: texto(tela.nombreProveedor),
        unidadMedida: tela.unidadMedida,
        tipoComponente: tela.tipoComponente,
        precioSugerido: tela.precioSugerido === null ? '' : String(tela.precioSugerido),
        favorito: tela.favorito,
        paraProduccion: tela.paraProduccion,
        llevaComplemento: tela.nombreComplemento !== null,
        nombreCuerpo: texto(tela.nombreCuerpo),
        nombreComplemento: texto(tela.nombreComplemento),
      });
      setColores(aRenglones(tela.colores));
      setIdCategoria(tela.idCategoria === null ? SIN_CATEGORIA : String(tela.idCategoria));
      setIdComposicion(tela.idComposicion === null ? SIN_COMPOSICION : String(tela.idComposicion));
      setIdProveedor(tela.idProveedor);
      setNombreProveedorDueno(tela.proveedor ?? undefined);
    } else {
      formulario.reset(VALORES_INICIALES);
      setColores([]);
      setIdCategoria(SIN_CATEGORIA);
      setIdComposicion(SIN_COMPOSICION);
      setIdProveedor(null);
      setNombreProveedorDueno(undefined);
    }
    setErrorProveedor(null);
  }, [abierto, tela, formulario]);

  const llevaComplemento = formulario.watch('llevaComplemento');
  const nombreComplementoVivo = formulario.watch('nombreComplemento');

  const enviar = formulario.handleSubmit((datos) => {
    // El proveedor dueño es OBLIGATORIO solo en el ALTA (§Post-F9.11); en edición de una
    // migrada sin proveedor no se exige (el backend tampoco).
    if (!esEdicion && idProveedor === null) {
      setErrorProveedor('El proveedor es obligatorio: la tela es DE un proveedor');
      return;
    }
    setErrorProveedor(null);

    const coloresCuerpo = aColoresCuerpo(colores, { llevaComplemento: datos.llevaComplemento });
    const categoria = idCategoria === SIN_CATEGORIA ? null : Number(idCategoria);
    const composicion = idComposicion === SIN_COMPOSICION ? null : Number(idComposicion);
    const precio = precioACuerpo(datos.precioSugerido);

    if (esEdicion) {
      // EDICION (PATCH): textos vacíos -> null (borrar); catálogos vacíos -> null. El
      // proveedor solo viaja si hay uno elegido (no se puede "quitar", solo corregir);
      // desmarcar "lleva complemento" manda null (la bandera es que sea null).
      const cuerpo: TelaEditar = {
        nombre: datos.nombre,
        descripcion: textoONull(datos.descripcion),
        nombreProveedor: textoONull(datos.nombreProveedor),
        nombreCuerpo: textoONull(datos.nombreCuerpo),
        nombreComplemento: datos.llevaComplemento ? textoONull(datos.nombreComplemento) : null,
        unidadMedida: datos.unidadMedida,
        tipoComponente: datos.tipoComponente,
        favorito: datos.favorito,
        paraProduccion: datos.paraProduccion,
        idCategoria: categoria,
        idComposicion: composicion,
        ...(idProveedor === null ? {} : { idProveedor }),
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
      idProveedor: idProveedor as number, // validado arriba: en alta nunca es null
      tipoComponente: datos.tipoComponente,
      favorito: datos.favorito,
      paraProduccion: datos.paraProduccion,
      colores: coloresCuerpo,
      ...(datos.descripcion.trim() === '' ? {} : { descripcion: datos.descripcion.trim() }),
      ...(datos.nombreProveedor.trim() === ''
        ? {}
        : { nombreProveedor: datos.nombreProveedor.trim() }),
      ...(datos.nombreCuerpo.trim() === '' ? {} : { nombreCuerpo: datos.nombreCuerpo.trim() }),
      ...(datos.llevaComplemento && datos.nombreComplemento.trim() !== ''
        ? { nombreComplemento: datos.nombreComplemento.trim() }
        : {}),
      unidadMedida: datos.unidadMedida,
      ...(categoria === null ? {} : { idCategoria: categoria }),
      ...(composicion === null ? {} : { idComposicion: composicion }),
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
            <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4 pr-1">
              <LeyendaObligatorios />
              <FieldGroup>
                <Field data-invalid={Boolean(errors.nombre)}>
                  <FieldLabel htmlFor="tela-nombre" required>
                    Nombre
                  </FieldLabel>
                  <Input
                    id="tela-nombre"
                    autoFocus
                    placeholder="Ej. Felpa perchada 280 g"
                    aria-invalid={Boolean(errors.nombre)}
                    disabled={guardando}
                    {...registrar('nombre')}
                  />
                  <FieldError errors={[errors.nombre]} />
                </Field>

                {/* Proveedor DUEÑO del artículo (§Post-F9.11): obligatorio solo en alta. */}
                <Field data-invalid={errorProveedor !== null}>
                  <FieldLabel htmlFor="tela-proveedor" required={!esEdicion}>
                    Proveedor
                  </FieldLabel>
                  <SelectorProveedor
                    idInput="tela-proveedor"
                    idSeleccionado={idProveedor ?? undefined}
                    nombreSeleccionado={nombreProveedorDueno}
                    alSeleccionar={(proveedor) => {
                      setIdProveedor(proveedor.id);
                      setNombreProveedorDueno(proveedor.nombre);
                      setErrorProveedor(null);
                    }}
                    // Solo en ALTA se puede limpiar (elegir de nuevo); en edición, una tela
                    // con dueño no se degrada a sin-proveedor (se corrige a otro).
                    {...(!esEdicion || tela.idProveedor === null
                      ? {
                          alLimpiar: () => {
                            setIdProveedor(null);
                            setNombreProveedorDueno(undefined);
                          },
                        }
                      : {})}
                    testid="tela-proveedor"
                  />
                  <FieldDescription>
                    La tela es DE un proveedor: la felpa de Alsatex y la de otro son telas
                    distintas.
                    {esEdicion && tela.idProveedor === null
                      ? ' Esta tela migrada aún no tiene proveedor; puedes ponérselo.'
                      : ''}
                  </FieldDescription>
                  {errorProveedor !== null ? (
                    <p
                      className="text-sm text-destructive"
                      role="alert"
                      data-testid="error-proveedor-tela"
                    >
                      {errorProveedor}
                    </p>
                  ) : null}
                </Field>

                {/* Nombre que le da el proveedor ("Felpa Suiza"), buscable. */}
                <Field data-invalid={Boolean(errors.nombreProveedor)}>
                  <FieldLabel htmlFor="tela-nombre-proveedor">Nombre del proveedor</FieldLabel>
                  <Input
                    id="tela-nombre-proveedor"
                    placeholder="Ej. Felpa Suiza"
                    aria-invalid={Boolean(errors.nombreProveedor)}
                    disabled={guardando}
                    data-testid="tela-nombre-proveedor"
                    {...registrar('nombreProveedor')}
                  />
                  <FieldDescription>Cómo le llama él a esta tela (buscable).</FieldDescription>
                  <FieldError errors={[errors.nombreProveedor]} />
                </Field>

                <Field data-invalid={Boolean(errors.descripcion)}>
                  <FieldLabel htmlFor="tela-descripcion">Descripción</FieldLabel>
                  <textarea
                    id="tela-descripcion"
                    rows={2}
                    placeholder="Ej. 95% algodón / 5% spandex, tubular"
                    aria-invalid={Boolean(errors.descripcion)}
                    disabled={guardando}
                    className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"
                    {...registrar('descripcion')}
                  />
                  <FieldError errors={[errors.descripcion]} />
                </Field>

                {/* Tipo de tela (la categoría; selector + alta rápida) */}
                <Field>
                  <FieldLabel htmlFor="tela-categoria">Tipo de tela</FieldLabel>
                  <div className="flex items-center gap-2">
                    <SelectNativo
                      id="tela-categoria"
                      value={idCategoria}
                      onChange={(e) => setIdCategoria(e.target.value)}
                      disabled={guardando || categoriasConsulta.isPending}
                      data-testid="tela-categoria"
                    >
                      <option value={SIN_CATEGORIA}>Sin tipo</option>
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
                      Nuevo
                    </Button>
                  </div>
                  <FieldDescription>Agrupa las telas (Felpa, Jersey, Rib…).</FieldDescription>
                </Field>

                {/* Composición (catálogo nuevo §Post-F9.11; selector + alta rápida) */}
                <Field>
                  <FieldLabel htmlFor="tela-composicion">Composición</FieldLabel>
                  <div className="flex items-center gap-2">
                    <SelectNativo
                      id="tela-composicion"
                      value={idComposicion}
                      onChange={(e) => setIdComposicion(e.target.value)}
                      disabled={guardando || composicionesConsulta.isPending}
                      data-testid="tela-composicion"
                    >
                      <option value={SIN_COMPOSICION}>Sin composición</option>
                      {composiciones.map((comp: ComposicionTela) => (
                        <option key={comp.id} value={String(comp.id)}>
                          {comp.nombre}
                        </option>
                      ))}
                    </SelectNativo>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDialogoComposicion(true)}
                      disabled={guardando}
                      data-testid="nueva-composicion-tela"
                    >
                      <PlusIcon aria-hidden />
                      Nueva
                    </Button>
                  </div>
                  <FieldDescription>
                    Del catálogo, para mantener congruencia (ej. 50% Algodón, 50% Poliéster).
                  </FieldDescription>
                </Field>

                {/* Unidad: kilos o metros, obligatoria (de ella dependen stock, consumo y costo) */}
                <Field data-invalid={Boolean(errors.unidadMedida)}>
                  <FieldLabel htmlFor="tela-unidad" required>
                    Unidad
                  </FieldLabel>
                  <SelectNativo
                    id="tela-unidad"
                    aria-invalid={Boolean(errors.unidadMedida)}
                    disabled={guardando}
                    data-testid="tela-unidad"
                    {...registrar('unidadMedida')}
                  >
                    <option value="">Elige la unidad…</option>
                    {UNIDADES.map((u) => (
                      <option key={u} value={u}>
                        {ETIQUETA_UNIDAD[u]}
                      </option>
                    ))}
                  </SelectNativo>
                  <FieldDescription>
                    Como se compra y como se consume. No se puede dejar en blanco.
                  </FieldDescription>
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

                {/* Complemento: parte de la MISMA tela (§Post-F9.11) */}
                <Field orientation="horizontal">
                  <input
                    id="tela-lleva-complemento"
                    type="checkbox"
                    className="size-4 rounded border-input accent-primary"
                    disabled={guardando}
                    data-testid="tela-lleva-complemento"
                    {...registrar('llevaComplemento')}
                  />
                  <FieldLabel htmlFor="tela-lleva-complemento" className="font-normal">
                    Lleva complemento (ej. cardigán)
                  </FieldLabel>
                </Field>

                {llevaComplemento ? (
                  <>
                    <Field data-invalid={Boolean(errors.nombreCuerpo)}>
                      <FieldLabel htmlFor="tela-nombre-cuerpo">Nombre del cuerpo</FieldLabel>
                      <Input
                        id="tela-nombre-cuerpo"
                        placeholder="Ej. Felpa"
                        aria-invalid={Boolean(errors.nombreCuerpo)}
                        disabled={guardando}
                        data-testid="tela-nombre-cuerpo"
                        {...registrar('nombreCuerpo')}
                      />
                      <FieldError errors={[errors.nombreCuerpo]} />
                    </Field>
                    <Field data-invalid={Boolean(errors.nombreComplemento)}>
                      <FieldLabel htmlFor="tela-nombre-complemento" required>
                        Nombre del complemento
                      </FieldLabel>
                      <Input
                        id="tela-nombre-complemento"
                        placeholder="Ej. Cardigán"
                        aria-invalid={Boolean(errors.nombreComplemento)}
                        disabled={guardando}
                        data-testid="tela-nombre-complemento"
                        {...registrar('nombreComplemento')}
                      />
                      <FieldDescription>
                        Entradas y salidas del cuerpo y del complemento van siempre juntas.
                      </FieldDescription>
                      <FieldError errors={[errors.nombreComplemento]} />
                    </Field>
                  </>
                ) : null}

                {/* Precio sugerido */}
                <Field data-invalid={Boolean(errors.precioSugerido)}>
                  <FieldLabel htmlFor="tela-precio">Precio sugerido</FieldLabel>
                  <Input
                    id="tela-precio"
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    placeholder="Ej. 78.00"
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

                {/* Grid de colores con pantone y precios (inline, puede ir vacío) */}
                <EditorColoresTela
                  colores={colores}
                  alCambiar={setColores}
                  deshabilitado={guardando}
                  llevaComplemento={llevaComplemento}
                  nombreComplemento={nombreComplementoVivo}
                />
              </FieldGroup>

              {!esEdicion ? (
                <AvisoAlta>
                  Después, en el detalle, agrega los precios de esta tela por proveedor y por color.
                </AvisoAlta>
              ) : null}
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
              <Button
                type="submit"
                disabled={guardando}
                data-testid="guardar-tela"
                className="w-full sm:w-auto"
              >
                {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                {esEdicion ? 'Guardar cambios' : 'Crear tela'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Alta rápida de tipo de tela: al crearlo, queda seleccionado. */}
      <DialogoNuevaCategoria
        abierto={dialogoCategoria}
        alCambiarAbierto={setDialogoCategoria}
        alCreada={(creada) => setIdCategoria(String(creada))}
      />
      {/* Alta rápida de composición: al crearla, queda seleccionada. */}
      <DialogoNuevaComposicion
        abierto={dialogoComposicion}
        alCambiarAbierto={setDialogoComposicion}
        alCreada={(creada) => setIdComposicion(String(creada))}
      />
    </>
  );
}

/** Captura del alta rápida de categoría / tipo de tela (solo el nombre). */
const esquemaCategoriaFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
});
type DatosCategoriaFormulario = z.infer<typeof esquemaCategoriaFormulario>;

/**
 * Diálogo de ALTA RÁPIDA de tipo de tela (categoría; se abre desde el selector del form de
 * tela). Al crearlo con éxito, avisa el id al padre para dejarlo seleccionado y cierra. El
 * backend exige el nombre único (A1); si choca, el toast muestra su mensaje.
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
          toast.success(`Tipo de tela "${creada.nombre}" creado.`);
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
            <DialogTitle>Nuevo tipo de tela</DialogTitle>
            <DialogDescription>Agrupa las telas (p. ej. Felpa, Jersey, Rib).</DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="categoria-nombre" required>
                Nombre
              </FieldLabel>
              <Input
                id="categoria-nombre"
                autoFocus
                placeholder="Ej. Felpa"
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
              Crear tipo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Captura del alta rápida de composición (solo el nombre). */
const esquemaComposicionFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
});
type DatosComposicionFormulario = z.infer<typeof esquemaComposicionFormulario>;

/**
 * Diálogo de ALTA RÁPIDA de composición de tela (§Post-F9.11; espejo de la categoría).
 * Al crearla con éxito, avisa el id al padre para dejarla seleccionada y cierra.
 */
function DialogoNuevaComposicion({
  abierto,
  alCambiarAbierto,
  alCreada,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  alCreada: (idComposicion: number) => void;
}): React.JSX.Element {
  const crear = useCrearComposicionTela();

  const formulario = useForm<DatosComposicionFormulario>({
    resolver: zodResolver(esquemaComposicionFormulario),
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
          toast.success(`Composición "${creada.nombre}" creada.`);
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
            <DialogTitle>Nueva composición de tela</DialogTitle>
            <DialogDescription>
              Del catálogo, para mantener congruencia (p. ej. 50% Algodón, 50% Poliéster).
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="composicion-nombre" required>
                Nombre
              </FieldLabel>
              <Input
                id="composicion-nombre"
                autoFocus
                placeholder="Ej. 50% Algodón, 50% Poliéster"
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
            <Button type="submit" disabled={crear.isPending} data-testid="guardar-composicion-tela">
              {crear.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Crear composición
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
