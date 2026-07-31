import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  type DatosAlmacenFormulario,
  ETIQUETAS_TIPO_ALMACEN,
  esquemaAlmacenFormulario,
  TIPOS_ALMACEN,
} from '@/api/esquemas';
import { useActualizarAlmacen, useCrearAlmacen } from '@/api/almacenes';
import type { Almacen } from '@/api/tipos';
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

/**
 * Dialogo de alta y edicion de almacen (react-hook-form + Zod). Si recibe un
 * `almacen` edita (PATCH); si no, da de alta (POST). Al guardar con exito cierra
 * y avisa con un toast; el error del servidor (validacion, conflicto de nombre,
 * permiso) se muestra como toast con el mensaje en español del backend.
 *
 * La validacion de captura es solo UX: el backend re-valida y es la autoridad.
 */
export function DialogoAlmacen({
  abierto,
  alCambiarAbierto,
  almacen,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Almacen a editar; `undefined` -> alta. */
  almacen: Almacen | undefined;
}): React.JSX.Element {
  const esEdicion = almacen !== undefined;
  const crear = useCrearAlmacen();
  const actualizar = useActualizarAlmacen();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosAlmacenFormulario>({
    resolver: zodResolver(esquemaAlmacenFormulario),
    defaultValues: { nombre: '', tipo: 'PT' },
  });

  // Al abrir, sincroniza el formulario con el almacen en edicion (o lo limpia
  // para un alta). `reset` corre solo cuando cambia la apertura o el almacen.
  useEffect(() => {
    if (abierto) {
      formulario.reset(
        almacen ? { nombre: almacen.nombre, tipo: almacen.tipo } : { nombre: '', tipo: 'PT' },
      );
    }
  }, [abierto, almacen, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      actualizar.mutate(
        { id: almacen.id, cuerpo: datos },
        {
          onSuccess: (resultado) => {
            toast.success(`Almacén "${resultado.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(datos, {
      onSuccess: (resultado) => {
        toast.success(`Almacén "${resultado.nombre}" creado.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent>
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar almacén' : 'Nuevo almacén'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el nombre o el tipo de este almacén.'
                : 'Captura los datos del nuevo almacén del catálogo.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <LeyendaObligatorios />
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="almacen-nombre" required>
                Nombre
              </FieldLabel>
              <Input
                id="almacen-nombre"
                autoFocus
                placeholder="Ej. Bodega PT Central"
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field data-invalid={Boolean(errors.tipo)}>
              <FieldLabel htmlFor="almacen-tipo">Tipo</FieldLabel>
              <SelectNativo
                id="almacen-tipo"
                aria-invalid={Boolean(errors.tipo)}
                disabled={guardando}
                {...formulario.register('tipo')}
              >
                {TIPOS_ALMACEN.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {ETIQUETAS_TIPO_ALMACEN[tipo]}
                  </option>
                ))}
              </SelectNativo>
              <FieldDescription>
                Qué guarda: PT = producto terminado · Telas · Avíos.
              </FieldDescription>
              <FieldError errors={[errors.tipo]} />
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
            <Button
              type="submit"
              disabled={guardando}
              data-testid="guardar-almacen"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear almacén'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
