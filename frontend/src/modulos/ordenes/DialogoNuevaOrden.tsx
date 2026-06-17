import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCrearOrden } from '@/api/ordenes';
import { usePedido, usePedidos } from '@/api/pedidos';
import type { OrdenCrear } from '@/api/tipos';
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
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';

/**
 * Diálogo de ALTA de una orden de producción (F2-E3): se elige un PEDIDO (búsqueda) y luego un
 * RENGLÓN de ese pedido (modelo + cantidad); la orden sale de ese `idPedidoLinea` (obligatorio), y
 * el backend autorrellena modelo/cliente. Si el pedido está cancelado/no-producir, el backend
 * rechaza y se muestra el toast de error. Al éxito se selecciona la orden nueva en la lista.
 */
export function DialogoNuevaOrden({
  abierto,
  alCambiarAbierto,
  alCreada,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Callback con el id de la orden nueva (para enfocarla en la lista). */
  alCreada: (idNueva: number) => void;
}): React.JSX.Element {
  const crear = useCrearOrden();

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [idPedido, setIdPedido] = useState<number | null>(null);
  const [idPedidoLinea, setIdPedidoLinea] = useState<number | null>(null);

  // Lista de pedidos NO cancelados para elegir (la orden no puede salir de uno cancelado).
  const pedidos = usePedidos({
    pagina: 1,
    porPagina: 20,
    ordenarPor: 'folio',
    direccion: 'desc',
    incluirCancelados: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });
  const pedido = usePedido(idPedido ?? undefined);

  // Al abrir/cerrar, limpia la selección.
  useEffect(() => {
    if (abierto) {
      setTextoBusqueda('');
      setIdPedido(null);
      setIdPedidoLinea(null);
    }
  }, [abierto]);

  function confirmar(): void {
    if (idPedidoLinea === null) {
      return;
    }
    const cuerpo: OrdenCrear = { idPedidoLinea };
    crear.mutate(cuerpo, {
      onSuccess: (orden) => {
        toast.success(`Orden ${orden.folio} creada.`);
        alCambiarAbierto(false);
        alCreada(orden.id);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  const renglones = pedido.data?.lineas ?? [];

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva orden</DialogTitle>
          <DialogDescription>
            Elige un pedido y un renglón (modelo). La orden hereda el modelo y el cliente de ese
            renglón; el folio se asigna automáticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Paso 1: elegir pedido */}
          <Field>
            <FieldLabel htmlFor="orden-buscar-pedido">Pedido</FieldLabel>
            <Input
              id="orden-buscar-pedido"
              type="search"
              placeholder="Buscar por folio o cliente…"
              value={textoBusqueda}
              onChange={(e) => setTextoBusqueda(e.target.value)}
              data-testid="orden-buscar-pedido"
            />
            <div className="mt-2 max-h-40 overflow-y-auto rounded-md border">
              {pedidos.isPending ? (
                <p className="p-3 text-sm text-muted-foreground">Cargando pedidos…</p>
              ) : pedidos.isError ? (
                <p className="p-3 text-sm text-destructive">{pedidos.error.message}</p>
              ) : (pedidos.data?.datos ?? []).length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No hay pedidos que coincidan con la búsqueda.
                </p>
              ) : (
                <ul data-testid="orden-lista-pedidos">
                  {(pedidos.data?.datos ?? []).map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setIdPedido(p.id);
                          setIdPedidoLinea(null);
                        }}
                        aria-pressed={idPedido === p.id}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                          idPedido === p.id ? 'bg-primary-soft' : ''
                        }`}
                        data-testid="orden-pedido-opcion"
                      >
                        <span className="font-medium">Pedido {p.folio}</span>
                        <span className="truncate text-muted-foreground">{p.cliente}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>

          {/* Paso 2: elegir renglón del pedido */}
          {idPedido !== null ? (
            <Field>
              <FieldLabel htmlFor="orden-renglon">Renglón (modelo)</FieldLabel>
              {pedido.isPending ? (
                <p className="text-sm text-muted-foreground">Cargando renglones…</p>
              ) : renglones.length === 0 ? (
                <p className="text-sm text-muted-foreground">Este pedido no tiene renglones.</p>
              ) : (
                <ul className="space-y-1" data-testid="orden-lista-renglones">
                  {renglones.map((l) => (
                    <li key={l.id}>
                      <label className="flex items-center gap-3 rounded-md border p-2 text-sm">
                        <input
                          type="radio"
                          name="orden-renglon"
                          className="size-4 accent-primary"
                          checked={idPedidoLinea === l.id}
                          onChange={() => setIdPedidoLinea(l.id)}
                          data-testid="orden-renglon-opcion"
                          aria-label={`Renglón ${l.codigoModelo}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{l.codigoModelo}</span>
                          {l.descripcionModelo ? (
                            <span className="text-muted-foreground"> — {l.descripcionModelo}</span>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground">
                          {l.cantidadPedida.toLocaleString('es-MX')} pz
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={crear.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={crear.isPending || idPedidoLinea === null}
            data-testid="confirmar-nueva-orden"
          >
            {crear.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Crear orden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
