import { Loader2Icon, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCancelarPedido } from '@/api/pedidos';
import type { Pedido } from '@/api/tipos';
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
import { Input } from '@/components/ui/input';
import { useSesion } from '@/sesion/useSesion';

/**
 * ⭐ DIÁLOGO DE CANCELAR PEDIDO (V1-E4 punto 5) — el que dejó de mentir.
 *
 * El texto de antes decía literalmente que el pedido *"deja de producirse"*, y era falso: cancelar
 * solo marcaba el pedido; sus OPs seguían vivas en Órdenes, en el WIP y en el MRP, y se seguían
 * cortando. Nadie lo nota probando a mano — la cancelación "funciona"—, hasta que alguien corta un
 * pedido cancelado.
 *
 * Aquí la promesa se cumple o no se hace:
 *  • sin marcar la casilla, el backend RECHAZA el pedido con OPs vivas y las nombra (el error se
 *    muestra tal cual: dice cuántas son y con qué folio);
 *  • marcándola (+ motivo, obligatorio para cancelar cualquier orden) se cancelan también sus OPs,
 *    en la MISMA transacción.
 *
 * La casilla solo se ofrece con `ordenes.cancelar` — el mismo permiso que cancelar una OP a mano.
 * El backend re-decide de todos modos (A1): esto es cortesía de UI, no la barrera.
 */
export function DialogoCancelarPedido({
  pedido,
  alCambiarAbierto,
  alCancelado,
}: {
  /** Pedido a cancelar; `null` = diálogo cerrado. */
  pedido: Pedido | null;
  alCambiarAbierto: (abierto: boolean) => void;
  alCancelado?: () => void;
}): React.JSX.Element {
  const cancelar = useCancelarPedido();
  const { tienePermiso } = useSesion();
  const puedeCancelarOrdenes = tienePermiso('ordenes.cancelar');

  const [tambienOrdenes, setTambienOrdenes] = useState(false);
  const [motivo, setMotivo] = useState('');

  // Cada apertura arranca limpia (que no se herede el motivo del pedido anterior).
  useEffect(() => {
    if (pedido !== null) {
      setTambienOrdenes(false);
      setMotivo('');
    }
  }, [pedido]);

  const motivoRequerido = tambienOrdenes && motivo.trim() === '';

  function confirmar(): void {
    if (pedido === null || motivoRequerido) {
      return;
    }
    cancelar.mutate(
      {
        id: pedido.id,
        cuerpo: {
          ...(tambienOrdenes ? { cancelarOrdenes: true } : {}),
          ...(motivo.trim() === '' ? {} : { motivo: motivo.trim() }),
        },
      },
      {
        onSuccess: () => {
          toast.success(
            tambienOrdenes
              ? `Pedido ${String(pedido.folio)} cancelado junto con sus órdenes de producción.`
              : `Pedido ${String(pedido.folio)} cancelado.`,
          );
          alCambiarAbierto(false);
          alCancelado?.();
        },
        // El mensaje del backend NOMBRA las OPs vivas: se muestra tal cual, no se resume.
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={pedido !== null} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg" data-testid="dialogo-cancelar-pedido">
        <DialogHeader>
          <DialogTitle>Cancelar pedido</DialogTitle>
          <DialogDescription>
            El pedido {pedido?.folio} se conserva (cancelación suave) y deja de aparecer en la
            lista.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* §Post-F9.68 — esconder, no negar: sin `ordenes.cancelar` la casilla
              NO existe (no deshabilitada) y NO se dice por qué. El aviso también
              cambia: sin la casilla no puede mandar a «márcalas abajo». */}
          <p className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            <span>
              <b>Cancelar el pedido NO detiene sus órdenes de producción.</b> Si ya tiene OPs vivas,
              seguirían cortándose:{' '}
              {puedeCancelarOrdenes
                ? 'márcalas abajo para cancelarlas también, o cancélalas una por una desde Órdenes.'
                : 'hay que cancelarlas una por una desde Órdenes.'}
            </span>
          </p>

          {puedeCancelarOrdenes ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={tambienOrdenes}
                onChange={(e) => setTambienOrdenes(e.target.checked)}
                data-testid="cancelar-tambien-ordenes"
              />
              <span>
                Cancelar <b>también sus órdenes de producción</b>
              </span>
            </label>
          ) : null}

          <Field>
            <FieldLabel htmlFor="cancelar-pedido-motivo" required={tambienOrdenes}>
              Motivo
            </FieldLabel>
            <Input
              id="cancelar-pedido-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={tambienOrdenes ? 'Obligatorio: queda en cada OP cancelada' : 'Opcional'}
              aria-invalid={motivoRequerido}
              data-testid="cancelar-pedido-motivo"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={cancelar.isPending}
          >
            Volver
          </Button>
          <Button
            variant="destructive"
            onClick={confirmar}
            disabled={cancelar.isPending || motivoRequerido}
            data-testid="confirmar-cancelar-pedido"
          >
            {cancelar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Cancelar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
