import { zodResolver } from '@hookform/resolvers/zod';
import {
  Building,
  Loader2Icon,
  MergeIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  useActualizarDepartamentoCliente,
  useAgregarDepartamentoCliente,
  useDepartamentosCliente,
  useDesactivarDepartamentoCliente,
  useReactivarDepartamentoCliente,
} from '@/api/clientes';
import type {
  ClienteDepartamento,
  ClienteDepartamentoCrear,
  ClienteDepartamentoEditar,
} from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { DialogoFusionDepartamentos } from './DialogoFusionDepartamentos';
import { EstadoPunto } from '@/components/dominio/visuales';
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
import { Skeleton } from '@/components/ui/skeleton';

/** Esquema de captura del nombre de un departamento (solo UX; el backend re-valida, A1). */
const esquemaDepartamentoFormulario = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
});

/** Datos del formulario de un departamento. */
type DatosDepartamentoFormulario = z.infer<typeof esquemaDepartamentoFormulario>;

/**
 * Editor de los departamentos de un cliente (D13/R16). Vive en el panel de DETALLE del cliente
 * (necesita su id), igual que el editor de campos de referencia. Permite agregar departamentos,
 * editar su nombre, desactivarlos (borrado suave, con confirmación) y reactivarlos. Muestra
 * activos e inactivos (los inactivos atenuados). La unicidad del nombre POR CLIENTE la decide el
 * backend (A1); si choca, el toast muestra su mensaje ("ya existe un departamento con ese nombre").
 *
 * Los departamentos son la dimensión "Cliente + Departamento" sobre la que E2 arma los proyectos
 * de desarrollo; aquí solo se administran como catálogo del cliente.
 */
