import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useTiposProductoActivos } from '@/api/calidad';
import { useCrearDesarrollo, useCrearDesarrolloModeloNuevo } from '@/api/desarrollos';
import { useGeneros } from '@/api/modelos';
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
  FieldLabel,
  LeyendaObligatorios,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import {
  puedeAdministrarTiposProducto,
  RUTA_TIPOS_PRODUCTO,
} from '@/modulos/calidad/puerta-tipos-producto';
import { SelectorModelo } from '@/modulos/inventarios/SelectorModelo';
import { useSesion } from '@/sesion/useSesion';

import { esquemaDesarrolloFormulario, type DatosDesarrolloFormulario } from './esquemas';

/** Valores por defecto (liga un modelo existente por defecto; el año de entrega, el actual). */
const VALORES_INICIALES: DatosDesarrolloFormulario = {
  modo: 'existente',
  idModelo: '',
  descripcionNuevo: '',
  idTipoProductoNuevo: '',
  idGeneroNuevo: '',
  anioEntregaNuevo: String(new Date().getFullYear()),
  numeroCliente: '',
  notas: '',
};

/**
 * ⭐⭐ fila 0.155 (§Post-F9.210 punto 2) — los valores de arranque CON lo que el PROYECTO ya sabe.
 *
 * Daniel: *«todos los modelos nuevos deberían jalar el género desde ahí. **Que no vuelva a
 * preguntar**… lo mismo el año de entrega»*. Aquí eso es precargar los dos selectores; si el
 * proyecto no los tiene (los anteriores a esta fila no los traen, REGLA 0-B) se cae al
 * comportamiento de siempre: género en blanco y el año actual.
 *
 * ⚠️ Esto es SÓLO la pantalla. La herencia de verdad vive en el dominio
 * (`crearDesarrolloConModeloNuevo`), que toma los del proyecto cuando el cuerpo los omite — si
 * viviera nada más aquí, cualquier otra puerta al mismo alta volvería a exigirlos en blanco (A1).
 */
function valoresConProyecto(
  idGeneroProyecto: number | null | undefined,
  anioEntregaProyecto: number | null | undefined,
): DatosDesarrolloFormulario {
  return {
    ...VALORES_INICIALES,
    idGeneroNuevo:
      idGeneroProyecto === null || idGeneroProyecto === undefined ? '' : String(idGeneroProyecto),
    anioEntregaNuevo:
      anioEntregaProyecto === null || anioEntregaProyecto === undefined
        ? VALORES_INICIALES.anioEntregaNuevo
        : String(anioEntregaProyecto),
  };
}

/**
 * Diálogo para AGREGAR un desarrollo a un proyecto (F8-E2). Dos caminos:
 *  • "modelo existente" — se elige un modelo del catálogo (`idModelo`) y se crea el desarrollo.
 *  • "modelo nuevo" — UNA sola llamada al backend (`.../desarrollos/modelo-nuevo`), que crea el
 *    modelo y el desarrollo en la MISMA transacción.
 *
 * ⚠️ El **código del modelo nuevo ya no se teclea** (§Post-F9.34, V1-E3n): lo arma el sistema
 * (`CYA-26-71-001` = abreviatura del cliente del proyecto + año de ENTREGA + tipo de prenda y
 * género + consecutivo). Antes el frontend orquestaba dos llamadas y el usuario inventaba el
 * código; eso metía los modelos de desarrollo en la misma serie que los de producción.
 *
 * ⭐ **fila 0.155 (§Post-F9.210 punto 2)** — el **género** y el **año de entrega** llegan
 * PRECARGADOS con los del proyecto (*«que no vuelva a preguntar»*) y se pueden cambiar aquí mismo
 * (*«con opción a cambiarla»*), que es exactamente lo que Daniel pidió.
 */
