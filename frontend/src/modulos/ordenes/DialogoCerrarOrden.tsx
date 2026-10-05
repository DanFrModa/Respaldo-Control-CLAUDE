import { AlertTriangle, Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCerrarOrden, usePreviaCierreOrden, useReabrirOrden } from '@/api/ordenes';
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
  /**
   * ⭐ 0.226b (C8 de §Post-F9.261, default del lead pendiente de Daniel): ANTES de cerrar se avisa si
   * todavía queda PRODUCTO TERMINADO de la orden. Cerrada, esas piezas ya no se mueven a mano, no se
   * traspasan ni se reclasifican (sólo el conteo cíclico o reabrir), así que conviene moverlas antes.
   * NO bloquea: cerrar con piezas puede ser legítimo. Lo cuenta el servidor (suma directa, D3).
   */
  const previa = usePreviaCierreOrden(orden?.id, abierto && esCerrar);
  const piezasPt = esCerrar ? (previa.data?.piezasPt ?? 0) : 0;
  // El aviso C8 tiene que poder LLEGAR antes de cerrar: mientras la previa va en camino, «Cerrar»
  // espera (si no, se podría cerrar sin haberlo visto). Si la previa FALLA se dice y se deja cerrar:
  // C8 avisa, no bloquea.
  const esperandoPrevia = esCerrar && previa.isPending && !previa.isError;
  const previaFallo = esCerrar && previa.isError;
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

        {previaFallo ? (
          <p
            className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft p-3 text-sm"
            role="status"
            data-testid="aviso-cierre-pt-error"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            No se pudo revisar si queda producto terminado de esta orden. Puedes cerrarla de todos
            modos.
          </p>
        ) : null}
        {piezasPt > 0 && previa.data !== undefined ? (
          <div
            className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft p-3 text-sm"
            role="status"
            data-testid="aviso-cierre-pt"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              Todavía quedan <b>{piezasPt.toLocaleString('es-MX')} pzas</b> de producto terminado de
              esta orden (
              {previa.data.porAlmacen
                .map((a) => `${a.almacen}: ${a.piezas.toLocaleString('es-MX')}`)
                .join(' · ')}
              ). Cerrada, ya no se podrán mover, traspasar ni reclasificar; si hay que moverlas,
              hazlo antes de cerrar. Puedes cerrarla de todos modos.
            </p>
          </div>
        ) : null}

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
            disabled={enCurso || faltaMotivo || esperandoPrevia}
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