export function EditorDepartamentosCliente({
  idCliente,
  deshabilitado = false,
}: {
  idCliente: number;
  deshabilitado?: boolean;
}): React.JSX.Element {
  const consulta = useDepartamentosCliente(idCliente);
  const desactivar = useDesactivarDepartamentoCliente();
  const reactivar = useReactivarDepartamentoCliente();

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [fusionAbierta, setFusionAbierta] = useState(false);
  const [enEdicion, setEnEdicion] = useState<ClienteDepartamento | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<ClienteDepartamento | null>(null);

  function abrirAlta(): void {
    setEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(departamento: ClienteDepartamento): void {
    setEnEdicion(departamento);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(
      { idCliente, id: objetivo.id },
      {
        onSuccess: () => {
          toast.success(`Departamento "${objetivo.nombre}" desactivado.`);
          setADesactivar(null);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  // Reactivar es NO destructivo: directo, sin confirmación.
  function reactivarDepartamento(departamento: ClienteDepartamento): void {
    reactivar.mutate(
      { idCliente, id: departamento.id },
      {
        onSuccess: () => toast.success(`Departamento "${departamento.nombre}" activado.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const departamentos = consulta.data ?? [];

  return (
    <div className="space-y-3" data-testid="editor-departamentos-cliente">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Departamentos del cliente (p. ej. Dama, Caballero, Niño). Son la base de los proyectos de
          desarrollo (Cliente + Departamento).
        </p>
        {deshabilitado ? null : (
          <div className="flex shrink-0 items-center gap-2">
            {/* ⭐ §Post-F9.122(a): el importador de OC crea un departamento por cada texto nuevo que
                trae la OC ("2-HOMBRE" vs "Caballeros"), asi que el catalogo se llena de sinonimos y
                la lista de precios —que cuelga de cliente + departamento— se parte en dos mundos
                que no se ven. Solo tiene sentido ofrecerlo cuando hay al menos dos que juntar. */}
            {departamentos.filter((d) => d.activo).length >= 2 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFusionAbierta(true)}
                data-testid="fusionar-departamentos"
              >
                <MergeIcon aria-hidden />
                Juntar duplicados
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={abrirAlta}
              data-testid="nuevo-departamento"
            >
              <PlusIcon aria-hidden />
              Agregar departamento
            </Button>
          </div>
        )}
      </div>

      {consulta.isPending ? (
        <div className="space-y-2" data-testid="departamentos-cargando">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : consulta.isError ? (
        <p className="text-sm text-destructive">{consulta.error.message}</p>
      ) : departamentos.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="departamentos-vacio">
          Este cliente no tiene departamentos.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="lista-departamentos">
          {departamentos.map((departamento) => (
            <li
              key={departamento.id}
              data-testid="fila-departamento"
              data-activo={departamento.activo}
              className="flex items-center gap-3 rounded-lg border p-2.5"
            >
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
              >
                <Building className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{departamento.nombre}</span>
                  {departamento.activo ? null : <EstadoPunto activo={false} />}
                </span>
              </div>
              {deshabilitado ? null : (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => abrirEdicion(departamento)}
                    aria-label={`Editar departamento ${departamento.nombre}`}
                    data-testid="editar-departamento"
                  >
                    <PencilIcon aria-hidden />
                  </Button>
                  {departamento.activo ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setADesactivar(departamento)}
                      aria-label={`Desactivar departamento ${departamento.nombre}`}
                      data-testid="desactivar-departamento"
                    >
                      <PowerOffIcon className="text-destructive" aria-hidden />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => reactivarDepartamento(departamento)}
                      aria-label={`Activar departamento ${departamento.nombre}`}
                      data-testid="activar-departamento"
                    >
                      <PowerIcon aria-hidden />
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <DialogoFusionDepartamentos
        abierto={fusionAbierta}
        alCambiarAbierto={setFusionAbierta}
        idCliente={idCliente}
        departamentos={departamentos}
      />
      <DialogoDepartamento
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        idCliente={idCliente}
        departamento={enEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar departamento"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el departamento{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Podrás
            volver a activarlo después.
          </>
        }
        textoConfirmar="Desactivar"
        variante="destructive"
        procesando={desactivar.isPending}
        alConfirmar={confirmarDesactivar}
      />
    </div>
  );
}

/**
 * Diálogo de alta/edición de un departamento. Si recibe un `departamento` edita (PATCH nombre);
 * si no, da de alta (POST). El backend exige el nombre único por cliente (A1); si choca, el toast
 * muestra su mensaje. Al guardar con éxito cierra y avisa.
 */
function DialogoDepartamento({
  abierto,
  alCambiarAbierto,
  idCliente,
  departamento,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  idCliente: number;
  /** Departamento a editar; `undefined` -> alta. */
  departamento: ClienteDepartamento | undefined;
}): React.JSX.Element {
  const esEdicion = departamento !== undefined;
  const agregar = useAgregarDepartamentoCliente();
  const actualizar = useActualizarDepartamentoCliente();
  const guardando = agregar.isPending || actualizar.isPending;

  const formulario = useForm<DatosDepartamentoFormulario>({
    resolver: zodResolver(esquemaDepartamentoFormulario),
    defaultValues: { nombre: '' },
  });

  useEffect(() => {
    if (!abierto) {
      return;
    }
    formulario.reset({ nombre: departamento?.nombre ?? '' });
  }, [abierto, departamento, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      const cuerpo: ClienteDepartamentoEditar = { nombre: datos.nombre };
      actualizar.mutate(
        { idCliente, id: departamento.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Departamento "${resultado.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    const cuerpo: ClienteDepartamentoCrear = { nombre: datos.nombre };
    agregar.mutate(
      { idCliente, cuerpo },
      {
        onSuccess: (resultado) => {
          toast.success(`Departamento "${resultado.nombre}" agregado.`);
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
            <DialogTitle>{esEdicion ? 'Editar departamento' : 'Nuevo departamento'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el nombre de este departamento.'
                : 'Agrega un departamento del cliente (D13/R16).'}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <FieldGroup>
              <Field data-invalid={Boolean(errors.nombre)}>
                <FieldLabel htmlFor="departamento-nombre">Nombre</FieldLabel>
                <Input
                  id="departamento-nombre"
                  autoFocus
                  aria-invalid={Boolean(errors.nombre)}
                  disabled={guardando}
                  placeholder="p. ej. Dama"
                  {...formulario.register('nombre')}
                />
                <FieldError errors={[errors.nombre]} />
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
            <Button type="submit" disabled={guardando} data-testid="guardar-departamento">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Agregar departamento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
