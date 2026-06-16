import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCopiarPedido } from '@/api/pedidos';
import type { Pedido } from '@/api/tipos';
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
 * Diálogo de COPIAR un pedido (doc 02 §4.3): reemplaza el MsgBox renglón-por-renglón del viejo
 * por una SELECCIÓN MÚLTIPLE en un clic. El usuario marca/desmarca los renglones a copiar (todos
 * por defecto) y confirma; el backend crea un pedido nuevo con folio nuevo y solo esos renglones.
 */
export function DialogoCopiarPedido({
  abierto,
  alCambiarAbierto,
  pedido,
  alCopiado,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  pedido: Pedido | undefined;
  /** Callback con el id del pedido nuevo (para seleccionarlo en la lista). */
  alCopiado?: (idNuevo: number) => void;
}): React.JSX.Element {
  const copiar = useCopiarPedido();
  // Set de ids de renglón seleccionados; arranca con TODOS marcados.
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (abierto && pedido) {
      setSeleccion(new Set(pedido.lineas.map((l) => l.id)));
    }
  }, [abierto, pedido]);

  function alternar(id: number): void {
    setSeleccion((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) {
        siguiente.delete(id);
      } else {
        siguiente.add(id);
      }
      return siguiente;
    });
  }

  function todos(): void {
    setSeleccion(new Set((pedido?.lineas ?? []).map((l) => l.id)));
  }
  function ninguno(): void {
    setSeleccion(new Set());
  }

  function confirmar(): void {
    if (pedido === undefined) {
      return;
    }
    const idLineas = [...seleccion];
    copiar.mutate(
      { id: pedido.id, cuerpo: { idLineas } },
      {
        onSuccess: (nuevo) => {
          toast.success(`Pedido ${pedido.folio} copiado en el ${nuevo.folio}.`);
          alCambiarAbierto(false);
          alCopiado?.(nuevo.id);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const lineas = pedido?.lineas ?? [];

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copiar pedido {pedido?.folio ?? ''}</DialogTitle>
          <DialogDescription>
            Elige los renglones a copiar. Se creará un pedido nuevo (con folio nuevo) y el mismo
            cliente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {seleccion.size} de {lineas.length} renglones
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={todos}>
                Todos
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={ninguno}>
                Ninguno
              </Button>
            </div>
          </div>

          <ul
            className="max-h-[40vh] space-y-1 overflow-y-auto"
            data-testid="lista-copiar-renglones"
          >
            {lineas.map((l) => (
              <li key={l.id}>
                <label className="flex items-center gap-3 rounded-md border p-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={seleccion.has(l.id)}
                    onChange={() => alternar(l.id)}
                    data-testid="copiar-renglon-check"
                    aria-label={`Copiar el renglón ${l.codigoModelo}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{l.codigoModelo}</span>
                    {l.descripcionModelo ? (
                      <span className="text-muted-foreground"> — {l.descripcionModelo}</span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground">{l.cantidadPedida} pz</span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={copiar.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={copiar.isPending}
            data-testid="confirmar-copiar"
          >
            {copiar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Copiar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
