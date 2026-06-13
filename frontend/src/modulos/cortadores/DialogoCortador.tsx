import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  type DatosCortadorFormulario,
  esquemaCortadorFormulario,
  numeroOpcionalACuerpo,
} from '@/api/esquemas';
import { useActualizarCortador, useCrearCortador } from '@/api/cortadores';
import type { Cortador, CortadorCrear } from '@/api/tipos';
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

/** Valores por defecto de un alta (todo vacio). */
const VALORES_INICIALES: DatosCortadorFormulario = {
  nombre: '',
  precioReferencia: '',
  telefonos: '',
};

/**
 * Traduce la captura al cuerpo del API: `precioReferencia` se captura como texto;
 * vacio se omite (queda sin precio), si trae numero se convierte y se envia.
 * `telefonos` vacio tambien se omite.
 */
function aCuerpo(datos: DatosCortadorFormulario): CortadorCrear {
  const cuerpo: CortadorCrear = { nombre: datos.nombre };
  const precio = numeroOpcionalACuerpo(datos.precioReferencia);
  if (precio !== undefined) {
    cuerpo.precioReferencia = precio;
  }
  if (datos.telefonos.length > 0) {
    cuerpo.telefonos = datos.telefonos;
  }
  return cuerpo;
}

/**
 * Dialogo de alta y edicion de cortador (react-hook-form + Zod), replica del
 * patron de Almacenes. Si recibe un `cortador` edita (PATCH); si no, da de alta
 * (POST). La validacion de captura (incluido el precio ≥ 0) es solo UX: el
 * backend re-valida y es la autoridad (A1).
 */
export function DialogoCortador({
  abierto,
  alCambiarAbierto,
  cortador,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Cortador a editar; `undefined` -> alta. */
  cortador: Cortador | undefined;
}): React.JSX.Element {
  const esEdicion = cortador !== undefined;
  const crear = useCrearCortador();
  const actualizar = useActualizarCortador();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosCortadorFormulario>({
    resolver: zodResolver(esquemaCortadorFormulario),
    defaultValues: VALORES_INICIALES,
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset(
        cortador
          ? {
              nombre: cortador.nombre,
              // El campo numerico se edita como texto (vacio si no hay precio).
              precioReferencia: cortador.precioReferencia?.toString() ?? '',
              telefonos: cortador.telefonos ?? '',
            }
          : VALORES_INICIALES,
      );
    }
  }, [abierto, cortador, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    const cuerpo = aCuerpo(datos);
    if (esEdicion) {
      actualizar.mutate(
        { id: cortador.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Cortador "${resultado.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        toast.success(`Cortador "${resultado.nombre}" creado.`);
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
            <DialogTitle>{esEdicion ? 'Editar cortador' : 'Nuevo cortador'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia los datos de este cortador.'
                : 'Captura los datos del nuevo cortador del catálogo.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="cortador-nombre">Nombre</FieldLabel>
              <Input
                id="cortador-nombre"
                autoFocus
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field data-invalid={Boolean(errors.precioReferencia)}>
              <FieldLabel htmlFor="cortador-precio">Precio de referencia</FieldLabel>
              <Input
                id="cortador-precio"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="Opcional"
                aria-invalid={Boolean(errors.precioReferencia)}
                disabled={guardando}
                {...formulario.register('precioReferencia')}
              />
              <FieldError errors={[errors.precioReferencia]} />
            </Field>

            <Field data-invalid={Boolean(errors.telefonos)}>
              <FieldLabel htmlFor="cortador-telefonos">Teléfonos</FieldLabel>
              <Input
                id="cortador-telefonos"
                aria-invalid={Boolean(errors.telefonos)}
                disabled={guardando}
                {...formulario.register('telefonos')}
              />
              <FieldError errors={[errors.telefonos]} />
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
            <Button type="submit" disabled={guardando} data-testid="guardar-cortador">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear cortador'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
