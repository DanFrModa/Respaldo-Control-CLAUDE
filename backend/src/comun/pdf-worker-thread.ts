/**
 * Hilo TRABAJADOR de generación de DOCUMENTOS (`node:worker_threads`) — la mitad que corre FUERA del
 * event loop principal (blindaje general de impresos). El hilo principal resuelve los datos contra la
 * BD (`armarDatos*`) y le manda a ESTE worker SOLO los datos ya resueltos (serializables); el worker
 * importa el módulo del documento pedido y llama a su función de CONSTRUCCIÓN pura, devolviendo el
 * Buffer. Cubre dos familias con el MISMO mecanismo:
 *  • PDFs (`@react-pdf/renderer`) — `generarPdf*` (incidente 11-jul: el impreso de Telas congeló 82 s
 *    toda la app al renderizar miles de renglones en el event loop).
 *  • Excel (`exceljs`) — `construirExcel*`, que ACUMULA el workbook completo en memoria (decenas de
 *    miles de filas en rangos amplios), con el mismo riesgo de bloqueo que el PDF.
 *
 * Convenciones:
 *  • El registro mapea `clave` → thunk PEREZOSO (`() => import(...)`) que carga SOLO el módulo del
 *    documento solicitado (no los ~35) y devuelve su constructor puro (datos resueltos → Buffer).
 *  • Los especificadores usan sufijo `.js` (convención NodeNext del repo): resuelven igual en dev (tsx
 *    mapea `.js`→`.ts`) y en prod (dist/*.js).
 *  • El `parentPort` puede ser `null` si el módulo se importa desde el hilo principal (solo para los
 *    tipos {@link ClavePdf} / {@link ClaveExcel}); por eso el bucle de mensajes se monta bajo guarda.
 *
 * La orquestación (pool, cola FIFO, timeouts por tipo, reciclaje) vive en `pdf-worker.ts` (hilo
 * principal).
 */
import { parentPort } from 'node:worker_threads';

import { fijarLogoImpresos } from './impresos-estilos.js';

/** Una función de CONSTRUCCIÓN pura: datos YA resueltos (serializables) → Buffer del documento. */
type GeneradorDocumento = (datos: never) => Promise<Buffer>;

/**
 * Registro de impresos PDF: `clave` → thunk que importa el módulo y devuelve su render puro. Cada
 * impreso ya separa `armarDatos*` (BD, hilo principal) de su `generarPdf*` (puro): aquí solo se usa el
 * segundo.
 */
const REGISTRO_PDF = {
  // ── Inventarios ──────────────────────────────────────────────────────────────
  'inventario-telas': async () =>
    (await import('../dominio/inventarios/impresos/impreso-inventario-telas.js'))
      .generarPdfInventarioTelas,
  'traspaso-tela': async () =>
    (await import('../dominio/inventarios/impresos/impreso-traspaso-tela.js'))
      .generarPdfTraspasoTela,

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
  'desarrollo-cotizacion': async () =>
    (await import('../dominio/desarrollo/impresos/impreso-cotizacion.js')).generarPdfCotizacion,

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
} satisfies Record<string, () => Promise<GeneradorDocumento>>;

/**
 * Registro de exports a EXCEL: `clave` → thunk que importa el módulo y devuelve su `construirExcel*`
 * puro. Cada export separa `armarDatos*` (BD + paginación, hilo principal) de su constructor (puro):
 * aquí solo se usa el segundo. Se atienden en el MISMO pool que los PDF pero con timeout propio (los
 * libros grandes tardan más que un render de PDF) — ver `pdf-worker.ts`.
 */
