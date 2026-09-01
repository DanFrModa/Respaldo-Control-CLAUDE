import { FileTextIcon, Loader2Icon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';

import {
  useAdjuntosDesarrollo,
  useQuitarAdjuntoDesarrollo,
  useSubirAdjuntoDesarrollo,
} from '@/api/adjuntos-desarrollo';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatearFechaHora, formatearTamano, nombreDeAutor } from '@/lib/formato';

/** Tamaño máximo del adjunto (50 MB), espejo del límite de captura del backend. */
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Tech pack / adjuntos de un DESARROLLO (rediseño R5, B16): PDFs de referencia y fotos de muestra
 * ligados al desarrollo en R2. Espejo de `AdjuntosOrden`:
 *   - El usuario elige un archivo (cualquier tipo, ≤50 MB validado en el navegador; el backend re-valida).
 *   - `useSubirAdjuntoDesarrollo` hace el POST (presigned) + PUT directo a R2.
 *   - La lista se refresca sola con nombre, tamaño, fecha, quién subió, descarga y quitar.
 *
 * Subir/quitar exigen `desarrollo.administrar` (se ocultan sin él); el backend re-decide (A1).
 */
export function TechPackDesarrollo({
  idDesarrollo,
  puedeAdministrar,
}: {
  idDesarrollo: number;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const consulta = useAdjuntosDesarrollo(idDesarrollo);
  const subir = useSubirAdjuntoDesarrollo();
  const quitar = useQuitarAdjuntoDesarrollo();
  const inputRef = useRef<HTMLInputElement>(null);

  function alElegirArchivo(evento: React.ChangeEvent<HTMLInputElement>): void {
    const archivo = evento.target.files?.[0];
    evento.target.value = '';
    if (!archivo) {
      return;
    }
    if (archivo.size > MAX_BYTES) {
      toast.error('El archivo es muy grande (máximo 50 MB).');
      return;
    }
    subir.mutate(
      { idDesarrollo, archivo },
      {
        onSuccess: () => toast.success(`Adjunto "${archivo.name}" subido.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function alQuitar(idArchivo: string, nombre: string): void {
    quitar.mutate(
      { idDesarrollo, idArchivo },
      {
        onSuccess: () => toast.success(`Adjunto "${nombre}" eliminado.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const subiendo = subir.isPending;
  const adjuntos = consulta.data ?? [];

  return (
    <div className="space-y-4" data-testid="tech-pack-desarrollo">
      {puedeAdministrar ? (
        <div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            disabled={subiendo}
            onChange={alElegirArchivo}
            data-testid="tech-pack-archivo"
          />
          <Button
            type="button"
            variant="outline"
            disabled={subiendo}
            onClick={() => inputRef.current?.click()}
            data-testid="elegir-tech-pack"
          >
            {subiendo ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <UploadIcon aria-hidden />
            )}
            {subiendo ? 'Subiendo…' : 'Subir tech pack / foto'}
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            PDFs de referencia o fotos de muestra, hasta 50 MB.
          </p>
        </div>
      ) : null}

      {consulta.isPending ? (
        <div className="space-y-2" data-testid="tech-pack-cargando">
          <Skeleton className="h-12 w-full" />
        </div>
      ) : consulta.isError ? (
        <p className="text-sm text-destructive">{consulta.error.message}</p>
      ) : adjuntos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Este desarrollo no tiene tech pack ni fotos.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="lista-tech-pack">
          {adjuntos.map((adjunto) => {
            // El NOMBRE de quien lo subió, no su id (V1). `null` = nadie ⇒ se omite el « · por ».
            const autor = nombreDeAutor(adjunto.subidoPorId, adjunto.nombreSubidoPor);
            return (
              <li
                key={adjunto.idArchivo}
                data-testid="fila-tech-pack"
                className="flex items-center gap-3 rounded-lg border p-2.5"
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
                >
                  <FileTextIcon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <a
                    href={adjunto.urlDescarga}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-medium underline-offset-4 hover:underline"
                    data-testid="descargar-tech-pack"
                  >
                    {adjunto.nombreOriginal}
                  </a>
                  <span className="block text-xs text-muted-foreground">
                    {formatearTamano(adjunto.tamanoBytes)} · {formatearFechaHora(adjunto.creadoEn)}
                    {autor === null ? '' : ` · por ${autor}`}
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
                    data-testid="quitar-tech-pack"
                  >
                    <Trash2Icon className="text-destructive" aria-hidden />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
