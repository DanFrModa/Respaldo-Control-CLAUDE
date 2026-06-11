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