const REGISTRO_EXCEL = {
  // ── Ruta Crítica ─────────────────────────────────────────────────────────────
  'excel-concentrado': async () =>
    (await import('../dominio/ruta-critica/impresos/excel-concentrado.js'))
      .construirExcelConcentrado,
  'excel-desempeno-rc': async () =>
    (await import('../dominio/ruta-critica/impresos/excel-desempeno-rc.js'))
      .construirExcelDesempeno,

  // ── Costos / EDR ─────────────────────────────────────────────────────────────
  'excel-margenes': async () =>
    (await import('../dominio/costos/impresos/excel-margenes.js')).construirExcelMargenes,
  'excel-ventas': async () =>
    (await import('../dominio/edr/impresos/excel-ventas.js')).construirExcelVentas,
  'excel-edr': async () => (await import('../dominio/edr/impresos/excel-edr.js')).construirExcelEdr,

  // ── EsMa (estados de cuenta de maquileros) ───────────────────────────────────
  'excel-esma-estado-cuenta': async () =>
    (await import('../dominio/esma/impresos/excel-estado-cuenta.js')).construirExcelEstadoCuenta,

  // ── Indicadores (tableros directivos) ────────────────────────────────────────
  'excel-kpis-rc': async () =>
    (await import('../dominio/indicadores/impresos/excel.js')).construirExcelKpisRc,
  'excel-kpis-calidad': async () =>
    (await import('../dominio/indicadores/impresos/excel.js')).construirExcelKpisCalidad,
  'excel-kpis-wip': async () =>
    (await import('../dominio/indicadores/impresos/excel.js')).construirExcelKpisWip,

  // ── Desarrollo y cotización ──────────────────────────────────────────────────
  'excel-lista-precios': async () =>
    (await import('../dominio/desarrollo/impresos/excel-lista-precios.js'))
      .construirExcelListaPrecios,

  // ── Finanzas (terceros: reporte fiscal del contador) ─────────────────────────
  'excel-reporte-fiscal': async () =>
    (await import('../dominio/terceros/reportes/impresos/excel-reporte-fiscal.js'))
      .construirExcelReporteFiscal,
} satisfies Record<string, () => Promise<GeneradorDocumento>>;

/** Registro unificado: los dos tipos comparten el mismo pool y protocolo de mensajes. */
const REGISTRO = { ...REGISTRO_PDF, ...REGISTRO_EXCEL };

/** Clave de un impreso PDF registrado (la comparte el hilo principal como tipo). */
export type ClavePdf = keyof typeof REGISTRO_PDF;

/** Clave de un export a Excel registrado (la comparte el hilo principal como tipo). */
export type ClaveExcel = keyof typeof REGISTRO_EXCEL;

// ── Protocolo de mensajes (hilo principal ↔ worker) ──────────────────────────────────────────────

/** Petición del hilo principal: qué documento generar y con qué datos (ya resueltos). */
export interface PeticionRenderPdf {
  id: string;
  clave: string;
  datos: unknown;
  /**
   * LOGO de la empresa como data-URL, ya resuelto en el hilo principal (`comun/logo-empresa.ts`).
   * Se fija en `impresos-estilos.ts` ANTES de construir el documento, que es el único punto por el
   * que pasan los 23 impresos: así el membrete sale brandeado sin tocar ni un impreso. Si no viene
   * (p. ej. un Excel, que no lleva membrete), se deja el que ya tenga el módulo (el empaquetado).
   */
  logo?: string;
}

/** Respuesta del worker: el Buffer del documento, o un error legible. */
export type RespuestaRenderPdf =
  | { id: string; ok: true; buffer: Uint8Array }
  | { id: string; ok: false; error: string };

/** Resuelve el thunk de una clave (o `undefined` si no está registrada). */
export function generadorDe(clave: string): (() => Promise<GeneradorDocumento>) | undefined {
  return (REGISTRO as Record<string, () => Promise<GeneradorDocumento>>)[clave];
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
    // Branding: fija el logo de la empresa ANTES de construir. El worker atiende un trabajo a la
    // vez, así que este estado de módulo no se pisa entre documentos.
    if (msg.logo !== undefined) {
      fijarLogoImpresos(msg.logo);
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
