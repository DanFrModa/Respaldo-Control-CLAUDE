/**
 * Export a EXCEL de COSTOS Y MÁRGENES POR PEDIDO (F7-E1; doc 06-Costos-y-EDR §5). MISMO resultado que
 * el reporte en pantalla / PDF: reusa {@link margenesPorPedido} (A1: la lógica NO se duplica) y vuelca
 * sus filas a un libro `.xlsx` con `exceljs`. Genera un BUFFER en el servidor (mismo patrón que
 * `esma/impresos/excel-estado-cuenta.ts`). Los importes/márgenes salen VACÍOS si el servicio los ocultó
 * (sin `consultas.ver-importes`).
 */
import ExcelJS from 'exceljs';

import type { esquemaMargenesQuery } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import type { z } from 'zod';

import { margenesPorPedido } from '../margenes.js';

const TEAL = 'FF0D9488';

/** Dependencias inyectables (tests inyectan `margenesPorPedido` fake). */
export interface DepsExcelMargenes {
  margenesPorPedido?: typeof margenesPorPedido;
}

/** Aplica el estilo teal a la fila de encabezado. */
function estilarEncabezado(fila: ExcelJS.Row): void {
  fila.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
  fila.alignment = { vertical: 'middle' };
}

/** Genera el `.xlsx` de márgenes por pedido (A9 + ocultamiento de importes ya en el dominio). */
export async function excelMargenes(
  sesion: SesionUsuario,
  query: z.input<typeof esquemaMargenesQuery> = {},
  bd?: ContextoBd,
  deps: DepsExcelMargenes = {},
): Promise<{ buffer: Buffer }> {
  const obtener = deps.margenesPorPedido ?? margenesPorPedido;
  const m = await obtener(sesion, query, bd);

  const libro = new ExcelJS.Workbook();
  libro.creator = 'CONTROL v2';
  libro.created = new Date();

  const hoja = libro.addWorksheet('Márgenes', { views: [{ state: 'frozen', ySplit: 1 }] });
  hoja.columns = [
    { header: 'Pedido', key: 'folio', width: 10 },
    { header: 'Cliente', key: 'cliente', width: 30 },
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Piezas', key: 'piezas', width: 10 },
    { header: 'Importe', key: 'importe', width: 14 },
    { header: 'Margen promedio', key: 'mprom', width: 16 },
    { header: 'Margen ponderado', key: 'mpond', width: 18 },
    { header: 'Margen $/pieza', key: 'mpieza', width: 16 },
  ];
  estilarEncabezado(hoja.getRow(1));

  // Los márgenes (fracción) se muestran como porcentaje en la celda.
  const pctCols = ['mprom', 'mpond'];
  for (const col of pctCols) {
    hoja.getColumn(col).numFmt = '0.0%';
  }

  for (const f of m.filas) {
    hoja.addRow({
      folio: f.folio,
      cliente: f.cliente,
      fecha: f.fechaHasta ?? '',
      piezas: f.cantidad,
      importe: f.importe ?? '',
      mprom: f.margenPromedio ?? '',
      mpond: f.margenPonderado ?? '',
      mpieza: f.margenPesosPorPieza ?? '',
    });
  }

  const filaTotal = hoja.addRow({
    folio: '',
    cliente: 'TOTAL',
    fecha: '',
    piezas: m.totalPiezas,
    importe: m.totalImporte ?? '',
    mprom: '',
    mpond: '',
    mpieza: '',
  });
  filaTotal.font = { bold: true };

  const datos = await libro.xlsx.writeBuffer();
  return { buffer: Buffer.from(datos) };
}
