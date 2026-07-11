/**
 * Hilo TRABAJADOR de render de PDFs (`node:worker_threads`) — la mitad que corre FUERA del event loop
 * principal (blindaje general de PDFs). El hilo principal resuelve los datos contra la BD (`armarDatos*`)
 * y le manda a ESTE worker SOLO los datos ya resueltos (serializables); el worker importa el módulo del
 * impreso pedido y llama a su función de RENDER pura (`generarPdf*`), devolviendo el Buffer. Así, aunque
 * un impreso tenga miles de renglones, el costoso `renderToBuffer` de `@react-pdf/renderer` NO bloquea la
 * atención de peticiones (incidente 11-jul: el impreso de Telas congeló 82 s toda la app).
 *
 * Convenciones:
 *  • El registro mapea `clave` → thunk PEREZOSO (`() => import(...)`) que carga SOLO el módulo del
 *    impreso solicitado (no los ~25) y devuelve su `generarPdf*` (datos resueltos → Buffer).
 *  • Los especificadores usan sufijo `.js` (convención NodeNext del repo): resuelven igual en dev (tsx
 *    mapea `.js`→`.ts`) y en prod (dist/*.js).
 *  • El `parentPort` puede ser `null` si el módulo se importa desde el hilo principal (solo para el tipo
 *    {@link ClavePdf}); por eso el bucle de mensajes se monta bajo guarda.
 *
 * La orquestación (pool, cola FIFO, timeout, reciclaje) vive en `pdf-worker.ts` (hilo principal).
 */
import { parentPort } from 'node:worker_threads';

/** Una función de RENDER pura: datos YA resueltos (serializables) → Buffer del PDF. */
type GeneradorPdf = (datos: never) => Promise<Buffer>;

/**
 * Registro de impresos: `clave` → thunk que importa el módulo y devuelve su render puro. Cada impreso
 * ya separa `armarDatos*` (BD, hilo principal) de su `generarPdf*` (puro): aquí solo se usa el segundo.
 */
const REGISTRO = {
  // ── Inventarios ──────────────────────────────────────────────────────────────
  'inventario-telas': async () =>
    (await import('../dominio/inventarios/impresos/impreso-inventario-telas.js'))
      .generarPdfInventarioTelas,

  // ── Producción / WIP ─────────────────────────────────────────────────────────
  orden: async () =>
    (await import('../dominio/produccion/impresos/impreso-orden.js')).generarPdfOrden,
  ordenes: async () =>
    (await import('../dominio/produccion/impresos/impreso-orden.js')).generarPdfOrdenes,
  'envio-maquila': async () =>
    (await import('../dominio/produccion/impresos/impreso-envio-maquila.js')).generarPdfEnvio,
  'ficha-estampado': async () =>
    (await import('../dominio/produccion/impresos/impreso-envio-maquila.js'))
      .generarPdfFichaEstampado,
  'recibo-maquila': async () =>
    (await import('../dominio/produccion/impresos/impreso-recibo-maquila.js')).generarPdfRecibo,
  'entrega-cliente': async () =>
    (await import('../dominio/produccion/impresos/impreso-entrega-cliente.js')).generarPdfEntrega,

  // ── Compras / MRP ────────────────────────────────────────────────────────────
  'orden-compra': async () =>
    (await import('../dominio/compras/impresos/impreso-orden-compra.js')).generarPdfOrdenCompra,
  'estatus-materiales': async () =>
    (await import('../dominio/compras/impresos/impreso-estatus-materiales.js'))
      .generarPdfEstatusMateriales,
  explosion: async () =>
    (await import('../dominio/compras/impresos/impreso-explosion.js')).generarPdfExplosion,

  // ── Notas de salida ──────────────────────────────────────────────────────────
  'nota-salida': async () =>
    (await import('../dominio/notas/impresos/impreso-nota-salida.js')).generarPdfNotaSalida,

  // ── Ruta Crítica ─────────────────────────────────────────────────────────────
  'plan-rc': async () =>
    (await import('../dominio/ruta-critica/impresos/impreso-plan-rc.js')).generarPdfPlanRc,

  // ── Calidad ──────────────────────────────────────────────────────────────────
  auditoria: async () =>
    (await import('../dominio/calidad/impresos/impreso-auditoria.js')).generarPdfAuditoria,

  // ── Costos / EDR ─────────────────────────────────────────────────────────────
  'costos-lista-precios': async () =>
    (await import('../dominio/costos/impresos/impreso-lista-precios.js')).generarPdfListaPrecios,
  'costos-margenes': async () =>
    (await import('../dominio/costos/impresos/impreso-margenes.js')).generarPdfMargenes,
  'edr-anual': async () =>
    (await import('../dominio/edr/impresos/impreso-edr-anual.js')).generarPdfEdrAnual,
  'edr-mensual': async () =>
    (await import('../dominio/edr/impresos/impreso-edr-mensual.js')).generarPdfEdrMensual,

  // ── Desarrollo y cotización ──────────────────────────────────────────────────
  'desarrollo-lista-precios': async () =>
    (await import('../dominio/desarrollo/impresos/impreso-lista-precios.js'))
      .generarPdfListaPrecios,

  // ── EsMa (estados de cuenta de maquileros) ───────────────────────────────────
  'esma-estado-cuenta': async () =>
    (await import('../dominio/esma/impresos/impreso-estado-cuenta.js')).generarPdfEstadoCuenta,
  'esma-recibo-pago': async () =>
    (await import('../dominio/esma/impresos/impreso-recibo-pago.js')).generarPdfReciboPago,

  // ── Indicadores (tableros directivos + hoja de conteo) ───────────────────────
  'kpis-rc': async () => (await import('../dominio/indicadores/impresos/pdf.js')).generarPdfKpisRc,
  'kpis-calidad': async () =>
    (await import('../dominio/indicadores/impresos/pdf.js')).generarPdfKpisCalidad,
  'kpis-wip': async () =>
    (await import('../dominio/indicadores/impresos/pdf.js')).generarPdfKpisWip,
  'hoja-conteo': async () =>
    (await import('../dominio/indicadores/impresos/hoja-conteo-pdf.js')).generarPdfHojaConteo,

  // ── Finanzas (terceros: CxC / CxP + reporte fiscal) ──────────────────────────
  'cxc-estado-cuenta': async () =>
    (await import('../dominio/terceros/cxc/impresos/impreso-estado-cuenta-cxc.js')).generarPdfCxc,
  'cxp-estado-cuenta': async () =>
    (await import('../dominio/terceros/cxp/impresos/impreso-estado-cuenta-cxp.js')).generarPdfCxp,
  'reporte-fiscal': async () =>
    (await import('../dominio/terceros/reportes/impresos/impreso-reporte-fiscal.js'))
      .generarPdfReporteFiscal,
} satisfies Record<string, () => Promise<GeneradorPdf>>;

