import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { type DatosTemporadaFormulario, esquemaTemporadaFormulario } from '@/api/esquemas';
import { useActualizarTemporada, useCrearTemporada } from '@/api/temporadas';
import type { Temporada } from '@/api/tipos';
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

/**
 * Dialogo de alta y edicion de temporada (react-hook-form + Zod), replica del
 * patron de Almacenes. Si recibe una `temporada` edita (PATCH); si no, da de alta
 * (POST). La validacion de captura es solo UX: el backend re-valida y es la
 * autoridad (A1).
 */
export function DialogoTemporada({
  abierto,
  alCambiarAbierto,
  temporada,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Temporada a editar; `undefined` -> alta. */
  temporada: Temporada | undefined;
}): React.JSX.Element {
  const esEdicion = temporada !== undefined;
  const crear = useCrearTemporada();
  const actualizar = useActualizarTemporada();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosTemporadaFormulario>({
    resolver: zodResolver(esquemaTemporadaFormulario),
    defaultValues: { nombre: '' },
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset(temporada ? { nombre: temporada.nombre } : { nombre: '' });
    }
  }, [abierto, temporada, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      actualizar.mutate(
        { id: temporada.id, cuerpo: datos },
        {
          onSuccess: (resultado) => {
            toast.success(`Temporada "${resultado.nombre}" actualizada.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(datos, {
      onSuccess: (resultado) => {
        toast.success(`Temporada "${resultado.nombre}" creada.`);
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
            <DialogTitle>{esEdicion ? 'Editar temporada' : 'Nueva temporada'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el nombre de esta temporada.'
                : 'Captura el nombre de la nueva temporada.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="temporada-nombre">Nombre</FieldLabel>
              <Input
                id="temporada-nombre"
                autoFocus
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
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
            <Button type="submit" disabled={guardando} data-testid="guardar-temporada">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear temporada'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
