import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { type DatosColorFormulario, esquemaColorFormulario } from '@/api/esquemas';
import { useActualizarColor, useCrearColor } from '@/api/colores';
import type { Color } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/**
 * Dialogo de alta y edicion de color (react-hook-form + Zod).
 *
 * **ALTA RAPIDA ENCADENADA:** en alta, el dialogo NO se cierra al guardar; tras
 * crear un color, limpia el campo y vuelve el foco al input para capturar el
 * siguiente de corrido (los colores suelen darse de alta en lote). El boton
 * "Listo" cierra el dialogo. En edicion el comportamiento es el estandar: guardar
 * cierra. La validacion de captura es solo UX: el backend re-valida (A1).
 */
export function DialogoColor({
  abierto,
  alCambiarAbierto,
  color,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Color a editar; `undefined` -> alta (rapida encadenada). */
  color: Color | undefined;
}): React.JSX.Element {
  const esEdicion = color !== undefined;
  const crear = useCrearColor();
  const actualizar = useActualizarColor();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosColorFormulario>({
    resolver: zodResolver(esquemaColorFormulario),
    defaultValues: { nombre: '' },
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset(color ? { nombre: color.nombre } : { nombre: '' });
    }
  }, [abierto, color, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      actualizar.mutate(
        { id: color.id, cuerpo: datos },
        {
          onSuccess: (resultado) => {
            toast.success(`Color "${resultado.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    // Alta rapida encadenada: NO cerramos. Limpiamos el campo y devolvemos el foco
    // para seguir capturando colores de corrido.
    crear.mutate(datos, {
      onSuccess: (resultado) => {
        toast.success(`Color "${resultado.nombre}" creado.`);
        formulario.reset({ nombre: '' });
        formulario.setFocus('nombre');
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
            <DialogTitle>{esEdicion ? 'Editar color' : 'Nuevo color'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el nombre de este color.'
                : 'Captura el nombre del color. Puedes agregar varios seguidos.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="color-nombre">Nombre</FieldLabel>
              <Input
                id="color-nombre"
                autoFocus
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              {esEdicion ? null : (
                <FieldDescription>
                  Al guardar, el campo se limpia para capturar el siguiente color.
                </FieldDescription>
              )}
              <FieldError errors={[errors.nombre]} />
            </Field>
          </FieldGroup>

          <DialogFooter>
            {esEdicion ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => alCambiarAbierto(false)}
                  disabled={guardando}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={guardando} data-testid="guardar-color">
                  {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                  Guardar cambios
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => alCambiarAbierto(false)}
                  disabled={guardando}
                  data-testid="listo-color"
                >
                  Listo
                </Button>
                <Button type="submit" disabled={guardando} data-testid="guardar-color">
                  {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                  Agregar color
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
