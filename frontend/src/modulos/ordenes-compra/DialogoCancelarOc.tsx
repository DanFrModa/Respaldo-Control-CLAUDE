import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCancelarOc } from '@/api/ordenes-compra';
import type { OrdenCompra } from '@/api/tipos';
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
 * Diálogo de CANCELACIÓN de una orden de compra (F4-E2): la cancelación es SUAVE (la OC se conserva
 * con badge "Cancelada") y EXIGE un motivo (lo re-valida el backend). Requiere `compras.cancelar`;
 * el botón que lo abre se oculta sin ese permiso (A1).
 */
export function DialogoCancelarOc({
  abierto,
  alCambiarAbierto,
  oc,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  oc: OrdenCompra | undefined;
}): React.JSX.Element {
  const cancelar = useCancelarOc();
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (abierto) {
      setMotivo('');
    }
  }, [abierto]);

  function confirmar(): void {
    if (oc === undefined) {
      return;
    }
    const limpio = motivo.trim();
    if (limpio.length === 0) {
      return;
    }
    cancelar.mutate(
      { id: oc.id, cuerpo: { motivo: limpio } },
      {
        onSuccess: () => {
          toast.success(`Orden de compra ${oc.numCompra} cancelada.`);
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const sinMotivo = motivo.trim().length === 0;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar orden de compra {oc?.numCompra ?? ''}</DialogTitle>
          <DialogDescription>
            La OC se conserva (cancelación suave) pero deja de surtirse. Escribe el motivo.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field data-invalid={sinMotivo}>
            <FieldLabel htmlFor="oc-motivo-cancelar">Motivo</FieldLabel>
            <textarea
              id="oc-motivo-cancelar"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se cancela la orden de compra"
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              data-testid="oc-motivo-cancelar"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={cancelar.isPending}
          >
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirmar}
            disabled={cancelar.isPending || sinMotivo}
            data-testid="confirmar-cancelar-oc"
          >
            {cancelar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Cancelar OC
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
