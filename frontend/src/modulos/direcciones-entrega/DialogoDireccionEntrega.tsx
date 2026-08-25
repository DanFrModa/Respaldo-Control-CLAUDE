import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useActualizarDireccionEntrega, useCrearDireccionEntrega } from '@/api/direcciones-entrega';
import {
  esquemaDireccionEntregaFormulario,
  type DatosDireccionEntregaFormulario,
} from '@/api/esquemas';
import type { DireccionEntrega } from '@/api/tipos';
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
  FieldError,
  FieldGroup,
  FieldLabel,
  LeyendaObligatorios,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/** Valores iniciales de un alta. */
const VACIO: DatosDireccionEntregaFormulario = {
  nombre: '',
  direccion: '',
  contacto: '',
  telefono: '',
  favorita: false,
};

/**
 * Diálogo de alta/edición de una DIRECCIÓN DE ENTREGA (§Post-F9.18), calcado del patrón de
 * Temporadas (react-hook-form + Zod). La validación de captura es solo UX: el backend re-valida y
 * es la autoridad (A1).
 */
export function DialogoDireccionEntrega({
  abierto,
  alCambiarAbierto,
  direccion,
  alCrear,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Dirección a editar; `undefined` → alta. */
  direccion: DireccionEntrega | undefined;
  /**
   * ⭐ **V1-E4d (§Post-F9.96)** — se avisa al llamador con la dirección RECIÉN CREADA. Lo estrenó
   * la explosión de materiales, que da de alta la primera dirección sin salir de la compra y
   * necesita **elegirla** ahí mismo: quien la acaba de capturar para esta OC ya dijo cuál quiere,
   * y volver a pedírsela en un select sería preguntar dos veces lo mismo.
   *
   * Opcional: el catálogo no lo pasa y se comporta exactamente igual que antes. Sólo se llama al
   * CREAR (nunca al editar): en una edición no hay nada nuevo que el llamador deba adoptar.
   */
  alCrear?: (direccion: DireccionEntrega) => void;
}): React.JSX.Element {
  const esEdicion = direccion !== undefined;
  const crear = useCrearDireccionEntrega();
  const actualizar = useActualizarDireccionEntrega();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosDireccionEntregaFormulario>({
    resolver: zodResolver(esquemaDireccionEntregaFormulario),
    defaultValues: VACIO,
  });

  useEffect(() => {
    if (!abierto) {
      return;
    }
    formulario.reset(
      direccion
        ? {
            nombre: direccion.nombre,
            direccion: direccion.direccion,
            contacto: direccion.contacto ?? '',
            telefono: direccion.telefono ?? '',
            favorita: direccion.favorita,
          }
        : VACIO,
    );
  }, [abierto, direccion, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    // Los opcionales vacíos viajan como `null` (vaciar), no como cadena vacía.
    const cuerpo = {
      nombre: datos.nombre,
      direccion: datos.direccion,
      contacto: datos.contacto.trim() === '' ? null : datos.contacto,
      telefono: datos.telefono.trim() === '' ? null : datos.telefono,
      favorita: datos.favorita,
    };
    if (esEdicion) {
      actualizar.mutate(
        { id: direccion.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Dirección "${resultado.nombre}" actualizada.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        toast.success(`Dirección "${resultado.nombre}" creada.`);
        alCrear?.(resultado);
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
              {esEdicion ? 'Editar dirección de entrega' : 'Nueva dirección de entrega'}
            </DialogTitle>
            <DialogDescription>
              El nombre corto es con el que la eliges en la orden de compra; la dirección completa
              es la que sale impresa.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <LeyendaObligatorios />
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="direccion-nombre" required>
                Nombre corto
              </FieldLabel>
              <Input
                id="direccion-nombre"
                autoFocus
                placeholder="Ej. Naucalpan"
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field data-invalid={Boolean(errors.direccion)}>
              <FieldLabel htmlFor="direccion-direccion" required>
                Dirección completa
              </FieldLabel>
              <textarea
                id="direccion-direccion"
                rows={3}
                placeholder="Calle, número, colonia, municipio, estado, C.P."
                aria-invalid={Boolean(errors.direccion)}
                disabled={guardando}
                className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
                {...formulario.register('direccion')}
              />
              <FieldError errors={[errors.direccion]} />
            </Field>

            <Field data-invalid={Boolean(errors.contacto)}>
              <FieldLabel htmlFor="direccion-contacto">Contacto</FieldLabel>
              <Input
                id="direccion-contacto"
                placeholder="A quién buscar"
                disabled={guardando}
                {...formulario.register('contacto')}
              />
              <FieldError errors={[errors.contacto]} />
            </Field>

            <Field data-invalid={Boolean(errors.telefono)}>
              <FieldLabel htmlFor="direccion-telefono">Teléfono</FieldLabel>
              <Input
                id="direccion-telefono"
                placeholder="Teléfono de contacto"
                disabled={guardando}
                {...formulario.register('telefono')}
              />
              <FieldError errors={[errors.telefono]} />
            </Field>

            <Field orientation="horizontal">
              <input
                id="direccion-favorita"
                type="checkbox"
                className="size-4 rounded border-input accent-primary"
                disabled={guardando}
                {...formulario.register('favorita')}
                data-testid="direccion-favorita"
              />
              <FieldLabel htmlFor="direccion-favorita" className="font-normal">
                Es la de siempre (se preselecciona al capturar una orden de compra)
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
            <Button
              type="submit"
              disabled={guardando}
              data-testid="guardar-direccion-entrega"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear dirección'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
