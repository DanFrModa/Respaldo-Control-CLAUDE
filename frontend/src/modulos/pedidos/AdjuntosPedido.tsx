import { FileTextIcon, Loader2Icon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';

import {
  useAdjuntosPedido,
  useQuitarAdjuntoPedido,
  useSubirAdjuntoPedido,
} from '@/api/adjuntos-pedido';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatearFechaHora, formatearTamano } from '@/lib/formato';

/** Tamaño máximo del adjunto (50 MB), espejo del límite de captura del backend. */
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Adjuntos de apoyo de un PEDIDO interno (rediseño R3, B3): el documento ORIGINAL de la OC del
 * cliente (Excel/PDF/imágenes) en R2. Espejo de `AdjuntosOrden` (F8-E6) re-vestido para el cajón
 * de Pedidos: listar/descargar con `pedidos.ver` (la pantalla ya lo exige); subir/quitar solo con
 * `pedidos.administrar` (se ocultan sin él; el backend re-decide, A1). Es la salida del flujo del
 * constructor: si la subida del archivo de la OC falló al crear el pedido, AQUÍ se reintenta.
 */
export function AdjuntosPedido({
  idPedido,
  puedeAdministrar,
}: {
  idPedido: number;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const consulta = useAdjuntosPedido(idPedido);
  const subir = useSubirAdjuntoPedido();
  const quitar = useQuitarAdjuntoPedido();
  const inputRef = useRef<HTMLInputElement>(null);

  function alElegirArchivo(evento: React.ChangeEvent<HTMLInputElement>): void {
    const archivo = evento.target.files?.[0];
    // Resetea el input para poder volver a elegir el mismo archivo tras un error.
    evento.target.value = '';
    if (!archivo) {
      return;
    }
    if (archivo.size > MAX_BYTES) {
      toast.error('El archivo es muy grande (máximo 50 MB).');
      return;
    }
    subir.mutate(
      { idPedido, archivo },
      {
        onSuccess: () => toast.success(`Adjunto "${archivo.name}" subido.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function alQuitar(idArchivo: string, nombre: string): void {
    quitar.mutate(
      { idPedido, idArchivo },
      {
        onSuccess: () => toast.success(`Adjunto "${nombre}" eliminado.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const subiendo = subir.isPending;
  const adjuntos = consulta.data ?? [];

  return (
    <div className="space-y-2" data-testid="adjuntos-pedido">
      {consulta.isPending ? (
        <div className="space-y-2" data-testid="adjuntos-pedido-cargando">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : consulta.isError ? (
        <p className="text-sm text-destructive">{consulta.error.message}</p>
      ) : adjuntos.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Este pedido no tiene adjuntos (aquí vive el documento de la OC del cliente).
        </p>
      ) : (
        <ul className="space-y-1.5" data-testid="lista-adjuntos-pedido">
          {adjuntos.map((adjunto) => (
            <li
              key={adjunto.idArchivo}
              data-testid="fila-adjunto-pedido"
              className="flex items-center gap-2.5 rounded-lg border p-2"
            >
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
              >
                <FileTextIcon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <a
                  href={adjunto.urlDescarga}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-xs font-medium underline-offset-4 hover:underline"
                  data-testid="descargar-adjunto-pedido"
                >
                  {adjunto.nombreOriginal}
                </a>
                <span className="block text-[11px] text-muted-foreground">
                  {formatearTamano(adjunto.tamanoBytes)} · {formatearFechaHora(adjunto.creadoEn)}
                </span>
              </div>
              {puedeAdministrar ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={quitar.isPending}
                  onClick={() => alQuitar(adjunto.idArchivo, adjunto.nombreOriginal)}
                  aria-label={`Quitar adjunto ${adjunto.nombreOriginal}`}
                  data-testid="quitar-adjunto-pedido"
                >
                  <Trash2Icon className="text-destructive" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {puedeAdministrar ? (
        <div>
          {/* Input de archivo oculto; el botón lo dispara (mejor UX y estilo consistente). */}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            disabled={subiendo}
            onChange={alElegirArchivo}
            data-testid="adjunto-pedido-archivo"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={subiendo}
            onClick={() => inputRef.current?.click()}
            data-testid="elegir-adjunto-pedido"
          >
            {subiendo ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <UploadIcon aria-hidden />
            )}
            {subiendo ? 'Subiendo…' : 'Subir adjunto'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
