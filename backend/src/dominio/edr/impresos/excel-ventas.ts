/**
 * Export a EXCEL de VENTAS por período (proto `vVentas`; F7-E2). Reusa {@link listarVentas} (A1: la
 * lógica NO se duplica) y trae TODAS las líneas del filtro paginando internamente con el tope del
 * backend (100) — el MISMO resultado que la pantalla, no solo la página visible. Mismo patrón que
 * `excel-edr.ts` / `ruta-critica/impresos/excel-concentrado.ts`.
 */
import ExcelJS from 'exceljs';

import type { VentaLinea, VentasQuery } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { ARGB_MARCA } from '../../../comun/impresos-estilos.js';
import { renderizarExcelEnWorker } from '../../../comun/pdf-worker.js';

import { listarVentas } from '../ventas.js';

import { etiquetaPeriodo, MESES_ES } from './comun-edr.js';

/** Dependencias inyectables (los tests inyectan un `listarVentas` fake para no tocar BD). */
export interface DepsExcelVentas {
  listarVentas?: typeof listarVentas;
}

/** Datos PLANOS de ventas (cruzan al worker por structured clone). */
export interface DatosExcelVentas {
  lineas: VentaLinea[];
  /** Año/mes del filtro, para el título del archivo (`mes` = 0 cuando el filtro es anual). */
  anio: number;
  mes: number;
}

/** Trae TODAS las líneas del filtro paginando internamente con el tope del backend (100). */
async function todasLasLineas(
  sesion: SesionUsuario,
  parametros: VentasQuery,
  bd: ContextoBd | undefined,
  consultar: typeof listarVentas,
): Promise<VentaLinea[]> {
  const TOPE = 100;
  const lineas: VentaLinea[] = [];
  let pagina = 1;
  for (;;) {
    const resultado = await consultar(sesion, { ...parametros, pagina, porPagina: TOPE }, bd);
    lineas.push(...resultado.lineas);
    if (pagina >= resultado.totalPaginas) break;
    pagina += 1;
  }
  return lineas;
}

/**
 * Resuelve TODAS las líneas del filtro (paginando internamente). Corre en el HILO PRINCIPAL. Conserva
 * año/mes del filtro para el título del archivo.
 */
export async function armarDatosExcelVentas(
  sesion: SesionUsuario,
  parametros: VentasQuery,
  bd?: ContextoBd,
  deps: DepsExcelVentas = {},
): Promise<DatosExcelVentas> {
  const consultar = deps.listarVentas ?? listarVentas;
  const lineas = await todasLasLineas(sesion, parametros, bd, consultar);
  return { lineas, anio: parametros.anio, mes: parametros.mes ?? 0 };
}

/** Construye el `.xlsx` de ventas a partir de datos ya resueltos. PURO: corre en el WORKER. */
export async function construirExcelVentas(datos: DatosExcelVentas): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'CONTROL v2';
  libro.created = new Date();

  const hoja = libro.addWorksheet('Ventas', { views: [{ state: 'frozen', ySplit: 1 }] });
  hoja.columns = [
    { header: 'OP', key: 'folio', width: 10 },
    { header: 'Cliente', key: 'cliente', width: 26 },
    { header: 'Modelo', key: 'modelo', width: 16 },
    { header: 'Descripción', key: 'descripcion', width: 28 },
    { header: 'Cantidad', key: 'cantidad', width: 12 },
    { header: 'Precio', key: 'precio', width: 14 },
    { header: 'Importe', key: 'importe', width: 16 },
    { header: 'Mes', key: 'mes', width: 12 },
  ];

  // Encabezado verde de marca en negrita, texto blanco.
  const encabezado = hoja.getRow(1);
  encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB_MARCA } };
  encabezado.alignment = { vertical: 'middle' };
  for (const col of ['precio', 'importe']) {
    hoja.getColumn(col).numFmt = '#,##0.00';
  }

  let totalCantidad = 0;
  let totalImporte = 0;
  for (const l of datos.lineas) {
    totalCantidad += l.cantidad;
    totalImporte += l.importe;
    hoja.addRow({
      folio: l.folioOrden ?? '—',
      cliente: l.cliente ?? '',
      modelo: l.modelo ?? '',
      descripcion: l.descripcion ?? '',
      cantidad: l.cantidad,
      precio: l.precio,
      importe: l.importe,
      mes: `${MESES_ES[l.mes] ?? l.mes} ${l.anio}`,
    });
  }

  const filaTotal = hoja.addRow({
    cliente: 'TOTAL',
    cantidad: totalCantidad,
    importe: Math.round(totalImporte * 100) / 100,
  });
  filaTotal.font = { bold: true };

  // El título del período va como propiedad del archivo (el nombre lo pone la ruta).
  libro.title = `Ventas — ${etiquetaPeriodo(datos.anio, datos.mes)}`;

  const buffer = await libro.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Genera el `.xlsx` de ventas del período (una hoja "Ventas" con el detalle + fila total). Datos en el
 * hilo principal, libro en un worker (blindaje del event loop).
 */
export async function excelVentas(
  sesion: SesionUsuario,
  parametros: VentasQuery,
  bd?: ContextoBd,
  deps: DepsExcelVentas = {},
): Promise<{ buffer: Buffer }> {
  const datos = await armarDatosExcelVentas(sesion, parametros, bd, deps);
  return { buffer: await renderizarExcelEnWorker('excel-ventas', datos) };
}
