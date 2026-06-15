import { useEffect, useRef, useState } from 'react';

import { dibujarEnCanvas, type Simbologia } from './bwip';

/** Props del lienzo de un código de barra escaneable. */
interface CodigoBarraCanvasProps {
  /** Simbología: EAN-13 (13 dígitos) o ITF-14 (DUN-14, 14 dígitos). */
  simbologia: Simbologia;
  /** El número del código (13 o 14 dígitos). */
  valor: string;
  /** Etiqueta accesible (p. ej. "EAN-13 del modelo 501"). */
  etiqueta: string;
}

/**
 * Dibuja UN código de barra ESCANEABLE en pantalla con bwip-js, dentro de un `<canvas>`
 * (incluye el número legible debajo, que pinta bwip-js). Si el valor no es válido para la
 * simbología, muestra un mensaje en vez de romper la página.
 */
export function CodigoBarraCanvas({
  simbologia,
  valor,
  etiqueta,
}: CodigoBarraCanvasProps): React.JSX.Element {
  const refCanvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = refCanvas.current;
    if (canvas === null) {
      return;
    }
    try {
      dibujarEnCanvas(canvas, simbologia, valor);
      setError(null);
    } catch {
      setError('No se pudo dibujar el código de barra (valor inválido).');
    }
  }, [simbologia, valor]);

  return (
    <div className="flex flex-col items-center">
      <canvas
        ref={refCanvas}
        role="img"
        aria-label={etiqueta}
        data-testid={`canvas-${simbologia}`}
        className={error === null ? 'max-w-full' : 'hidden'}
      />
      {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
