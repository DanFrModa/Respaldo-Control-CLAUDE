import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { useEditarFactoresLista, type ListaDetalle } from '@/api/listas-precios';
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

const porcentaje = z
  .number({ error: 'Captura un número' })
  .min(0, { error: 'No puede ser negativo' })
  .max(100, { error: 'No puede pasar de 100' });

const esquema = z.object({
  margenPct: porcentaje.max(99.99, { error: 'El margen debe ser menor a 100' }),
  descuentosPct: porcentaje,
  regaliasPct: porcentaje,
  costoVentasPct: porcentaje,
});

type DatosFactores = z.infer<typeof esquema>;

/**
 * Diálogo para EDITAR el snapshot de factores de una lista (F8-E4): recalcula el precio calculado de
 * TODOS los renglones, sin tocar los aprobados. Confirma con el mensaje de recálculo.
 */
export function DialogoEditarFactoresLista({
  abierto,
  alCambiarAbierto,
  lista,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  lista: ListaDetalle;
}): React.JSX.Element {
  const editar = useEditarFactoresLista();
  const formulario = useForm<DatosFactores>({
    resolver: zodResolver(esquema),
    defaultValues: {
      margenPct: lista.margenPct ?? 0,
      descuentosPct: lista.descuentosPct ?? 0,
      regaliasPct: lista.regaliasPct ?? 0,
      costoVentasPct: lista.costoVentasPct ?? 0,
    },
  });

  useEffect(() => {
    if (abierto) {
      formulario.reset({
        margenPct: lista.margenPct ?? 0,
        descuentosPct: lista.descuentosPct ?? 0,
        regaliasPct: lista.regaliasPct ?? 0,
        costoVentasPct: lista.costoVentasPct ?? 0,
      });
    }
  }, [abierto, lista, formulario]);

  const { errors } = formulario.formState;
  const campos: { nombre: keyof DatosFactores; etiqueta: string }[] = [
    { nombre: 'margenPct', etiqueta: 'Margen %' },
    { nombre: 'descuentosPct', etiqueta: 'Descuentos %' },
    { nombre: 'regaliasPct', etiqueta: 'Regalías %' },
    { nombre: 'costoVentasPct', etiqueta: 'Costo de ventas %' },
  ];

  const enviar = formulario.handleSubmit((datos) => {
    editar.mutate(
      { id: lista.id, cuerpo: datos },
      {
        onSuccess: () => {
          toast.success('Factores actualizados; se recalcularon los precios.');
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  });

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>Editar factores de la lista #{lista.folio}</DialogTitle>
            <DialogDescription>
              Cambiar los factores recalcula el precio calculado de todos los renglones. Los precios
              ya aprobados NO se tocan.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <FieldGroup className="grid grid-cols-2 gap-3">
              {campos.map((campo) => (
                <Field key={campo.nombre} data-invalid={Boolean(errors[campo.nombre])}>
                  <FieldLabel htmlFor={`lista-factor-${campo.nombre}`}>{campo.etiqueta}</FieldLabel>
                  <Input
                    id={`lista-factor-${campo.nombre}`}
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    aria-invalid={Boolean(errors[campo.nombre])}
                    disabled={editar.isPending}
                    {...formulario.register(campo.nombre, { valueAsNumber: true })}
                  />
                  <FieldError errors={[errors[campo.nombre]]} />
                </Field>
              ))}
            </FieldGroup>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => alCambiarAbierto(false)}
              disabled={editar.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={editar.isPending} data-testid="guardar-factores-lista">
              {editar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Recalcular
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
