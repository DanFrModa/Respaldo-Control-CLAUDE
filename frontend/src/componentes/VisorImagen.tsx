import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, Loader2Icon } from 'lucide-react';
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
 *
 * NAVEGACIÓN opcional (galería): si el padre pasa `alAnterior`/`alSiguiente`, el visor muestra
 * flechas laterales y responde a ←/→ del teclado para moverse entre varias fotos (el padre gobierna
 * la lista/índice y actualiza `url`/`textoAlt`/`nombreArchivo`). Sin esas props, el visor se ve
 * idéntico a antes (una sola imagen) — 100% retrocompatible.
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
  /** Galería: ir a la foto anterior (si se puede). Sin esta prop no se pinta la flecha. */
  alAnterior?: () => void;
  /** Galería: ir a la foto siguiente (si se puede). Sin esta prop no se pinta la flecha. */
  alSiguiente?: () => void;
  /** ¿Hay foto anterior? (deshabilita la flecha en el extremo). Default true. */
  hayAnterior?: boolean;
  /** ¿Hay foto siguiente? (deshabilita la flecha en el extremo). Default true. */
  haySiguiente?: boolean;
  /** Texto de posición en la galería (ej. "2 / 5"); se muestra junto a Descargar. */
  posicion?: string;
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
  alAnterior,
  alSiguiente,
  hayAnterior = true,
  haySiguiente = true,
  posicion,
}: PropsVisorImagen): React.JSX.Element {
  const [descargando, setDescargando] = useState(false);
  const conGaleria = alAnterior !== undefined || alSiguiente !== undefined;

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

  function alTecla(evento: React.KeyboardEvent): void {
    if (evento.key === 'ArrowLeft' && alAnterior !== undefined && hayAnterior) {
      evento.preventDefault();
      alAnterior();
    } else if (evento.key === 'ArrowRight' && alSiguiente !== undefined && haySiguiente) {
      evento.preventDefault();
      alSiguiente();
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      {/* Lightbox: ancho casi completo del viewport, fondo oscuro, imagen ajustada. */}
      <DialogContent
        className="max-h-[92vh] w-auto max-w-[95vw] overflow-hidden border-0 bg-black/90 p-2 sm:max-w-[90vw]"
        data-testid={`visor-${testid}`}
        onKeyDown={conGaleria ? alTecla : undefined}
      >
        {/* Título/descripción accesibles (radix los exige); ocultos a la vista. */}
        <DialogTitle className="sr-only">{textoAlt}</DialogTitle>
        <DialogDescription className="sr-only">Vista ampliada de la imagen.</DialogDescription>

        <div className="relative">
          <img
            src={url}
            alt={textoAlt}
            className="mx-auto max-h-[80vh] w-auto max-w-full rounded-lg object-contain"
            data-testid={`imagen-${testid}`}
          />
          {alAnterior !== undefined ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full opacity-90"
              disabled={!hayAnterior}
              onClick={alAnterior}
              aria-label="Foto anterior"
              data-testid={`visor-${testid}-anterior`}
            >
              <ChevronLeftIcon aria-hidden />
            </Button>
          ) : null}
          {alSiguiente !== undefined ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full opacity-90"
              disabled={!haySiguiente}
              onClick={alSiguiente}
              aria-label="Foto siguiente"
              data-testid={`visor-${testid}-siguiente`}
            >
              <ChevronRightIcon aria-hidden />
            </Button>
          ) : null}
        </div>

        <div className="flex items-center justify-center gap-3 pt-1">
          {posicion !== undefined ? (
            <span className="text-xs text-white/80" data-testid={`visor-${testid}-posicion`}>
              {posicion}
            </span>
          ) : null}
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
