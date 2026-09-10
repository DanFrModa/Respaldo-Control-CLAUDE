import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCerrarOrden, useReabrirOrden } from '@/api/ordenes';
import type { Orden } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';

/**
 * ⭐⭐ Diálogo de CERRAR / REABRIR una orden (0.061 — §Post-F9.154(c)).
 *
 * Es un solo componente para los dos actos porque son el mismo acto en dos direcciones, y tenerlos
 * juntos evita que la confirmación de uno diga algo distinta de la del otro.
 *
 * LA CONFIRMACIÓN DICE QUÉ IMPLICA, que es el punto: cerrar no es "archivar", es **congelar el
 * costo y cerrar la captura**. Si el usuario no lo sabe antes de apretar, se entera cuando el piso
 * no pueda capturar un recibo.
 *
 * El motivo sigue la misma asimetría que el backend: OPCIONAL al cerrar (es el final normal de una
 * orden) y OBLIGATORIO al reabrir (es la excepción, y se justifica). El backend lo re-valida (A1);
 * aquí sólo se deshabilita el botón para no mandar algo que va a rebotar.
 *
 * El permiso `ordenes.cerrar` lo comprueba quien monta este diálogo (y lo decide el backend).
 */
export function DialogoCerrarOrden({
  abierto,
  alCambiarAbierto,
  orden,
  modo,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  orden: Orden | undefined;
  /** `cerrar` congela el costo; `reabrir` lo devuelve a cálculo vivo (acto inverso, D3). */
  modo: 'cerrar' | 'reabrir';
}): React.JSX.Element {
  const cerrar = useCerrarOrden();
  const reabrir = useReabrirOrden();
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (abierto) {
      setMotivo('');
    }
  }, [abierto]);

  const esCerrar = modo === 'cerrar';
  const enCurso = esCerrar ? cerrar.isPending : reabrir.isPending;
  // Al cerrar el motivo es opcional; al reabrir es obligatorio (misma regla que el backend).
  const faltaMotivo = !esCerrar && motivo.trim().length === 0;

  function confirmar(): void {
    if (orden === undefined || faltaMotivo) {
      return;
    }
    const limpio = motivo.trim();
    if (esCerrar) {
      cerrar.mutate(
        { id: orden.id, cuerpo: limpio.length === 0 ? {} : { motivo: limpio } },
        {
          onSuccess: () => {
            toast.success(`Orden ${orden.folio} cerrada. Su costo quedó congelado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    reabrir.mutate(
      { id: orden.id, cuerpo: { motivo: limpio } },
      {
        onSuccess: () => {
          toast.success(`Orden ${orden.folio} reabierta. Su costo vuelve a calcularse en vivo.`);
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {esCerrar ? 'Cerrar' : 'Reabrir'} orden {orden?.folio ?? ''}
          </DialogTitle>
          <DialogDescription>
            {esCerrar ? (
              <>
                La orden dejará de admitir captura —corte, envío, recibo, empaque, entrega, cierres
                con maquileros y su costo— y su <b>costo por prenda queda congelado</b> con las
                piezas que tiene hoy. Se puede seguir consultando e imprimiendo. Es reversible:
                reabrirla queda auditado.
              </>
            ) : (
              <>
                La orden volverá a admitir captura y su{' '}
                <b>costo por prenda se recalculará en vivo</b>. Lo que se congeló al cerrarla queda
                guardado como historia. Escribe el motivo.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field data-invalid={faltaMotivo}>
            <FieldLabel htmlFor="orden-motivo-cierre">
              Motivo {esCerrar ? '(opcional)' : ''}
            </FieldLabel>
            <textarea
              id="orden-motivo-cierre"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={esCerrar ? 'Por qué se cierra la orden' : 'Por qué hay que reabrirla'}
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              data-testid="orden-motivo-cierre"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={enCurso}
          >
            Volver
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={enCurso || faltaMotivo}
            data-testid={esCerrar ? 'confirmar-cerrar-orden' : 'confirmar-reabrir-orden'}
          >
            {enCurso ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            {esCerrar ? 'Cerrar orden' : 'Reabrir orden'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
