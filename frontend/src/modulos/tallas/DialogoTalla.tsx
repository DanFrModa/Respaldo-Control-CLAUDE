import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  type DatosTallaFormulario,
  esquemaTallaFormulario,
  numeroOpcionalACuerpo,
} from '@/api/esquemas';
import { useActualizarTalla, useCrearTalla } from '@/api/tallas';
import type { Talla, TallaCrear } from '@/api/tipos';
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
const VALORES_INICIALES: DatosTallaFormulario = {
  etiqueta: '',
  orden: '',
};

/**
 * Traduce la captura al cuerpo del API: el `orden` se captura como texto; vacio se
 * omite (el backend usa 0), si trae numero se convierte y se envia.
 */
function aCuerpo(datos: DatosTallaFormulario): TallaCrear {
  const cuerpo: TallaCrear = { etiqueta: datos.etiqueta };
  const orden = numeroOpcionalACuerpo(datos.orden);
  if (orden !== undefined) {
    cuerpo.orden = orden;
  }
  return cuerpo;
}

/**
 * Dialogo de alta y edicion de talla (react-hook-form + Zod), replica del patron de
 * Cortador. Si recibe una `talla` edita (PATCH); si no, da de alta (POST). La
 * validacion de captura es solo UX: el backend re-valida y es la autoridad (A1).
 */
export function DialogoTalla({
  abierto,
  alCambiarAbierto,
  talla,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Talla a editar; `undefined` -> alta. */
  talla: Talla | undefined;
}): React.JSX.Element {
  const esEdicion = talla !== undefined;
  const crear = useCrearTalla();
  const actualizar = useActualizarTalla();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosTallaFormulario>({
    resolver: zodResolver(esquemaTallaFormulario),
    defaultValues: VALORES_INICIALES,
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset(
        talla ? { etiqueta: talla.etiqueta, orden: talla.orden.toString() } : VALORES_INICIALES,
      );
    }
  }, [abierto, talla, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    const cuerpo = aCuerpo(datos);
    if (esEdicion) {
      actualizar.mutate(
        { id: talla.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Talla "${resultado.etiqueta}" actualizada.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        toast.success(`Talla "${resultado.etiqueta}" creada.`);
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
            <DialogTitle>{esEdicion ? 'Editar talla' : 'Nueva talla'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia los datos de esta talla.'
                : 'Captura la etiqueta de la nueva talla (XCH, CH, M, 28, 30…).'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={Boolean(errors.etiqueta)}>
              <FieldLabel htmlFor="talla-etiqueta">Etiqueta</FieldLabel>
              <Input
                id="talla-etiqueta"
                autoFocus
                aria-invalid={Boolean(errors.etiqueta)}
                disabled={guardando}
                {...formulario.register('etiqueta')}
              />
              <FieldError errors={[errors.etiqueta]} />
            </Field>

            <Field data-invalid={Boolean(errors.orden)}>
              <FieldLabel htmlFor="talla-orden">Orden de despliegue</FieldLabel>
              <Input
                id="talla-orden"
                type="number"
                inputMode="numeric"
                min={0}
                step="1"
                placeholder="0"
                aria-invalid={Boolean(errors.orden)}
                disabled={guardando}
                {...formulario.register('orden')}
              />
              <FieldError errors={[errors.orden]} />
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
            <Button type="submit" disabled={guardando} data-testid="guardar-talla">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear talla'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
