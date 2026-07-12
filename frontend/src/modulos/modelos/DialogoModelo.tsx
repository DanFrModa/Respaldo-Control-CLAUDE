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
import { useTiposProductoActivos } from '@/api/calidad';
import { useDificultad } from '@/api/dificultad';
import { useProveedores, useRolesProveedor } from '@/api/proveedores';
import { useCurvas } from '@/api/tallas';
import { useTemporadas } from '@/api/temporadas';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { AvisoAlta } from '@/components/ui/aviso-alta';
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

/** Valores por defecto de un alta (todo vacío; la secuencia arranca en 'antes', el default del taller). */
const VALORES_INICIALES: DatosModeloFormulario = {
  codigo: '',
  descripcion: '',
  maquilaBase: '',
  corteBase: '',
  numOperaciones: '',
  secuenciaEstampado: 'antes',
  idTemporada: '',
  idCurvaTalla: '',
  idGenero: '',
  idTipoProducto: '',
  idMaquileroCotizado: '',
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
  const corte = numeroOpcionalACuerpo(datos.corteBase);
  if (corte !== undefined) {
    cuerpo.corteBase = corte;
  }
  const numOps = numeroOpcionalACuerpo(datos.numOperaciones);
  if (numOps !== undefined) {
    cuerpo.numOperaciones = numOps;
  }
  cuerpo.secuenciaEstampado = datos.secuenciaEstampado;
  const idMaquilero = idSelectorACuerpo(datos.idMaquileroCotizado);
  if (idMaquilero !== null) {
    cuerpo.idMaquileroCotizado = idMaquilero;
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
  const idTipoProducto = idSelectorACuerpo(datos.idTipoProducto);
  if (idTipoProducto !== null) {
    cuerpo.idTipoProducto = idTipoProducto;
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
    corteBase: numeroOpcionalACuerpo(datos.corteBase) ?? null,
    numOperaciones: numeroOpcionalACuerpo(datos.numOperaciones) ?? null,
    secuenciaEstampado: datos.secuenciaEstampado,
    idTemporada: idSelectorACuerpo(datos.idTemporada),
    idCurvaTalla: idSelectorACuerpo(datos.idCurvaTalla),
    idGenero: idSelectorACuerpo(datos.idGenero),
    idTipoProducto: idSelectorACuerpo(datos.idTipoProducto),
    idMaquileroCotizado: idSelectorACuerpo(datos.idMaquileroCotizado),
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
  prellenadoAlta,
  alCrear,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Modelo a editar; `undefined` -> alta. */
  modelo: Modelo | undefined;
  /**
   * Valores con los que precargar el formulario en ALTA (p. ej. el importador de OC propone la
   * descripción del artículo del cliente). Se ignora en edición; el código lo captura el usuario.
   */
  prellenadoAlta?: { codigo?: string; descripcion?: string };
  /** Se invoca con el modelo recién creado, para que el llamador lo use (p. ej. dejarlo ligado). */
  alCrear?: (modelo: Modelo) => void;
}): React.JSX.Element {
  const esEdicion = modelo !== undefined;
  const crear = useCrearModelo();
  const actualizar = useActualizarModelo();
  const guardando = crear.isPending || actualizar.isPending;

  const temporadas = useTemporadas(QUERY_SELECTOR);
  const curvas = useCurvas(QUERY_SELECTOR);
  const generos = useGeneros();
  const tiposProducto = useTiposProductoActivos();
  // Maquileros (costura) para el selector del maquilero cotizado (R5/B9): filtra por rol `maquila-costura`
  // (código sembrado en `ROLES_PROVEEDOR_BASE`; el backend re-valida ese mismo rol, A1).
  const rolesProveedor = useRolesProveedor();
  const idRolCostura = rolesProveedor.data?.find((r) => r.codigo === 'maquila-costura')?.id;
  const maquileros = useProveedores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    ...(idRolCostura === undefined ? {} : { rol: idRolCostura }),
  });

  const formulario = useForm<DatosModeloFormulario>({
    resolver: zodResolver(esquemaModeloFormulario),
    defaultValues: VALORES_INICIALES,
  });

  // Se depende de los primitivos del prefill (no del objeto) para no re-resetear en cada render.
  const prellenadoCodigo = prellenadoAlta?.codigo;
  const prellenadoDescripcion = prellenadoAlta?.descripcion;
  useEffect(() => {
    if (abierto) {
      formulario.reset(
        modelo
          ? {
              codigo: modelo.codigo,
              descripcion: modelo.descripcion ?? '',
              maquilaBase: modelo.maquilaBase === null ? '' : String(modelo.maquilaBase),
              corteBase: modelo.corteBase === null ? '' : String(modelo.corteBase),
              numOperaciones: modelo.numOperaciones === null ? '' : String(modelo.numOperaciones),
              secuenciaEstampado: modelo.secuenciaEstampado,
              idTemporada: idTexto(modelo.idTemporada),
              idCurvaTalla: idTexto(modelo.idCurvaTalla),
              idGenero: idTexto(modelo.idGenero),
              idTipoProducto: idTexto(modelo.idTipoProducto),
              idMaquileroCotizado: idTexto(modelo.idMaquileroCotizado),
            }
          : {
              ...VALORES_INICIALES,
              ...(prellenadoCodigo !== undefined ? { codigo: prellenadoCodigo } : {}),
              ...(prellenadoDescripcion !== undefined
                ? { descripcion: prellenadoDescripcion }
                : {}),
            },
      );
    }
  }, [abierto, modelo, formulario, prellenadoCodigo, prellenadoDescripcion]);

  // Dificultad EN VIVO (R5/B7): deriva del # de operaciones capturado contra la tabla de rangos (R4).
  const numOpsTexto = formulario.watch('numOperaciones');
  const opsNum =
    numOpsTexto.trim() !== '' && Number.isInteger(Number(numOpsTexto)) && Number(numOpsTexto) >= 0
      ? Number(numOpsTexto)
      : null;
  const dificultad = useDificultad(opsNum);

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
        alCrear?.(resultado);
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

          <div className="max-h-[60vh] space-y-3 overflow-y-auto py-4 pr-1">
            <LeyendaObligatorios />
            <Accordion
              type="multiple"
              defaultValue={['identidad', 'costos']}
              className="flex flex-col gap-2"
            >
              {/* ── Identidad ────────────────────────────────────────────────── */}
              <AccordionItem value="identidad">
                <AccordionTrigger>Identidad</AccordionTrigger>
                <AccordionContent>
                  <FieldGroup>
                    <Field data-invalid={Boolean(errors.codigo)}>
                      <FieldLabel htmlFor="modelo-codigo" required>
                        Código
                      </FieldLabel>
                      <Input
                        id="modelo-codigo"
                        autoFocus
                        placeholder="Ej. 4521"
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
                        placeholder="Ej. Sudadera cerrada con capucha"
                        aria-invalid={Boolean(errors.descripcion)}
                        disabled={guardando}
                        {...registrar('descripcion')}
                      />
                      <FieldError errors={[errors.descripcion]} />
                    </Field>
                  </FieldGroup>
                </AccordionContent>
              </AccordionItem>

              {/* ── Costos y costura ─────────────────────────────────────────── */}
              <AccordionItem value="costos">
                <AccordionTrigger>Costos y costura</AccordionTrigger>
                <AccordionContent>
                  <FieldGroup>
                    <Field data-invalid={Boolean(errors.maquilaBase)}>
                      <FieldLabel htmlFor="modelo-maquila">Maquila base</FieldLabel>
                      <Input
                        id="modelo-maquila"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        placeholder="Ej. 45.00"
                        aria-invalid={Boolean(errors.maquilaBase)}
                        disabled={guardando}
                        {...registrar('maquilaBase')}
                      />
                      <FieldDescription>
                        Costo de maquila base que heredan las órdenes.
                      </FieldDescription>
                      <FieldError errors={[errors.maquilaBase]} />
                    </Field>

                    <Field data-invalid={Boolean(errors.corteBase)}>
                      <FieldLabel htmlFor="modelo-corte">Corte</FieldLabel>
                      <Input
                        id="modelo-corte"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        placeholder="Ej. 8.50"
                        aria-invalid={Boolean(errors.corteBase)}
                        disabled={guardando}
                        {...registrar('corteBase')}
                      />
                      <FieldDescription>
                        Costo de corte por prenda, separado de la maquila (sin proveedor).
                      </FieldDescription>
                      <FieldError errors={[errors.corteBase]} />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="modelo-maquilero">
                        Maquilero cotizado (costura)
                      </FieldLabel>
                      <SelectNativo
                        id="modelo-maquilero"
                        disabled={guardando}
                        {...registrar('idMaquileroCotizado')}
                      >
                        <option value="">Sin definir</option>
                        {(maquileros.data?.datos ?? []).map((p) => (
                          <option key={p.id} value={String(p.id)}>
                            {p.nombre}
                          </option>
                        ))}
                      </SelectNativo>
                      <FieldDescription>
                        Con quién se coteó la costura; siembra el default del maquilero de
                        producción.
                      </FieldDescription>
                    </Field>

                    <Field data-invalid={Boolean(errors.numOperaciones)}>
                      <FieldLabel htmlFor="modelo-num-operaciones">
                        # de operaciones de costura
                      </FieldLabel>
                      <Input
                        id="modelo-num-operaciones"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step="1"
                        placeholder="Ej. 22"
                        aria-invalid={Boolean(errors.numOperaciones)}
                        disabled={guardando}
                        {...registrar('numOperaciones')}
                      />
                      <FieldDescription data-testid="dificultad-derivada">
                        {opsNum === null
                          ? 'Deriva la dificultad y los días de costura del CPM.'
                          : dificultad.data?.rango
                            ? `${String(opsNum)} ops → ${dificultad.data.rango.nombre} → costura ≈ ${String(dificultad.data.rango.diasCostura)} d`
                            : dificultad.isPending
                              ? 'Calculando dificultad…'
                              : 'Ningún rango cubre ese # de operaciones (revisa la tabla de dificultad).'}
                      </FieldDescription>
                      <FieldError errors={[errors.numOperaciones]} />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="modelo-secuencia-estampado">
                        Secuencia de estampado
                      </FieldLabel>
                      <SelectNativo
                        id="modelo-secuencia-estampado"
                        disabled={guardando}
                        {...registrar('secuenciaEstampado')}
                      >
                        <option value="antes">Antes de coser</option>
                        <option value="despues">Después de coser</option>
                        <option value="flexible">Flexible (se decide por orden)</option>
                      </SelectNativo>
                    </Field>
                  </FieldGroup>
                </AccordionContent>
              </AccordionItem>

              {/* ── Clasificación ────────────────────────────────────────────── */}
              <AccordionItem value="clasificacion">
                <AccordionTrigger>Clasificación</AccordionTrigger>
                <AccordionContent>
                  <FieldGroup>
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
                      <SelectNativo
                        id="modelo-curva"
                        disabled={guardando}
                        {...registrar('idCurvaTalla')}
                      >
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
                      <SelectNativo
                        id="modelo-genero"
                        disabled={guardando}
                        {...registrar('idGenero')}
                      >
                        <option value="">Sin género</option>
                        {(generos.data ?? []).map((g) => (
                          <option key={g.id} value={String(g.id)}>
                            {g.nombre}
                          </option>
                        ))}
                      </SelectNativo>
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="modelo-tipo-producto">Tipo de producto</FieldLabel>
                      <SelectNativo
                        id="modelo-tipo-producto"
                        disabled={guardando}
                        {...registrar('idTipoProducto')}
                      >
                        <option value="">Sin tipo de producto</option>
                        {(tiposProducto.data?.datos ?? []).map((t) => (
                          <option key={t.id} value={String(t.id)}>
                            {t.nombre}
                          </option>
                        ))}
                      </SelectNativo>
                    </Field>
                  </FieldGroup>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {!esEdicion ? <AvisoAlta>Después arma la receta y sube las fotos.</AvisoAlta> : null}
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
              data-testid="guardar-modelo"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear modelo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
