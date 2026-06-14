import { FileTextIcon, Loader2Icon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  useAdjuntosProveedor,
  useQuitarAdjuntoProveedor,
  useSubirAdjuntoProveedor,
} from '@/api/proveedores';
import {
  ETIQUETAS_TIPO_ARCHIVO_PROVEEDOR,
  TIPOS_ARCHIVO_PROVEEDOR,
  type TipoArchivoProveedorClave,
} from '@/api/esquemas';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatearTamano } from '@/lib/formato';

/** MIME aceptado: solo PDF (sin preview de imagen, es documento). */
const MIME_PDF = 'application/pdf';
/** Tamaño máximo del adjunto (50 MB), espejo del límite de captura. */
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Adjuntador de PDF de un proveedor (F1-E1B, R15). Solo se usa en EDICIÓN: necesita
 * el id del proveedor para registrar el adjunto. Flujo:
 *   - El usuario elige el tipo (constancia/contrato/otro) y un PDF.
 *   - Se valida `application/pdf` y tamaño (≤50 MB) en el navegador (UX; el backend
 *     re-valida y firma).
 *   - `useSubirAdjuntoProveedor` hace el POST (presigned) + PUT directo a R2.
 *   - La lista de adjuntos se refresca sola (TanStack Query invalidate) y muestra
 *     nombre, tipo, tamaño, link de descarga y botón quitar.
 *
 * Toasts de éxito/error (sonner). No hay preview: es PDF (se abre en otra pestaña).
 */
export function AdjuntadorProveedor({
  idProveedor,
  deshabilitado = false,
}: {
  idProveedor: number;
  deshabilitado?: boolean;
}): React.JSX.Element {
  const consulta = useAdjuntosProveedor(idProveedor);
  const subir = useSubirAdjuntoProveedor();
  const quitar = useQuitarAdjuntoProveedor();

  const [tipo, setTipo] = useState<TipoArchivoProveedorClave>('CONSTANCIA');
  const inputRef = useRef<HTMLInputElement>(null);

  function alElegirArchivo(evento: React.ChangeEvent<HTMLInputElement>): void {
    const archivo = evento.target.files?.[0];
    // Resetea el input para poder volver a elegir el mismo archivo tras un error.
    evento.target.value = '';
    if (!archivo) {
      return;
    }
    if (archivo.type !== MIME_PDF) {
      toast.error('El adjunto debe ser un archivo PDF.');
      return;
    }
    if (archivo.size > MAX_BYTES) {
      toast.error('El archivo es muy grande (máximo 50 MB).');
      return;
    }
    subir.mutate(
      { idProveedor, archivo, tipo },
      {
        onSuccess: () => toast.success(`Adjunto "${archivo.name}" subido.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function alQuitar(idArchivo: string, nombre: string): void {
    quitar.mutate(
      { idProveedor, idArchivo },
      {
        onSuccess: () => toast.success(`Adjunto "${nombre}" eliminado.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const subiendo = subir.isPending;
  const adjuntos = consulta.data ?? [];

  return (
    <div className="space-y-4" data-testid="adjuntador-proveedor">
      <Field>
        <FieldLabel htmlFor="adjunto-tipo">Tipo de documento</FieldLabel>
        <SelectNativo
          id="adjunto-tipo"
          value={tipo}
          disabled={deshabilitado || subiendo}
          onChange={(e) => setTipo(e.target.value as TipoArchivoProveedorClave)}
          data-testid="adjunto-tipo"
        >
          {TIPOS_ARCHIVO_PROVEEDOR.map((clave) => (
            <option key={clave} value={clave}>
              {ETIQUETAS_TIPO_ARCHIVO_PROVEEDOR[clave]}
            </option>
          ))}
        </SelectNativo>
        <FieldDescription>Solo archivos PDF, hasta 50 MB.</FieldDescription>
      </Field>

      {/* Input de archivo oculto; el botón lo dispara (mejor UX y estilo consistente). */}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        disabled={deshabilitado || subiendo}
        onChange={alElegirArchivo}
        data-testid="adjunto-archivo"
      />
      <Button
        type="button"
        variant="outline"
        disabled={deshabilitado || subiendo}
        onClick={() => inputRef.current?.click()}
        data-testid="elegir-adjunto"
      >
        {subiendo ? (
          <Loader2Icon className="animate-spin" aria-hidden />
        ) : (
          <UploadIcon aria-hidden />
        )}
        {subiendo ? 'Subiendo…' : 'Subir PDF'}
      </Button>

      {/* Lista de adjuntos */}
      {consulta.isPending ? (
        <div className="space-y-2" data-testid="adjuntos-cargando">
          <Skeleton className="h-12 w-full" />
        </div>
      ) : consulta.isError ? (
        <p className="text-sm text-destructive">{consulta.error.message}</p>
      ) : adjuntos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Este proveedor no tiene adjuntos.</p>
      ) : (
        <ul className="space-y-2" data-testid="lista-adjuntos">
          {adjuntos.map((adjunto) => (
            <li
              key={adjunto.idArchivo}
              data-testid="fila-adjunto"
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
                  data-testid="descargar-adjunto"
                >
                  {adjunto.nombreOriginal}
                </a>
                <span className="block text-xs text-muted-foreground">
                  {ETIQUETAS_TIPO_ARCHIVO_PROVEEDOR[adjunto.tipo]} ·{' '}
                  {formatearTamano(adjunto.tamanoBytes)}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={deshabilitado || quitar.isPending}
                onClick={() => alQuitar(adjunto.idArchivo, adjunto.nombreOriginal)}
                aria-label={`Quitar adjunto ${adjunto.nombreOriginal}`}
                data-testid="quitar-adjunto"
              >
                <Trash2Icon className="text-destructive" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
