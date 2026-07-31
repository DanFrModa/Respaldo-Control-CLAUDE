import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useApagarDesarrollo, type Desarrollo } from '@/api/desarrollos';
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
 * Diálogo para APAGAR un desarrollo (F8-E2): borrado SUAVE con motivo OBLIGATORIO (el desarrollo se
 * conserva y se puede reactivar; NUNCA se borra). El motivo lo re-valida el backend. Requiere
 * `desarrollo.administrar`; el botón que lo abre se oculta sin ese permiso.
 */
export function DialogoApagarDesarrollo({
  abierto,
  alCambiarAbierto,
  desarrollo,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  desarrollo: Desarrollo | undefined;
}): React.JSX.Element {
  const apagar = useApagarDesarrollo();
  const [motivo, setMotivo] = useState('');
  // "touched": sólo se marca el campo como inválido una vez que el usuario intentó enviar sin
  // motivo (no desde que abre vacío). Se resetea al abrir/cerrar.
  const [intentado, setIntentado] = useState(false);

  useEffect(() => {
    if (abierto) {
      setMotivo('');
      setIntentado(false);
    }
  }, [abierto]);

  function confirmar(): void {
    if (desarrollo === undefined) {
      return;
    }
    const limpio = motivo.trim();
    if (limpio.length === 0) {
      setIntentado(true);
      return;
    }
    apagar.mutate(
      { id: desarrollo.id, cuerpo: { motivo: limpio } },
      {
        onSuccess: () => {
          toast.success(`Desarrollo "${desarrollo.codigoModelo}" apagado.`);
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
          <DialogTitle>Apagar desarrollo {desarrollo?.codigoModelo ?? ''}</DialogTitle>
          <DialogDescription>
            El desarrollo se conserva (borrado suave) y se puede reactivar. Escribe el motivo.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field data-invalid={intentado && sinMotivo}>
            <FieldLabel htmlFor="desarrollo-motivo-apagar">Motivo</FieldLabel>
            <textarea
              id="desarrollo-motivo-apagar"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se apaga el desarrollo"
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              data-testid="desarrollo-motivo-apagar"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={apagar.isPending}
          >
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirmar}
            disabled={apagar.isPending || sinMotivo}
            data-testid="confirmar-apagar-desarrollo"
          >
            {apagar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Apagar desarrollo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
