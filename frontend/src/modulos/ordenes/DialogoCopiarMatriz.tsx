import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useCopiarMatriz, useOrdenes } from '@/api/ordenes';
import type { Orden } from '@/api/tipos';
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
 * Diálogo de COPIAR MATRIZ desde otra orden (F2-E3): se elige una orden ORIGEN (búsqueda) y el
 * backend copia su matriz (colores × tallas × PACK) a la orden destino. Útil para reusar la curva de
 * una orden parecida. El backend re-valida (misma empresa) y recalcula el estado de la orden.
 *
 * ⭐ EL TENDIDO VIAJA CON LA MATRIZ (§Post-F9.10): copiar una OP de C&A trae sus packs tal cual. Y
 * si la orden DESTINO ya tiene producción capturada con otros packs, el servidor rechaza la copia
 * —cambiar los packs de un color con corte vivo dejaría esas piezas sin poder enviarse nunca—; el
 * mensaje sale en el toast del error. Aquí no se re-implementa esa regla: la autoridad es el
 * dominio (A1) y una segunda copia de la comprobación acabaría divergiendo de ella.
 */
export function DialogoCopiarMatriz({
  abierto,
  alCambiarAbierto,
  orden,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Orden DESTINO (a la que se copia la matriz). */
  orden: Orden | undefined;
}): React.JSX.Element {
  const copiar = useCopiarMatriz();

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [idOrigen, setIdOrigen] = useState<number | null>(null);

  // Órdenes candidatas (excluye la propia orden destino al pintar).
  const candidatas = useOrdenes({
    pagina: 1,
    porPagina: 20,
    ordenarPor: 'folio',
    direccion: 'desc',
    incluirCanceladas: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  useEffect(() => {
    if (abierto) {
      setTextoBusqueda('');
      setIdOrigen(null);
    }
  }, [abierto]);

  function confirmar(): void {
    if (orden === undefined || idOrigen === null) {
      return;
    }
    copiar.mutate(
      { id: orden.id, cuerpo: { idOrdenOrigen: idOrigen } },
      {
        onSuccess: () => {
          toast.success('Matriz copiada.');
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const opciones = (candidatas.data?.datos ?? []).filter((o) => o.id !== orden?.id);

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copiar matriz de otra orden</DialogTitle>
          <DialogDescription>
            Elige la orden de la que se copiará la matriz (colores, tallas y packs) a la orden{' '}
            {orden?.folio ?? ''}. Reemplaza por completo la matriz actual.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field>
            <FieldLabel htmlFor="copiar-matriz-buscar">Orden origen</FieldLabel>
            <Input
              id="copiar-matriz-buscar"
              type="search"
              placeholder="Buscar por folio, modelo o cliente…"
              value={textoBusqueda}
              onChange={(e) => setTextoBusqueda(e.target.value)}
              data-testid="copiar-matriz-buscar"
            />
            <div className="mt-2 max-h-48 overflow-y-auto rounded-md border">
              {candidatas.isPending ? (
                <p className="p-3 text-sm text-muted-foreground">Cargando órdenes…</p>
              ) : candidatas.isError ? (
                <p className="p-3 text-sm text-destructive">{candidatas.error.message}</p>
              ) : opciones.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No hay otras órdenes que coincidan.
                </p>
              ) : (
                <ul data-testid="copiar-matriz-lista">
                  {opciones.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => setIdOrigen(o.id)}
                        aria-pressed={idOrigen === o.id}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                          idOrigen === o.id ? 'bg-primary-soft' : ''
                        }`}
                        data-testid="copiar-matriz-opcion"
                      >
                        <span className="font-medium">Orden {o.folio}</span>
                        <span className="truncate text-muted-foreground">
                          {o.codigoModelo} · {o.cliente}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>
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
            disabled={copiar.isPending || idOrigen === null}
            data-testid="confirmar-copiar-matriz"
          >
            {copiar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Copiar matriz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
