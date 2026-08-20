import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
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
import { SelectorModelo } from '@/modulos/inventarios/SelectorModelo';

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
 * Diálogo para AGREGAR un desarrollo a un proyecto (F8-E2). Dos caminos:
 *  • "modelo existente" — se elige un modelo del catálogo (`idModelo`) y se crea el desarrollo.
 *  • "modelo nuevo" — UNA sola llamada al backend (`.../desarrollos/modelo-nuevo`), que crea el
 *    modelo y el desarrollo en la MISMA transacción.
 *
 * ⚠️ El **código del modelo nuevo ya no se teclea** (§Post-F9.34, V1-E3n): lo arma el sistema
 * (`CYA-26-71-001` = abreviatura del cliente del proyecto + año de ENTREGA + tipo de prenda y
 * género + consecutivo). Antes el frontend orquestaba dos llamadas y el usuario inventaba el
 * código; eso metía los modelos de desarrollo en la misma serie que los de producción.
 */
export function DialogoDesarrollo({
  abierto,
  alCambiarAbierto,
  idProyecto,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  idProyecto: number;
}): React.JSX.Element {
  const crearDesarrollo = useCrearDesarrollo();
  const crearConModeloNuevo = useCrearDesarrolloModeloNuevo();
  const tiposProducto = useTiposProductoActivos();
  const generos = useGeneros();
  const guardando = crearDesarrollo.isPending || crearConModeloNuevo.isPending;

  const formulario = useForm<DatosDesarrolloFormulario>({
    resolver: zodResolver(esquemaDesarrolloFormulario),
    defaultValues: VALORES_INICIALES,
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset(VALORES_INICIALES);
    }
  }, [abierto, formulario]);

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
