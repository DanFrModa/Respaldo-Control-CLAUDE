import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useActualizarTipoProducto, useCrearTipoProducto } from '@/api/calidad';
import { esquemaTipoProductoFormulario, type DatosTipoProductoFormulario } from '@/api/esquemas';
import type { TipoProducto } from '@/api/tipos';
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
 * Dialogo de alta y edicion de tipo de producto. Si recibe un `tipo` edita (PATCH);
 * si no, da de alta (POST). Validacion solo de UX: el backend re-valida (A1).
 */
export function DialogoTipoProducto({
  abierto,
  alCambiarAbierto,
  tipo,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  tipo: TipoProducto | undefined;
}): React.JSX.Element {
  const esEdicion = tipo !== undefined;
  const crear = useCrearTipoProducto();
  const actualizar = useActualizarTipoProducto();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosTipoProductoFormulario>({
    resolver: zodResolver(esquemaTipoProductoFormulario),
    defaultValues: { nombre: '' },
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset(tipo ? { nombre: tipo.nombre } : { nombre: '' });
    }
  }, [abierto, tipo, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      actualizar.mutate(
        { id: tipo.id, cuerpo: datos },
        {
          onSuccess: (resultado) => {
            toast.success(`Tipo "${resultado.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(datos, {
      onSuccess: (resultado) => {
        toast.success(`Tipo "${resultado.nombre}" creado.`);
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
            <DialogTitle>
              {esEdicion ? 'Editar tipo de producto' : 'Nuevo tipo de producto'}
            </DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el nombre de este tipo de producto.'
                : 'Captura el nombre del nuevo tipo de producto.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="tipo-nombre">Nombre</FieldLabel>
              <Input
                id="tipo-nombre"
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
            <Button type="submit" disabled={guardando} data-testid="guardar-tipo-producto">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear tipo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
