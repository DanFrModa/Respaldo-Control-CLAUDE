import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCancelarNota } from '@/api/notas-salida';
import type { NotaSalida } from '@/api/tipos';
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
 * Diálogo de CANCELACIÓN de una nota de salida (F4-E5): la cancelación es SUAVE (la nota se conserva
 * con badge "Cancelada") y EXIGE un motivo (lo re-valida el backend). Si la nota estaba confirmada,
 * el backend reversa los avíos que descontó (inverso auditado, D3); la tela nunca se toca. Requiere
 * `notas.cancelar`; el botón que lo abre se oculta sin ese permiso (A1).
 */
export function DialogoCancelarNota({
  abierto,
  alCambiarAbierto,
  nota,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  nota: NotaSalida | undefined;
}): React.JSX.Element {
  const cancelar = useCancelarNota();
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (abierto) {
      setMotivo('');
    }
  }, [abierto]);

  function confirmar(): void {
    if (nota === undefined) {
      return;
    }
    const limpio = motivo.trim();
    if (limpio.length === 0) {
      return;
    }
    cancelar.mutate(
      { id: nota.id, cuerpo: { motivo: limpio } },
      {
        onSuccess: () => {
          toast.success(`Nota de salida ${nota.numNota} cancelada.`);
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
          <DialogTitle>Cancelar nota de salida {nota?.numNota ?? ''}</DialogTitle>
          <DialogDescription>
            La nota se conserva (cancelación suave). Si estaba confirmada, los avíos descontados se
            regresan al inventario. Escribe el motivo.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field data-invalid={sinMotivo}>
            <FieldLabel htmlFor="nota-motivo-cancelar">Motivo</FieldLabel>
            <textarea
              id="nota-motivo-cancelar"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se cancela la nota de salida"
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              data-testid="nota-motivo-cancelar"
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
            data-testid="confirmar-cancelar-nota"
          >
            {cancelar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Cancelar nota
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