export function DialogoDesarrollo({
  abierto,
  alCambiarAbierto,
  idProyecto,
  idGeneroProyecto,
  anioEntregaProyecto,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  idProyecto: number;
  /** ⭐ fila 0.155 — género del proyecto: precarga el selector del modelo nuevo (editable). */
  idGeneroProyecto?: number | null;
  /** ⭐ fila 0.155 — año de entrega del proyecto: precarga la casilla del año (editable). */
  anioEntregaProyecto?: number | null;
}): React.JSX.Element {
  const crearDesarrollo = useCrearDesarrollo();
  const crearConModeloNuevo = useCrearDesarrolloModeloNuevo();
  const tiposProducto = useTiposProductoActivos();
  const generos = useGeneros();
  const guardando = crearDesarrollo.isPending || crearConModeloNuevo.isPending;

  // ⭐ V1-E8t (§Post-F9.145) — la puerta al catálogo de Calidad: se enciende SÓLO si de verdad hay
  // un tipo en gris (si no, no hay nada que arreglar y un botón ahí sería ruido), y sólo para quien
  // puede cruzarla (`puerta-tipos-producto.ts`, la MISMA función que usa la pantalla destino).
  const navegar = useNavigate();
  const { tienePermiso } = useSesion();
  const puedeArreglarTipos = puedeAdministrarTiposProducto(tienePermiso);
  const hayTipoSinDigito = (tiposProducto.data?.datos ?? []).some((t) => t.digitoConcepto === null);

  const formulario = useForm<DatosDesarrolloFormulario>({
    resolver: zodResolver(esquemaDesarrolloFormulario),
    defaultValues: VALORES_INICIALES,
  });

  useEffect(() => {
    if (abierto) {
      // ⭐ fila 0.155 — se re-arma en CADA apertura, no una sola vez: así el diálogo refleja el
      // proyecto que se está viendo aunque sus datos hayan cambiado mientras la pantalla vivía.
      formulario.reset(valoresConProyecto(idGeneroProyecto, anioEntregaProyecto));
    }
  }, [abierto, formulario, idGeneroProyecto, anioEntregaProyecto]);

  const modo = formulario.watch('modo');
  const idModeloElegido = formulario.watch('idModelo');

  const enviar = formulario.handleSubmit((datos) => {
    void (async () => {
      const comunes = {
        ...(datos.numeroCliente.trim() === '' ? {} : { numeroCliente: datos.numeroCliente.trim() }),
        ...(datos.notas.trim() === '' ? {} : { notas: datos.notas }),
      };
      try {
        if (datos.modo === 'nuevo') {
          // UNA llamada: el backend crea el modelo (con su código armado) y el desarrollo juntos.
          const creado = await crearConModeloNuevo.mutateAsync({
            idProyecto,
            cuerpo: {
              anioEntrega: Number(datos.anioEntregaNuevo.trim()),
              idTipoProducto: Number(datos.idTipoProductoNuevo),
              idGenero: Number(datos.idGeneroNuevo),
              ...(datos.descripcionNuevo.trim() === ''
                ? {}
                : { descripcion: datos.descripcionNuevo.trim() }),
              ...comunes,
            },
          });
          toast.success(`Desarrollo agregado como ${creado.codigoModelo}.`);
        } else {
          await crearDesarrollo.mutateAsync({
            idProyecto,
            cuerpo: { idModelo: Number(datos.idModelo), ...comunes },
          });
          toast.success('Desarrollo agregado.');
        }
        alCambiarAbierto(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'No se pudo agregar el desarrollo.');
      }
    })();
  });

  const { errors } = formulario.formState;
  const registrar = formulario.register;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>Agregar desarrollo</DialogTitle>
            <DialogDescription>
              Elige un modelo del catálogo o crea uno nuevo. El desarrollo lleva DOS números: el
              nuestro (código del modelo) y el del cliente.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4 pr-1">
            <LeyendaObligatorios />
            {/* Selector de modo (existente / nuevo). */}
            <Field>
              <FieldLabel htmlFor="desarrollo-modo">Modelo</FieldLabel>
              <SelectNativo id="desarrollo-modo" disabled={guardando} {...registrar('modo')}>
                <option value="existente">Elegir un modelo existente</option>
                <option value="nuevo">Crear un modelo nuevo</option>
              </SelectNativo>
            </Field>

            {modo === 'existente' ? (
              <Field data-invalid={Boolean(errors.idModelo)}>
                <FieldLabel htmlFor="desarrollo-modelo" required>
                  Modelo del catálogo
                </FieldLabel>
                {/* Buscador SERVER-SIDE (Daniel, ago-2026): el catálogo tiene ~5,000 modelos, y un
                    `<select>` con la primera página (tope 100) sólo enseñaba el 2% y el modelo recién
                    dado de alta no aparecía. El {@link SelectorModelo} busca por código o descripción
                    en el servidor y sin teclear nada ya ofrece los primeros del catálogo. */}
                <SelectorModelo
                  idSeleccionado={idModeloElegido === '' ? undefined : Number(idModeloElegido)}
                  alSeleccionar={(m) =>
                    formulario.setValue('idModelo', String(m.id), { shouldValidate: true })
                  }
                  alLimpiar={() => formulario.setValue('idModelo', '', { shouldValidate: true })}
                  idInput="desarrollo-modelo"
                  testid="desarrollo-modelo"
                />
                <FieldDescription>
                  Busca por código o descripción (el catálogo completo, no sólo los primeros).
                </FieldDescription>
                <FieldError errors={[errors.idModelo]} />
              </Field>
            ) : (
              <>
                <p
                  className="rounded-md bg-panel-2 px-3 py-2 text-xs text-muted-foreground"
                  data-testid="aviso-codigo-automatico"
                >
                  El <b>código del modelo lo arma el sistema</b>: abreviatura del cliente + año de
                  entrega + tipo de prenda y género + consecutivo (por ejemplo{' '}
                  <b className="mono">CYA-26-71-001</b>). No consume número de la serie de
                  producción; ése se asigna al pasar el modelo a producción.
                </p>
                <Field data-invalid={Boolean(errors.idTipoProductoNuevo)}>
                  <FieldLabel htmlFor="desarrollo-tipo-producto" required>
                    Tipo de prenda
                  </FieldLabel>
                  <SelectNativo
                    id="desarrollo-tipo-producto"
                    disabled={guardando}
                    aria-invalid={Boolean(errors.idTipoProductoNuevo)}
                    data-testid="desarrollo-tipo-producto"
                    {...registrar('idTipoProductoNuevo')}
                  >
                    <option value="">Elige…</option>
                    {/* Un tipo SIN dígito de concepto no puede numerar un modelo: se enseña, pero
                        deshabilitado y diciendo por qué. Antes se ofrecía como cualquier otro y el
                        alta reventaba al enviar con "captúralo en su catálogo". */}
                    {(tiposProducto.data?.datos ?? []).map((t) => (
                      <option key={t.id} value={String(t.id)} disabled={t.digitoConcepto === null}>
                        {t.digitoConcepto === null
                          ? `${t.nombre} — sin dígito, no se puede numerar`
                          : `${t.nombre} (${String(t.digitoConcepto)})`}
                      </option>
                    ))}
                  </SelectNativo>
                  <FieldDescription>
                    Da el 1er dígito de la nomenclatura. Los que salen en gris no lo tienen
                    capturado: se les pone en <b>Calidad › Tipos de producto</b>.
                  </FieldDescription>
                  {/* ⭐⭐ V1-E8t, ronda de corrección (§Post-F9.145): decir DÓNDE no es LLEVAR. Sale
                      sólo si de verdad hay algún tipo en gris —si no, no hay nada que arreglar— y
                      la puerta se pinta sólo a quien puede cruzarla; al resto se le dice a quién
                      pedírselo. Ver `puerta-tipos-producto.ts`: la razón por la que esta puerta
                      NO existía era falsa, y lo era justo para el dueño. */}
                  {hayTipoSinDigito ? (
                    <div className="mt-1" data-testid="aviso-tipo-sin-digito">
                      {puedeArreglarTipos ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={guardando}
                          onClick={() => {
                            // Se cierra el alta antes de navegar: el tipo que hace falta no se
                            // puede elegir hasta que tenga dígito, así que no hay alta que salvar.
                            alCambiarAbierto(false);
                            void navegar(RUTA_TIPOS_PRODUCTO);
                          }}
                          data-testid="ir-a-tipos-producto"
                        >
                          Capturar el dígito
                        </Button>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          El dígito lo pone quien <b>administra el catálogo de Calidad</b>: pídeselo
                          y vuelve a esta pantalla.
                        </p>
                      )}
                    </div>
                  ) : null}
                  <FieldError errors={[errors.idTipoProductoNuevo]} />
                </Field>
                <Field data-invalid={Boolean(errors.idGeneroNuevo)}>
                  <FieldLabel htmlFor="desarrollo-genero" required>
                    Género
                  </FieldLabel>
                  <SelectNativo
                    id="desarrollo-genero"
                    disabled={guardando}
                    aria-invalid={Boolean(errors.idGeneroNuevo)}
                    data-testid="desarrollo-genero"
                    {...registrar('idGeneroNuevo')}
                  >
                    <option value="">Elige…</option>
                    {(generos.data ?? []).map((g) => (
                      <option key={g.id} value={String(g.id)}>
                        {g.nombre}
                      </option>
                    ))}
                  </SelectNativo>
                  <FieldDescription>Da el 2º dígito de la nomenclatura.</FieldDescription>
                  <FieldError errors={[errors.idGeneroNuevo]} />
                </Field>
                <Field data-invalid={Boolean(errors.anioEntregaNuevo)}>
                  <FieldLabel htmlFor="desarrollo-anio-entrega" required>
                    Año de entrega
                  </FieldLabel>
                  <Input
                    id="desarrollo-anio-entrega"
                    inputMode="numeric"
                    maxLength={4}
                    className="mono w-28"
                    disabled={guardando}
                    aria-invalid={Boolean(errors.anioEntregaNuevo)}
                    data-testid="desarrollo-anio-entrega"
                    {...registrar('anioEntregaNuevo')}
                  />
                  <FieldDescription>
                    El año en que se piensa ENTREGAR (no el de captura). Se congela en el código: si
                    la entrega se recorre, el número no cambia.
                  </FieldDescription>
                  <FieldError errors={[errors.anioEntregaNuevo]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="desarrollo-descripcion">Descripción</FieldLabel>
                  <Input
                    id="desarrollo-descripcion"
                    disabled={guardando}
                    {...registrar('descripcionNuevo')}
                  />
                </Field>
              </>
            )}

            <Field>
              <FieldLabel htmlFor="desarrollo-numero-cliente">Número del cliente</FieldLabel>
              <Input
                id="desarrollo-numero-cliente"
                placeholder="Ej. SKU-99812"
                disabled={guardando}
                {...registrar('numeroCliente')}
              />
              <FieldDescription>
                El número con el que el cliente identifica el modelo.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="desarrollo-notas">Notas</FieldLabel>
              <textarea
                id="desarrollo-notas"
                rows={2}
                disabled={guardando}
                className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
                {...registrar('notas')}
              />
            </Field>
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
              data-testid="guardar-desarrollo"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Agregar desarrollo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
