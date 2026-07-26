import { Loader2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Dialogo de confirmacion reutilizable para acciones delicadas (desactivar,
 * etc.). Componente generico del patron CRUD: el llamador decide el texto, el
 * estilo del boton de accion y que ocurre al confirmar.
 *
 * `accionSecundaria` (opcional) agrega una TERCERA salida entre cancelar y
 * confirmar, para las decisiones de tres caminos — p. ej. el guardia de cierre
 * del dialogo de una orden: Cancelar / Salir sin guardar / Guardar y salir.
 */
export function DialogoConfirmacion({
  abierto,
  alCambiarAbierto,
  titulo,
  descripcion,
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  variante = 'default',
  procesando = false,
  accionSecundaria,
  alConfirmar,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  titulo: string;
  descripcion: React.ReactNode;
  textoConfirmar?: string;
  textoCancelar?: string;
  variante?: 'default' | 'destructive';
  procesando?: boolean;
  /** Tercera salida opcional (ni cancelar ni confirmar). */
  accionSecundaria?: { texto: string; alAccionar: () => void; testid?: string };
  alConfirmar: () => void;
}): React.JSX.Element {
  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={procesando}
          >
            {textoCancelar}
          </Button>
          {accionSecundaria !== undefined ? (
            <Button
              type="button"
              variant="secondary"
              onClick={accionSecundaria.alAccionar}
              disabled={procesando}
              data-testid={accionSecundaria.testid ?? 'accion-secundaria'}
            >
              {accionSecundaria.texto}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={variante}
            onClick={alConfirmar}
            disabled={procesando}
            data-testid="confirmar-accion"
          >
            {procesando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            {textoConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
