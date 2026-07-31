import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useActualizarTipoProceso, useCrearTipoProceso } from '@/api/tipos-proceso';
import { type DatosTipoProcesoFormulario, esquemaTipoProcesoFormulario } from '@/api/esquemas';
import type { TipoProceso } from '@/api/tipos';
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

/**
 * Diálogo de alta/edición de tipo de proceso (react-hook-form + Zod). Si recibe un `tipo` edita
 * (PATCH); si no, da de alta (POST). El error del servidor (validación, conflicto de código,
 * permiso) se muestra como toast en español.
 *
 * La bandera **`generaEntradaPt`** (decisión (e)) solo la edita un ADMIN: si `puedeEditarBandera`
 * es falso, el control se DESHABILITA y se explica por qué. El backend es la autoridad (descarta
 * la bandera para no-admin aunque la UI fallara), A1/§9.2.
 */
export function DialogoTipoProceso({
  abierto,
  alCambiarAbierto,
  tipo,
  puedeEditarBandera,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Tipo a editar; `undefined` -> alta. */
  tipo: TipoProceso | undefined;
  /** ¿La sesión es admin y puede tocar `generaEntradaPt`? */
  puedeEditarBandera: boolean;
}): React.JSX.Element {
  const esEdicion = tipo !== undefined;
  const crear = useCrearTipoProceso();
  const actualizar = useActualizarTipoProceso();
  const guardando = crear.isPending || actualizar.isPending;

  const formulario = useForm<DatosTipoProcesoFormulario>({
    resolver: zodResolver(esquemaTipoProcesoFormulario),
    defaultValues: { codigo: '', nombre: '', generaEntradaPt: false },
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset(
        tipo
          ? { codigo: tipo.codigo, nombre: tipo.nombre, generaEntradaPt: tipo.generaEntradaPt }
          : { codigo: '', nombre: '', generaEntradaPt: false },
      );
    }
  }, [abierto, tipo, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    // Si NO es admin, no se manda `generaEntradaPt` (el backend igual lo descartaría): se respeta
    // el valor que ya tenía el registro y no se intenta cambiarlo desde una sesión sin permiso.
    const cuerpo = puedeEditarBandera ? datos : { codigo: datos.codigo, nombre: datos.nombre };

    if (esEdicion) {
      actualizar.mutate(
        { id: tipo.id, cuerpo },
        {
          onSuccess: (r) => {
            toast.success(`Tipo de proceso "${r.nombre}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crear.mutate(cuerpo, {
      onSuccess: (r) => {
        toast.success(`Tipo de proceso "${r.nombre}" creado.`);
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
              {esEdicion ? 'Editar tipo de proceso' : 'Nuevo tipo de proceso'}
            </DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el código, el nombre o si genera entrada a inventario PT.'
                : 'Captura los datos del nuevo tipo de proceso de maquila.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <LeyendaObligatorios />
            <Field data-invalid={Boolean(errors.codigo)}>
              <FieldLabel htmlFor="tp-codigo" required>
                Código
              </FieldLabel>
              <Input
                id="tp-codigo"
                autoFocus
                placeholder="costura"
                aria-invalid={Boolean(errors.codigo)}
                disabled={guardando}
                {...formulario.register('codigo')}
              />
              <FieldError errors={[errors.codigo]} />
            </Field>

            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="tp-nombre" required>
                Nombre
              </FieldLabel>
              <Input
                id="tp-nombre"
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            {/* Bandera generaEntradaPt — editable SOLO por admin (decisión (e)). */}
            <Field orientation="horizontal">
              <input
                id="tp-genera-entrada"
                type="checkbox"
                className="size-4 rounded border-input accent-primary disabled:opacity-50"
                disabled={guardando || !puedeEditarBandera}
                data-testid="tp-genera-entrada"
                {...formulario.register('generaEntradaPt')}
              />
              <FieldLabel htmlFor="tp-genera-entrada" className="font-normal">
                ¿Su recibo genera entrada a inventario de PT? (solo costura)
              </FieldLabel>
            </Field>
            {!puedeEditarBandera ? (
              <p className="-mt-2 text-xs text-muted-foreground">
                Solo un administrador puede cambiar si el proceso mete prenda a inventario PT.
              </p>
            ) : null}
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
              data-testid="guardar-tipo-proceso"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear tipo de proceso'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
