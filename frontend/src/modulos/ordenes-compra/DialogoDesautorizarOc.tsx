import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useDesautorizarOc } from '@/api/ordenes-compra';
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
 * Lo ÚNICO que este diálogo necesita saber de la OC: su id (para mandar la mutación) y su folio
 * (para nombrarla). Se pide así, y no como `OrdenCompra` entera, porque desde la fila 0.068 lo abren DOS
 * pantallas con dos formas distintas del mismo hecho: la de Órdenes de compra, que tiene la OC
 * completa, y el aviso de «ya está comprado» de la receta, que sólo tiene la `OcComprometida` que
 * le manda el servidor (`idOrdenCompra` + `folio`). Pedir el objeto entero habría obligado a
 * fabricar una OC de mentira para poder abrirlo —y una OC de mentira en un diálogo que quita firmas
 * es justo lo que no puede existir—. `OrdenCompra` sigue encajando aquí tal cual.
 */
export interface OcADesautorizar {
  id: number;
  /** El folio con el que la nombra todo el mundo. */
  numCompra: number;
}

/**
 * ⭐ Diálogo de DES-AUTORIZACIÓN de una orden de compra (V1-E3y, §Post-F9.79).
 *
 * Es la MARCHA ATRÁS de la firma de compra, y existe para que el bloqueo *"no se quita de la receta
 * lo ya comprado"* no sea una trampa sin salida. Quitar la firma es tan grave como cancelar, así que
 * exige MOTIVO (lo re-valida el backend) y deja bitácora.
 *
 * Requiere `compras.desautorizar` —la llave del perfil de dirección—; el botón que lo abre se oculta
 * sin ese permiso. ⚠️ **Ocultar el botón NO es la defensa**: la decisión real (permiso, estatus,
 * "una OC recibida no se des-autoriza") la toma el servidor (A1/A4).
 *
 * 🔴 **Y NO CANCELA NADA CON EL PROVEEDOR.** Quita el sello en el sistema y devuelve la OC a
 * borrador; lo de afuera —Daniel, §Post-F9.173(a): *"eso hay que negociarlo con el proveedor"*— no
 * lo hace ningún botón. Por eso este diálogo es el ÚNICO camino: exige que una persona escriba el
 * motivo y confirme.
 */
export function DialogoDesautorizarOc({
  abierto,
  alCambiarAbierto,
  oc,
  alDesautorizada,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  oc: OcADesautorizar | undefined;
  /**
   * ⭐ fila 0.068 — se avisa cuando la des-autorización SÍ ocurrió, para que el llamador refresque lo
   * suyo. Existe porque `useDesautorizarOc` sólo invalida el árbol de Órdenes de compra, y la receta
   * de la OP —que es quién pinta «Comprado · OC 12»— vive en otro (`['ordenes','receta',id]`). Sin
   * esto, quien des-autoriza desde el aviso se queda mirando un chip que ya no es verdad y un botón
   * que lo mandaría a un 409. `alCambiarAbierto(false)` NO sirve para lo mismo: también se dispara
   * al cancelar.
   */
  alDesautorizada?: (() => void) | undefined;
}): React.JSX.Element {
  const desautorizar = useDesautorizarOc();
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
    desautorizar.mutate(
      { id: oc.id, cuerpo: { motivo: limpio } },
      {
        onSuccess: () => {
          toast.success(
            `Orden de compra ${oc.numCompra} des-autorizada: vuelve a borrador y se puede corregir.`,
          );
          alDesautorizada?.();
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
          <DialogTitle>Des-autorizar orden de compra {oc?.numCompra ?? ''}</DialogTitle>
          <DialogDescription>
            Se le quita la autorización y la OC vuelve a <strong>borrador</strong>: se puede
            corregir y volver a autorizar, y lo que se compró con ella deja de bloquear la receta de
            la orden de producción. Escribe el motivo.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field data-invalid={sinMotivo}>
            <FieldLabel htmlFor="oc-motivo-desautorizar">Motivo</FieldLabel>
            <textarea
              id="oc-motivo-desautorizar"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se le quita la autorización"
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              data-testid="oc-motivo-desautorizar"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={desautorizar.isPending}
          >
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirmar}
            disabled={desautorizar.isPending || sinMotivo}
            data-testid="confirmar-desautorizar-oc"
          >
            {desautorizar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Des-autorizar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
