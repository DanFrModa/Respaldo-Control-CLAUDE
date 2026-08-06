import { FileTextIcon, Loader2Icon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';

import {
  useAdjuntosEntradaTela,
  useQuitarAdjuntoEntradaTela,
  useSubirAdjuntoEntradaTela,
} from '@/api/entradas-tela';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatearFechaHora, formatearTamano } from '@/lib/formato';

/** Tamaño máximo del adjunto (50 MB), espejo del límite de captura del backend. */
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Adjuntos de un documento de ENTRADA de tela (B1): el **PDF de la factura** o remisión del
 * proveedor, en R2. Espejo de `AdjuntosPedido`/`AdjuntosOrden`: listar/descargar con
 * `inventario-telas.ver` (la pantalla ya lo exige); subir/quitar sólo con `inventario-telas.mover`
 * (se ocultan sin él; el backend re-decide, A1). El adjunto se puede subir en cualquier estado del
 * documento: la factura escaneada suele llegar después de que la tela ya entró.
 */
export function AdjuntosEntradaTela({
  idEntrada,
  puedeAdministrar,
}: {
  idEntrada: number;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const consulta = useAdjuntosEntradaTela(idEntrada);
  const subir = useSubirAdjuntoEntradaTela();
  const quitar = useQuitarAdjuntoEntradaTela();
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
      { id: idEntrada, archivo },
      {
        onSuccess: () => toast.success(`Adjunto "${archivo.name}" subido.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function alQuitar(idArchivo: string, nombre: string): void {
    quitar.mutate(
      { id: idEntrada, idArchivo },
      {
        onSuccess: () => toast.success(`Adjunto "${nombre}" eliminado.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const subiendo = subir.isPending;
  const adjuntos = consulta.data ?? [];

  return (
    <div className="space-y-2" data-testid="adjuntos-entrada-tela">
      {consulta.isPending ? (
        <Skeleton className="h-10 w-full" />
      ) : consulta.isError ? (
        <p className="text-sm text-destructive">{consulta.error.message}</p>
      ) : adjuntos.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Sin adjuntos (aquí vive el PDF de la factura o remisión del proveedor).
        </p>
      ) : (
        <ul className="space-y-1.5" data-testid="lista-adjuntos-entrada-tela">
          {adjuntos.map((adjunto) => (
            <li
              key={adjunto.idArchivo}
              data-testid="fila-adjunto-entrada-tela"
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
                  data-testid="descargar-adjunto-entrada-tela"
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
                  data-testid="quitar-adjunto-entrada-tela"
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
            data-testid="adjunto-entrada-tela-archivo"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={subiendo}
            onClick={() => inputRef.current?.click()}
            data-testid="elegir-adjunto-entrada-tela"
          >
            {subiendo ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <UploadIcon aria-hidden />
            )}
            {subiendo ? 'Subiendo…' : 'Subir factura (PDF)'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
