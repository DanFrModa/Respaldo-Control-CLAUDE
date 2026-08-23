/**
 * Extracción del TEXTO de un PDF — pieza compartida (V1-E3f pieza B).
 *
 * Nació dentro del importador de OC de C&A (`dominio/pedidos/parseo-pdf-cya.ts`, §Post-F9.2) y se
 * mudó aquí al aparecer el SEGUNDO lector de PDF del sistema: la Constancia de Situación Fiscal del
 * proveedor (§Post-F9.55). No tiene nada de negocio —abre bytes y devuelve el texto de cada página—
 * así que vive en `comun/` y no en un módulo de dominio: dejarla donde estaba habría obligado al
 * catálogo de proveedores a importar de `pedidos/`, que no tiene nada que ver.
 *
 * Por qué `unpdf`: wrapper moderno de una build serverless de pdf.js (Mozilla), 100 % JS SIN
 * dependencias nativas, mantenido y con tipos. Extrae SÓLO texto (no renderiza), que es lo único que
 * necesitamos, y es rápido con documentos chicos (decenas de ms): corre inline en el request, SIN
 * worker (el worker de documentos del repo es para GENERAR PDFs con @react-pdf, otra cosa).
 */
import { extractText } from 'unpdf';

import { ErrorValidacion } from './errores.js';

/** Tope del PDF decodificado (los documentos que se leen son chicos; blinda memoria/parseo). */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Extrae el texto de cada página del PDF con `unpdf`. Lanza `ErrorValidacion` con mensaje claro si el
 * archivo no es un PDF legible (corrupto/otro formato) — el llamador lo trata por-archivo.
 */
export async function extraerTextoPdf(buffer: Buffer): Promise<string[]> {
  if (buffer.length === 0) {
    throw new ErrorValidacion('El PDF está vacío o no se pudo leer.');
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw new ErrorValidacion('El PDF excede el máximo permitido (10 MB).');
  }
  try {
    // `extractText` acepta los bytes directamente (build serverless de pdf.js); `mergePages:false`
    // da el texto POR PÁGINA (quien parsea decide si las une o las trata por separado).
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: false });
    return text;
  } catch {
    throw new ErrorValidacion('El archivo no es un PDF válido o está dañado.');
  }
}
