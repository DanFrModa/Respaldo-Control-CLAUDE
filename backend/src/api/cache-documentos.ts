/**
 * Anti-caché de los DOCUMENTOS GENERADOS (impresos PDF y exports Excel) — incidente real del
 * 26-jul-2026.
 *
 * Qué pasó: los impresos se abren desde el frontend con `window.open('/api/…/impreso')`. Como la
 * respuesta salía SIN cabeceras de caché, el navegador aplicó su heurística y guardó el PDF; tras
 * desplegar una corrección del impreso, Daniel siguió viendo el PDF VIEJO (media hora de
 * confusión: solo en una ventana de incógnito salía el nuevo).
 *
 * Solución en el PUNTO COMÚN: no hay un helper único por donde salgan los PDFs (cada ruta arma su
 * `Content-Type` + `Content-Disposition`), así que el punto verdaderamente común es un hook
 * `onSend` de la raíz de la app: TODA respuesta cuyo `Content-Type` sea de documento generado
 * (PDF o XLSX) sale con `Cache-Control: no-store`. Cubre los ~25 impresos de hoy y, sobre todo,
 * los que se agreguen mañana sin que nadie tenga que acordarse.
 *
 * Lo que NO toca (a propósito):
 *  • Cualquier respuesta que YA traiga su propio `Cache-Control` — el hook respeta la decisión
 *    explícita de la ruta. Esto blinda a `GET /api/empresas/logo`, que SÍ debe cachearse (ETag +
 *    `max-age` largo con `?v=`): sirve un binario, pero es un ASSET, no un documento generado.
 *  • Los JSON del API (no llevan cabecera de caché y los navegadores no cachean `fetch` sin ella
 *    de forma agresiva; además el frontend usa TanStack Query como caché real).
 */
import type { FastifyInstance } from 'fastify';

/** Cabecera que se aplica: ni disco, ni memoria, ni proxies. Siempre se pide de nuevo. */
export const CACHE_CONTROL_DOCUMENTOS = 'no-store';

/**
 * Tipos MIME de DOCUMENTO GENERADO (se regeneran en cada petición a partir de los datos vivos:
 * cachearlos siempre está mal). No incluye `image/*`: los logos/fotos son assets.
 */
const MIMES_DOCUMENTO = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/** ¿Este `Content-Type` es de un documento generado? (tolera el `; charset=…` y mayúsculas). */
export function esDocumentoGenerado(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const tipo = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return MIMES_DOCUMENTO.includes(tipo);
}

/**
 * Registra el hook `onSend` que marca `no-store` en los documentos generados. Se llama UNA vez, en
 * la raíz de la app (`construirApp`), para que aplique a todos los routers.
 */
export function registrarNoCacheDocumentos(app: FastifyInstance): void {
  app.addHook('onSend', (_peticion, respuesta, contenido, hecho) => {
    const yaDecidio = respuesta.getHeader('cache-control') !== undefined;
    if (!yaDecidio && esDocumentoGenerado(respuesta.getHeader('content-type')?.toString())) {
      respuesta.header('Cache-Control', CACHE_CONTROL_DOCUMENTOS);
    }
    hecho(null, contenido);
  });
}
