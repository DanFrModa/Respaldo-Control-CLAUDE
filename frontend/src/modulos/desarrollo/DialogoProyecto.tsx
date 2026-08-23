import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useDepartamentosCliente } from '@/api/clientes';
import { useActualizarProyecto, useCrearProyecto } from '@/api/proyectos';
import type { Proyecto, ProyectoCrear, ProyectoEditar } from '@/api/proyectos';
import { useTemporadas } from '@/api/temporadas';
import { FiltroCliente } from '@/components/dominio/FiltroCliente';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel, LeyendaObligatorios } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { esquemaProyectoFormulario, type DatosProyectoFormulario } from './esquemas';

/** Tope alto: trae las temporadas activas para su selector. (El de CLIENTE ya no carga catálogo:
 * desde V1-E4 busca en servidor, ver `FiltroCliente`.) */
const QUERY_TEMPORADAS = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Valores por defecto de un alta (todo vacío). */
const VALORES_INICIALES: DatosProyectoFormulario = {
  idCliente: '',
  idClienteDepartamento: '',
  nombre: '',
  idTemporada: '',
  notas: '',
};

/**
 * Diálogo de alta/edición de un proyecto de desarrollo (react-hook-form + Zod). El cliente sólo se
 * elige al DAR DE ALTA (en edición queda fijo: un proyecto es de un cliente). El departamento se
 * filtra por el cliente elegido. La validación de captura es sólo UX: el backend re-valida (A1),
 * incluido que el departamento pertenezca al cliente.
 */
export function DialogoProyecto({
  abierto,
  alCambiarAbierto,
  proyecto,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Proyecto a editar; `undefined` -> alta. */
  proyecto: Proyecto | undefined;
}): React.JSX.Element {
  const esEdicion = proyecto !== undefined;
  const crear = useCrearProyecto();
  const actualizar = useActualizarProyecto();
  const guardando = crear.isPending || actualizar.isPending;

  const temporadas = useTemporadas(QUERY_TEMPORADAS);

  const formulario = useForm<DatosProyectoFormulario>({
    resolver: zodResolver(esquemaProyectoFormulario),
    defaultValues: VALORES_INICIALES,
  });

  const idClienteElegido = formulario.watch('idCliente');
  const idClienteNum = idClienteElegido === '' ? undefined : Number(idClienteElegido);
  const departamentos = useDepartamentosCliente(idClienteNum);

  useEffect(() => {
    if (!abierto) {
      return;
    }
    formulario.reset(
      proyecto
        ? {
            idCliente: String(proyecto.idCliente),
            idClienteDepartamento: String(proyecto.idClienteDepartamento),
            nombre: proyecto.nombre,
            idTemporada: proyecto.idTemporada === null ? '' : String(proyecto.idTemporada),
            notas: proyecto.notas ?? '',
          }
        : VALORES_INICIALES,
    );
  }, [abierto, proyecto, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      const cuerpo: ProyectoEditar = {
        idClienteDepartamento: Number(datos.idClienteDepartamento),
        nombre: datos.nombre,
        idTemporada: datos.idTemporada === '' ? null : Number(datos.idTemporada),
        notas: datos.notas.trim() === '' ? null : datos.notas,
      };
      actualizar.mutate(
        { id: proyecto.id, cuerpo },
        {
          onSuccess: (res) => {
            toast.success(`Proyecto ${res.folio} actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    const cuerpo: ProyectoCrear = {
      idCliente: Number(datos.idCliente),
      idClienteDepartamento: Number(datos.idClienteDepartamento),
      nombre: datos.nombre,
      ...(datos.idTemporada === '' ? {} : { idTemporada: Number(datos.idTemporada) }),
      ...(datos.notas.trim() === '' ? {} : { notas: datos.notas }),
    };
    crear.mutate(cuerpo, {
      onSuccess: (res) => {
        toast.success(`Proyecto ${res.folio} creado.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;
  const registrar = formulario.register;
  const departamentosActivos = (departamentos.data ?? []).filter(
    (d) => d.activo || String(d.id) === formulario.getValues('idClienteDepartamento'),
  );

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar proyecto' : 'Nuevo proyecto'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el departamento, el tema, la temporada y las notas del proyecto.'
                : 'Un proyecto agrupa desarrollos de un cliente y su departamento. El folio se asigna automáticamente.'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4 pr-1">
            <LeyendaObligatorios />
            <Field data-invalid={Boolean(errors.idCliente)}>
              <FieldLabel htmlFor="proyecto-cliente" required>
                Cliente
              </FieldLabel>
              {/* V1-E4 (punto 7): búsqueda server-side. El valor sigue viviendo en el
                  formulario (`setValue` con validación), solo cambia el control que lo captura. */}
              <FiltroCliente
                idCliente={idClienteElegido === '' ? null : Number(idClienteElegido)}
                /* El cliente NO se cambia en EDICIÓN: el departamento del proyecto cuelga de él y
                   el backend rechaza el guardado si dejan de casar (`proyectos.ts`). El `<select>`
                   llevaba este mismo candado; al pasar al combobox se había perdido. */
                deshabilitado={guardando || esEdicion}
                nombreInicial={proyecto?.cliente}
                alCambiar={(c) => {
                  formulario.setValue('idCliente', c === null ? '' : String(c.id), {
                    shouldValidate: true,
                    shouldDirty: true,
                  });
                  formulario.setValue('idClienteDepartamento', '');
                }}
                etiqueta="Cliente"
                placeholder="Elige un cliente…"
                idInput="proyecto-cliente"
                testid="proyecto-cliente"
              />
              <FieldError errors={[errors.idCliente]} />
            </Field>

            <Field data-invalid={Boolean(errors.idClienteDepartamento)}>
              <FieldLabel htmlFor="proyecto-departamento" required>
                Departamento
              </FieldLabel>
              <SelectNativo
                id="proyecto-departamento"
                disabled={guardando || idClienteNum === undefined}
                aria-invalid={Boolean(errors.idClienteDepartamento)}
                {...registrar('idClienteDepartamento')}
              >
                <option value="">
                  {idClienteNum === undefined
                    ? 'Elige primero un cliente…'
                    : 'Elige un departamento…'}
                </option>
                {departamentosActivos.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.nombre}
                    {d.activo ? '' : ' (desactivado)'}
                  </option>
                ))}
              </SelectNativo>
              <FieldError errors={[errors.idClienteDepartamento]} />
            </Field>

            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="proyecto-nombre" required>
                Nombre / tema
              </FieldLabel>
              <Input
                id="proyecto-nombre"
                placeholder="Ej. Joggers, Disney, básicos…"
                disabled={guardando}
                aria-invalid={Boolean(errors.nombre)}
                {...registrar('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="proyecto-temporada">Temporada</FieldLabel>
              <SelectNativo
                id="proyecto-temporada"
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
              <FieldLabel htmlFor="proyecto-notas">Notas</FieldLabel>
              <textarea
                id="proyecto-notas"
                rows={3}
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
              data-testid="guardar-proyecto"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear proyecto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
