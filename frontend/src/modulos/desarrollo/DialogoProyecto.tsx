import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useClientes, useDepartamentosCliente } from '@/api/clientes';
import { useActualizarProyecto, useCrearProyecto } from '@/api/proyectos';
import type { Proyecto, ProyectoCrear, ProyectoEditar } from '@/api/proyectos';
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
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { esquemaProyectoFormulario, type DatosProyectoFormulario } from './esquemas';

/** Tope alto: trae los clientes/temporadas activos para los selectores. */
const QUERY_CLIENTES = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;
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

  const clientes = useClientes(QUERY_CLIENTES);
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
            <Field data-invalid={Boolean(errors.idCliente)}>
              <FieldLabel htmlFor="proyecto-cliente">Cliente</FieldLabel>
              <SelectNativo
                id="proyecto-cliente"
                disabled={guardando || esEdicion}
                aria-invalid={Boolean(errors.idCliente)}
                {...registrar('idCliente', {
                  onChange: () => formulario.setValue('idClienteDepartamento', ''),
                })}
              >
                <option value="">Elige un cliente…</option>
                {(clientes.data?.datos ?? []).map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.nombre}
                  </option>
                ))}
              </SelectNativo>
              <FieldError errors={[errors.idCliente]} />
            </Field>

            <Field data-invalid={Boolean(errors.idClienteDepartamento)}>
              <FieldLabel htmlFor="proyecto-departamento">Departamento</FieldLabel>
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
              <FieldLabel htmlFor="proyecto-nombre">Nombre / tema</FieldLabel>
              <Input
                id="proyecto-nombre"
                placeholder="Joggers, Disney, básicos…"
                disabled={guardando}
                aria-invalid={Boolean(errors.nombre)}
                {...registrar('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="proyecto-temporada">Temporada (opcional)</FieldLabel>
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
              <FieldLabel htmlFor="proyecto-notas">Notas (opcional)</FieldLabel>
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
            <Button type="submit" disabled={guardando} data-testid="guardar-proyecto">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear proyecto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
