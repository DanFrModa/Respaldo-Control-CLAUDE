import { DownloadIcon, Loader2Icon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

/**
 * Visor de imagen ampliada REUTILIZABLE (lightbox). Muestra una imagen a tamaño grande sobre
 * un backdrop oscuro, dentro de un `Dialog` de radix (cierra con Esc, clic fuera y el botón ×),
 * y ofrece un botón DESCARGAR.
 *
 * Descarga cross-origin (A5): la URL es presigned de R2 (otro origen), donde el atributo
 * `download` de un `<a>` se IGNORA. Por eso la descarga es robusta en el navegador:
 * `fetch(url)` → `blob()` → `URL.createObjectURL` → `<a download>` → click → `revokeObjectURL`.
 * NO toca el backend (el contrato sigue idéntico). Si el fetch falla, se llama a `alErrorDescarga`
 * (el padre muestra el toast) y NO se descarga nada.
 *
 * Genérico: no conoce modelos ni bordados; el padre controla `abierto`/`alCambiarAbierto`, la
 * `url`, el `nombreArchivo` (filename de la descarga) y el `textoAlt`.
 */
export interface PropsVisorImagen {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** URL de la imagen a mostrar/descargar (p. ej. URL GET prefirmada de R2). */
  url: string;
  /** Texto alternativo de la imagen (accesibilidad) y título accesible del diálogo. */
  textoAlt: string;
  /** Nombre con el que se guardará el archivo al descargar (ej. "501-frente.jpg"). */
  nombreArchivo: string;
  /** Se invoca con un mensaje si la descarga falla (el padre muestra el toast). */
  alErrorDescarga?: (mensaje: string) => void;
  /** Base de los `data-testid` (p. ej. "foto" → `visor-foto`, `descargar-foto`). */
  testid?: string;
}

/**
 * Descarga una imagen cross-origin como blob (el `download` de `<a>` no aplica cross-origin).
 * Lanza si la red falla o la respuesta no es OK.
 */
async function descargarComoBlob(url: string, nombreArchivo: string): Promise<void> {
  const respuesta = await fetch(url);
  if (!respuesta.ok) {
    throw new Error('La descarga fue rechazada.');
  }
  const blob = await respuesta.blob();
  const urlObjeto = URL.createObjectURL(blob);
  try {
    const enlace = document.createElement('a');
    enlace.href = urlObjeto;
    enlace.download = nombreArchivo;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
  } finally {
    URL.revokeObjectURL(urlObjeto);
  }
}

export function VisorImagen({
  abierto,
  alCambiarAbierto,
  url,
  textoAlt,
  nombreArchivo,
  alErrorDescarga,
  testid = 'imagen',
}: PropsVisorImagen): React.JSX.Element {
  const [descargando, setDescargando] = useState(false);

  async function alDescargar(): Promise<void> {
    if (descargando) {
      return;
    }
    setDescargando(true);
    try {
      await descargarComoBlob(url, nombreArchivo);
    } catch {
      alErrorDescarga?.('No se pudo descargar la imagen. Intenta de nuevo.');
    } finally {
      setDescargando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      {/* Lightbox: ancho casi completo del viewport, fondo oscuro, imagen ajustada. */}
      <DialogContent
        className="max-h-[92vh] w-auto max-w-[95vw] overflow-hidden border-0 bg-black/90 p-2 sm:max-w-[90vw]"
        data-testid={`visor-${testid}`}
      >
        {/* Título/descripción accesibles (radix los exige); ocultos a la vista. */}
        <DialogTitle className="sr-only">{textoAlt}</DialogTitle>
        <DialogDescription className="sr-only">Vista ampliada de la imagen.</DialogDescription>

        <img
          src={url}
          alt={textoAlt}
          className="mx-auto max-h-[80vh] w-auto max-w-full rounded-lg object-contain"
          data-testid={`imagen-${testid}`}
        />

        <div className="flex justify-center pt-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void alDescargar()}
            disabled={descargando}
            data-testid={`descargar-${testid}`}
          >
            {descargando ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <DownloadIcon aria-hidden />
            )}
            Descargar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
