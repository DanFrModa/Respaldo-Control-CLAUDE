import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCancelarAuditoria } from '@/api/calidad';
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
 * Diálogo para CANCELAR una auditoría (F6-E3): borrado SUAVE con motivo obligatorio. El motivo queda
 * en la bitácora y anexado a las observaciones; cancelar des-completa el proceso `auditoria` de la
 * Ruta Crítica (lo hace el backend). Gobernado por `calidad.modificar-auditorias`.
 */
export function DialogoCancelarAuditoria({
  idAuditoria,
  numAuditoria,
  abierto,
  alCambiarAbierto,
}: {
  idAuditoria: number | undefined;
  numAuditoria: number | undefined;
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
}): React.JSX.Element {
  const cancelar = useCancelarAuditoria();
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (abierto) {
      setMotivo('');
    }
  }, [abierto]);

  function confirmar(): void {
    if (idAuditoria === undefined) return;
    const texto = motivo.trim();
    if (texto === '') {
      toast.error('Captura el motivo de la cancelación.');
      return;
    }
    cancelar.mutate(
      { id: idAuditoria, cuerpo: { motivo: texto } },
      {
        onSuccess: (a) => {
          toast.success(`Auditoría #${a.numAuditoria} cancelada.`);
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Cancelar auditoría{numAuditoria !== undefined ? ` #${numAuditoria}` : ''}
          </DialogTitle>
          <DialogDescription>
            La auditoría se marca como cancelada (no se borra). El motivo queda registrado.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Field>
            <FieldLabel htmlFor="cancelar-motivo">Motivo de la cancelación</FieldLabel>
            <textarea
              id="cancelar-motivo"
              rows={3}
              maxLength={500}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Explica por qué se cancela esta auditoría"
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              data-testid="cancelar-motivo"
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
            Cerrar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirmar}
            disabled={cancelar.isPending}
            data-testid="cancelar-confirmar"
          >
            {cancelar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Cancelar auditoría
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
