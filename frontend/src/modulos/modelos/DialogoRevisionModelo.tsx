import { CheckIcon, Loader2Icon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useAprobarRevisionModelo, useRechazarRevisionModelo, type Modelo } from '@/api/modelos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';

/**
 * ⭐ V1-E7d — LA REVISIÓN DE LA RECETA ANTES DE MANDAR A PRODUCIR (§Post-F9.110).
 *
 * Daniel: *"después de la negociación con el cliente, debe de haber una revisión antes de mandar a
 * producir. Porque luego en la negociación enfrente del cliente puede ser que se cometa una
 * imprudencia o un error"*. Este diálogo es donde alguien con «Aprobar receta» firma esa revisión
 * —o la devuelve con observaciones—.
 *
 * ⚠️ **Esta pantalla no protege nada, y no pretende hacerlo.** Quien impide producir una versión
 * sin revisar es el BACKEND, dentro de `promoverAProduccionNucleo`: desde ahí cierra las DOS
 * puertas —«pasar a producción» y **generar la OP**— y no sólo el botón que se ve. Aquí sólo se
 * captura la firma y se enseña cómo quedó (A1).
 *
 * `aprobar` lleva nota OPCIONAL; `rechazar` exige MOTIVO (el backend lo vuelve a exigir).
 */
export function DialogoRevisionModelo({
  abierto,
  alCambiarAbierto,
  modelo,
  accion,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  modelo: Modelo | null;
  accion: 'aprobar' | 'rechazar';
}): React.JSX.Element {
  const aprobar = useAprobarRevisionModelo();
  const rechazar = useRechazarRevisionModelo();
  const [texto, setTexto] = useState('');

  useEffect(() => {
    if (abierto) {
      setTexto('');
    }
  }, [abierto, accion]);

  const esRechazo = accion === 'rechazar';
  const mutacion = esRechazo ? rechazar : aprobar;
  const faltaMotivo = esRechazo && texto.trim().length === 0;

  function confirmar(): void {
    if (modelo === null || faltaMotivo) {
      return;
    }
    mutacion.mutate(
      { id: modelo.id, texto: texto.trim() },
      {
        onSuccess: () => {
          toast.success(
            esRechazo
              ? `Revisión de ${modelo.codigo} rechazada. No puede mandarse a producir.`
              : `Revisión de ${modelo.codigo} aprobada. Ya puede mandarse a producir.`,
          );
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-md" data-testid="dialogo-revision-modelo">
        <DialogHeader>
          <DialogTitle>{esRechazo ? 'Rechazar la revisión' : 'Aprobar la revisión'}</DialogTitle>
          <DialogDescription>
            {modelo === null
              ? ''
              : esRechazo
                ? `La versión ${modelo.codigo} se devuelve con observaciones: se conserva y se ` +
                  `puede seguir corrigiendo, pero no podrá mandarse a producir.`
                : `Con tu firma, la versión ${modelo.codigo} queda lista para mandarse a ` +
                  `producir — por «Pasar a producción» o al generarle su orden.`}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field data-invalid={faltaMotivo}>
            <FieldLabel htmlFor="modelo-revision-texto" required={esRechazo}>
              {esRechazo ? 'Motivo' : 'Nota (opcional)'}
            </FieldLabel>
            <textarea
              id="modelo-revision-texto"
              rows={3}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              maxLength={500}
              placeholder={
                esRechazo
                  ? 'Qué se observó en la receta y hay que corregir'
                  : 'Algo que quede anotado de esta revisión'
              }
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              data-testid="modelo-revision-texto"
            />
            <FieldDescription>
              {esRechazo
                ? 'Sin motivo, quien tiene que corregir la receta no sabe qué se observó.'
                : 'Queda guardado con tu nombre y la fecha.'}
            </FieldDescription>
          </Field>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={mutacion.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant={esRechazo ? 'destructive' : 'default'}
            onClick={confirmar}
            disabled={mutacion.isPending || faltaMotivo}
            data-testid="confirmar-revision-modelo"
          >
            {mutacion.isPending ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : esRechazo ? (
              <XIcon aria-hidden />
            ) : (
              <CheckIcon aria-hidden />
            )}
            {esRechazo ? 'Rechazar' : 'Aprobar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