/** Clave de un impreso registrado (la comparte el hilo principal como tipo). */
export type ClavePdf = keyof typeof REGISTRO;

// ── Protocolo de mensajes (hilo principal ↔ worker) ──────────────────────────────────────────────

/** Petición del hilo principal: qué impreso renderizar y con qué datos (ya resueltos). */
export interface PeticionRenderPdf {
  id: string;
  clave: string;
  datos: unknown;
}

/** Respuesta del worker: el Buffer del PDF, o un error legible. */
export type RespuestaRenderPdf =
  | { id: string; ok: true; buffer: Uint8Array }
  | { id: string; ok: false; error: string };

/** Resuelve el thunk de una clave (o `undefined` si no está registrada). */
export function generadorDe(clave: string): (() => Promise<GeneradorPdf>) | undefined {
  return (REGISTRO as Record<string, () => Promise<GeneradorPdf>>)[clave];
}

/** Procesa una petición y responde por el puerto padre. */
async function atender(
  port: NonNullable<typeof parentPort>,
  msg: PeticionRenderPdf,
): Promise<void> {
  try {
    const thunk = generadorDe(msg.clave);
    if (thunk === undefined) {
      throw new Error(`Impreso no registrado: ${msg.clave}`);
    }
    const generar = (await thunk()) as (datos: unknown) => Promise<Buffer>;
    const buffer = await generar(msg.datos);
    // Copia a un ArrayBuffer PROPIO (los Buffer de Node comparten un pool que no se puede transferir)
    // y lo transfiere para evitar una segunda copia al cruzar al hilo principal.
    const bytes = Uint8Array.from(buffer);
    const respuesta: RespuestaRenderPdf = { id: msg.id, ok: true, buffer: bytes };
    port.postMessage(respuesta, [bytes.buffer]);
  } catch (error) {
    const respuesta: RespuestaRenderPdf = {
      id: msg.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    port.postMessage(respuesta);
  }
}

// Bucle de mensajes: solo activo cuando el módulo corre COMO worker (parentPort definido).
if (parentPort !== null) {
  const port = parentPort;
  port.on('message', (msg: PeticionRenderPdf) => {
    void atender(port, msg);
  });
}
