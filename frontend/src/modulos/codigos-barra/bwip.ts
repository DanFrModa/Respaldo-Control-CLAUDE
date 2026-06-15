/**
 * Envoltorio fino de `bwip-js` (F1-E5) para dibujar códigos de barra en el navegador.
 *
 * Se importa de `bwip-js/browser` a propósito: el export por defecto de bwip-js resuelve a
 * la build de Node cuando el entorno NO es navegador (p. ej. jsdom en Vitest, que se anuncia
 * como Node), y esa build no trae `toCanvas`. La build `/browser` es la correcta para la SPA
 * y para los tests de componente (que sí tienen un canvas de jsdom).
 *
 * Simbologías (bcid de bwip-js):
 *  • EAN-13  → `'ean13'` (13 dígitos; bwip-js valida y dibuja las guardas).
 *  • DUN-14  → `'itf14'` (GTIN-14 / ITF-14, con barras de marco "bearer bars").
 *
 * Dos salidas:
 *  • {@link dibujarEnCanvas}: pinta dentro de un `<canvas>` ya montado (vista en pantalla).
 *  • {@link aPngDataUrl}: genera un PNG en data-URL (para incrustarlo como `<Image>` en el
 *    PDF de `@react-pdf/renderer`, que no sabe dibujar barras por sí solo).
 */
import bwipjs, { type RenderOptions } from 'bwip-js/browser';

/** Simbología soportada por la pantalla: EAN-13 (13) e ITF-14 para el DUN-14 (14). */
export type Simbologia = 'ean13' | 'itf14';

/** Opciones comunes de render (escala y altura en módulos de bwip-js). */
interface OpcionesRender {
  /** Factor de escala (px por módulo). Por defecto 3 (nítido en pantalla y PDF). */
  escala?: number;
  /** Altura de las barras en milímetros-equivalente de bwip-js. Por defecto 12. */
  altura?: number;
  /** Mostrar el número legible debajo del código (lo dibuja bwip-js). Por defecto true. */
  conTexto?: boolean;
}

/** Construye las opciones de bwip-js para una simbología + texto dados. */
function opcionesBwip(
  simbologia: Simbologia,
  texto: string,
  opciones: OpcionesRender,
): RenderOptions {
  return {
    bcid: simbologia,
    text: texto,
    scale: opciones.escala ?? 3,
    height: opciones.altura ?? 12,
    includetext: opciones.conTexto ?? true,
    textxalign: 'center',
    backgroundcolor: 'FFFFFF',
    paddingwidth: 6,
    paddingheight: 6,
  };
}

/**
 * Dibuja `texto` con la `simbologia` dada DENTRO de `canvas` (debe estar montado en el DOM).
 * Lanza si el texto no es un código válido para la simbología (lo valida bwip-js); el llamador
 * captura para mostrar un mensaje legible.
 */
export function dibujarEnCanvas(
  canvas: HTMLCanvasElement,
  simbologia: Simbologia,
  texto: string,
  opciones: OpcionesRender = {},
): void {
  bwipjs.toCanvas(canvas, opcionesBwip(simbologia, texto, opciones));
}

/**
 * Renderiza el código a un PNG en data-URL (`data:image/png;base64,...`) usando un canvas
 * temporal fuera de pantalla. Es lo que consume el PDF (`<Image src={dataUrl} />`). Lanza si
 * el texto no es válido para la simbología.
 */
export function aPngDataUrl(
  simbologia: Simbologia,
  texto: string,
  opciones: OpcionesRender = {},
): string {
  const canvas = document.createElement('canvas');
  bwipjs.toCanvas(canvas, opcionesBwip(simbologia, texto, opciones));
  return canvas.toDataURL('image/png');
}
