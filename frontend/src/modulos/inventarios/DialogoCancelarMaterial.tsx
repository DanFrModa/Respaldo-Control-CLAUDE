import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';

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
 * Diálogo de CANCELACIÓN de un movimiento de material (motivo obligatorio, A7). Compartido por el
 * kardex de materiales del flujo por lote (`KardexMaterialesPagina`) y el kardex por COLOR del
 * inventario nuevo (`ExistenciasTelasColorPagina`, etapa A2): la cancelación es el MISMO contrato
 * en ambos flujos — un movimiento INVERSO auditado que neutraliza el efecto, nunca un borrado (D3).
 */
export function DialogoCancelarMaterial({
  abierto,
  folio,
  cargando,
  alCerrar,
  alConfirmar,
}: {
  abierto: boolean;
  folio: number | null;
  cargando: boolean;
  alCerrar: () => void;
  alConfirmar: (motivo: string) => void;
}): React.JSX.Element {
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (abierto) setMotivo('');
  }, [abierto]);

  const sinMotivo = motivo.trim().length < 3;

  return (
    <Dialog open={abierto} onOpenChange={(o) => (o ? undefined : alCerrar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar movimiento {folio !== null ? `#${folio}` : ''}</DialogTitle>
          <DialogDescription>
            La cancelación NO borra el movimiento: registra un movimiento INVERSO auditado que
            neutraliza su efecto en la existencia. Escribe el motivo.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field data-invalid={sinMotivo}>
            <FieldLabel htmlFor="mat-motivo-cancelar">Motivo</FieldLabel>
            <textarea
              id="mat-motivo-cancelar"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se cancela este movimiento (mínimo 3 caracteres)"
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              data-testid="mat-motivo-cancelar"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={alCerrar} disabled={cargando}>
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => alConfirmar(motivo.trim())}
            disabled={cargando || sinMotivo}
            data-testid="confirmar-cancelar-material"
          >
            {cargando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Cancelar movimiento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
