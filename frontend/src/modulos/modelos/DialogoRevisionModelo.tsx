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
 * ⭐ V1-E7d — LA REVISIÓN DE LA RECETA NEGOCIADA (§Post-F9.110). Este diálogo es donde alguien con
 * «Aprobar receta» firma esa revisión —o la devuelve con observaciones—.
 *
 * Daniel: *"después de la negociación con el cliente, debe de haber una revisión antes de mandar a
 * producir. Porque luego en la negociación enfrente del cliente puede ser que se cometa una
 * imprudencia o un error"*.
 *
 * 🔴🔴 **V1-E9c (§Post-F9.169) — LO QUE ESTE DIÁLOGO DICE ES PARTE DE LA REGLA, NO ADORNO.** Daniel
 * disolvió la compuerta: *«Todo lo que no está firmado simplemente no se puede comprar. **Pero no
 * detiene ni la producción** ni los demás renglones ya firmados.»* Hasta esa decisión, el texto de
 * abajo prometía —con todas sus letras— que rechazar impedía producir y que aprobar *"deja la
 * versión lista para mandarse a producir"*. **Las dos frases ya son falsas**, y son las que la
 * persona lee **en el segundo en que decide**.
 *
 * 🔑 **Por qué esto es un defecto y no una imprecisión.** Quien revisa rechaza *confiando* en que
 * eso frena algo; la OP se genera igual esa misma tarde (lo prueba
 * `produccion/salida-produccion.test.ts`: *"una versión RECHAZADA también genera su OP"*). Un texto
 * que promete un freno que no existe es peor que no decir nada: sustituye una decisión real —ir a
 * frenar el gasto en la receta de la ORDEN, renglón por renglón— por una falsa sensación de haberla
 * tomado. Es la misma mentira que obligó a renombrar `revisionBloqueaProduccion`, sólo que aquí la
 * lee un usuario y no un programador.
 *
 * ⚠️ **Esta copia está aseverada palabra por palabra en `DialogoRevisionModelo.test.tsx`.** No es
 * celo: no había NINGUNA prueba sobre ella, y por eso pudo quedarse mintiendo veinte líneas debajo
 * de los toasts que sí se actualizaron.
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
              ? `Revisión de ${modelo.codigo} rechazada. Queda en «Recetas por revisar».`
              : `Revisión de ${modelo.codigo} aprobada.`,
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
                ? `La versión ${modelo.codigo} se devuelve con observaciones: se conserva, se ` +
                  `puede seguir corrigiendo y queda en «Recetas por revisar» hasta que se firme. ` +
                  `Ojo: rechazarla NO detiene su producción. El gasto se frena renglón por renglón ` +
                  `en la receta de la orden: lo que Desarrollo no libera, no se compra.`
                : `Queda constancia de que revisaste la receta de ${modelo.codigo}, con tu nombre ` +
                  `y la fecha. La firma no habilita ni bloquea nada por sí sola; si alguien le ` +
                  `mueve la receta después, se cae y vuelve a «Recetas por revisar».`}
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
