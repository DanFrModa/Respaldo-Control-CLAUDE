import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  CONDICIONES_APLICABILIDAD,
  ETIQUETAS_CONDICION_APLICABILIDAD,
  ETIQUETAS_TIPO_DURACION_PROCESO,
  ETIQUETAS_TIPO_EVENTO_PROCESO,
  TIPOS_DURACION_PROCESO,
  TIPOS_EVENTO_PROCESO,
  esquemaProcesoRcFormulario,
  type DatosProcesoRcFormulario,
} from '@/api/esquemas';
import { useActualizarProcesoRc, useCrearProcesoRc } from '@/api/ruta-critica';
import type { ProcesoRc } from '@/api/tipos';
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
import { SelectNativo } from '@/components/ui/native-select';

/**
 * Diálogo de alta/edición de un proceso de la Ruta Crítica (react-hook-form + Zod). Captura los
 * campos del proceso (código/nombre, banderas, condición de aplicabilidad, tipo de evento y de
 * duración). Roles responsables, dependencias y checklist se gestionan APARTE (en la página de
 * detalle / en la pantalla de dependencias). El error del servidor se muestra como toast.
 */
export function DialogoProcesoRc({
  abierto,
  alCambiarAbierto,
  proceso,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Proceso a editar; `undefined` -> alta. */
  proceso: ProcesoRc | undefined;
}): React.JSX.Element {
  const esEdicion = proceso !== undefined;
  const crear = useCrearProcesoRc();
  const actualizar = useActualizarProcesoRc();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosProcesoRcFormulario>({
    resolver: zodResolver(esquemaProcesoRcFormulario),
    defaultValues: {
      codigo: '',
      nombre: '',
      critico: false,
      ultimoProceso: false,
      esResurtido: false,
      condicionAplicabilidad: 'ninguna',
      tipoEvento: 'manual',
      tipoDuracion: 'fija',
    },
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset(
        proceso
          ? {
              codigo: proceso.codigo,
              nombre: proceso.nombre,
              critico: proceso.critico,
              ultimoProceso: proceso.ultimoProceso,
              esResurtido: proceso.esResurtido,
              condicionAplicabilidad: proceso.condicionAplicabilidad,
              tipoEvento: proceso.tipoEvento,
              tipoDuracion: proceso.tipoDuracion,
            }
          : {
              codigo: '',
              nombre: '',
              critico: false,
              ultimoProceso: false,
              esResurtido: false,
              condicionAplicabilidad: 'ninguna',
              tipoEvento: 'manual',
              tipoDuracion: 'fija',
            },
      );
    }
  }, [abierto, proceso, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      actualizar.mutate(
        { id: proceso.id, cuerpo: datos },
        {
          onSuccess: (r) => {
            toast.success(`Proceso "${r.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(datos, {
      onSuccess: (r) => {
        toast.success(`Proceso "${r.nombre}" creado.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar proceso' : 'Nuevo proceso'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia los datos del proceso. Los roles, dependencias y checklist se editan aparte.'
                : 'Captura los datos del proceso de la Ruta Crítica.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={Boolean(errors.codigo)}>
              <FieldLabel htmlFor="proc-codigo">Código</FieldLabel>
              <Input
                id="proc-codigo"
                autoFocus
                placeholder="corte"
                aria-invalid={Boolean(errors.codigo)}
                disabled={guardando}
                {...formulario.register('codigo')}
              />
              <FieldError errors={[errors.codigo]} />
            </Field>

            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="proc-nombre">Nombre</FieldLabel>
              <Input
                id="proc-nombre"
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="proc-condicion">Condición de aplicabilidad</FieldLabel>
              <SelectNativo
                id="proc-condicion"
                disabled={guardando}
                {...formulario.register('condicionAplicabilidad')}
              >
                {CONDICIONES_APLICABILIDAD.map((c) => (
                  <option key={c} value={c}>
                    {ETIQUETAS_CONDICION_APLICABILIDAD[c]}
                  </option>
                ))}
              </SelectNativo>
            </Field>

            <Field>
              <FieldLabel htmlFor="proc-evento">Tipo de evento</FieldLabel>
              <SelectNativo
                id="proc-evento"
                disabled={guardando}
                {...formulario.register('tipoEvento')}
              >
                {TIPOS_EVENTO_PROCESO.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETAS_TIPO_EVENTO_PROCESO[t]}
                  </option>
                ))}
              </SelectNativo>
            </Field>

            <Field>
              <FieldLabel htmlFor="proc-duracion">Tipo de duración</FieldLabel>
              <SelectNativo
                id="proc-duracion"
                disabled={guardando}
                {...formulario.register('tipoDuracion')}
              >
                {TIPOS_DURACION_PROCESO.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETAS_TIPO_DURACION_PROCESO[t]}
                  </option>
                ))}
              </SelectNativo>
            </Field>

            <Field orientation="horizontal">
              <input
                id="proc-critico"
                type="checkbox"
                className="size-4 rounded border-input accent-primary disabled:opacity-50"
                disabled={guardando}
                data-testid="proc-critico"
                {...formulario.register('critico')}
              />
              <FieldLabel htmlFor="proc-critico" className="font-normal">
                Es un proceso crítico de la ruta
              </FieldLabel>
            </Field>

            <Field orientation="horizontal">
              <input
                id="proc-ultimo"
                type="checkbox"
                className="size-4 rounded border-input accent-primary disabled:opacity-50"
                disabled={guardando}
                data-testid="proc-ultimo"
                {...formulario.register('ultimoProceso')}
              />
              <FieldLabel htmlFor="proc-ultimo" className="font-normal">
                Es el último proceso (checkpoint final)
              </FieldLabel>
            </Field>

            <Field orientation="horizontal">
              <input
                id="proc-resurtido"
                type="checkbox"
                className="size-4 rounded border-input accent-primary disabled:opacity-50"
                disabled={guardando}
                data-testid="proc-resurtido"
                {...formulario.register('esResurtido')}
              />
              <FieldLabel htmlFor="proc-resurtido" className="font-normal">
                Aplica también en órdenes de resurtido
              </FieldLabel>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => alCambiarAbierto(false)}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando} data-testid="guardar-proceso-rc">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear proceso'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
