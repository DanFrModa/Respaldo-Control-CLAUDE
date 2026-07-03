/**
 * Export a EXCEL del ESTADO DE RESULTADOS MENSUAL (F7-E2; doc 06-Costos-y-EDR §4). Reusa
 * {@link calcularEdr} y {@link listarLineasEdr} (A1: la lógica NO se duplica). Genera un BUFFER con
 * `exceljs` (mismo patrón que `costos/impresos/excel-margenes.ts`): una hoja "Resumen" (P&L + cortes)
 * y una hoja "Líneas" (el detalle conciliado, a costo actual).
 */
import ExcelJS from 'exceljs';

import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';

import { calcularEdr, listarLineasEdr } from '../edr.js';

import { etiquetaPeriodo } from './comun-edr.js';

const TEAL = 'FF0D9488';

/** Dependencias inyectables (tests inyectan `calcularEdr`/`listarLineasEdr` fake). */
export interface DepsExcelEdr {
  calcularEdr?: typeof calcularEdr;
  listarLineasEdr?: typeof listarLineasEdr;
}

/** Aplica el estilo teal a la fila de encabezado. */
function estilarEncabezado(fila: ExcelJS.Row): void {
  fila.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
  fila.alignment = { vertical: 'middle' };
}

/** Genera el `.xlsx` del EDR mensual (Resumen + Líneas). */
export async function excelEdr(
  sesion: SesionUsuario,
  idEdr: number,
  bd?: ContextoBd,
  deps: DepsExcelEdr = {},
): Promise<{ buffer: Buffer }> {
  const obtenerEdr = deps.calcularEdr ?? calcularEdr;
  const obtenerLineas = deps.listarLineasEdr ?? listarLineasEdr;
  const edr = await obtenerEdr(sesion, idEdr, bd);
  const detalle = await obtenerLineas(sesion, idEdr, {}, bd);

  const libro = new ExcelJS.Workbook();
  libro.creator = 'CONTROL v2';
  libro.created = new Date();

  // ── Hoja Resumen (P&L + cortes) ────────────────────────────────────────────
  const resumen = libro.addWorksheet('Resumen');
  resumen.columns = [
    { header: 'Concepto', key: 'concepto', width: 28 },
    { header: 'Importe', key: 'importe', width: 18 },
  ];
  estilarEncabezado(resumen.getRow(1));
  resumen.getColumn('importe').numFmt = '#,##0.00';
  const periodo = etiquetaPeriodo(edr.encabezado.anio, edr.encabezado.mes);
  resumen.addRow({ concepto: `Estado de Resultados — ${periodo}` });
  resumen.addRow({ concepto: 'Ventas', importe: edr.ventas });
  resumen.addRow({ concepto: '(−) Costo (actual)', importe: edr.costo });
  resumen.addRow({
    concepto: '(=) Utilidad bruta',
    importe: Math.round((edr.ventas - edr.costo) * 100) / 100,
  });
  resumen.addRow({ concepto: '(−) Gastos', importe: edr.gastos });
  resumen.addRow({ concepto: '(−) Intereses', importe: edr.intereses });
  resumen.addRow({ concepto: '(+) Bonificaciones', importe: edr.bonificaciones });
  resumen.addRow({ concepto: '(±) Otros', importe: edr.otros });
  const filaRes = resumen.addRow({ concepto: 'Resultado', importe: edr.resultado });
  filaRes.font = { bold: true };

  resumen.addRow({});
  const encEmp = resumen.addRow({ concepto: 'Por empresa', importe: 'Ventas' });
  encEmp.font = { bold: true };
  for (const c of edr.cortesEmpresa) {
    resumen.addRow({ concepto: c.nombre, importe: c.ventas });
  }

  // ── Hoja Líneas (detalle conciliado) ───────────────────────────────────────
  const hoja = libro.addWorksheet('Líneas', { views: [{ state: 'frozen', ySplit: 1 }] });
  hoja.columns = [
    { header: 'Orden', key: 'folio', width: 10 },
    { header: 'Empresa', key: 'empresa', width: 22 },
    { header: 'Cliente', key: 'cliente', width: 24 },
    { header: 'Modelo', key: 'modelo', width: 16 },
    { header: 'Descripción', key: 'descripcion', width: 24 },
    { header: 'Cant.', key: 'cant', width: 10 },
    { header: 'Precio', key: 'precio', width: 14 },
    { header: 'Importe', key: 'importe', width: 14 },
    { header: 'Costo unit.', key: 'costoUnit', width: 14 },
    { header: 'Costo', key: 'costo', width: 14 },
    { header: 'Origen', key: 'origen', width: 12 },
  ];
  estilarEncabezado(hoja.getRow(1));
  for (const col of ['precio', 'importe', 'costoUnit', 'costo']) {
    hoja.getColumn(col).numFmt = '#,##0.00';
  }
  for (const l of detalle.lineas) {
    hoja.addRow({
      folio: l.folioOrden ?? '',
      empresa: l.empresa,
      cliente: l.cliente ?? '',
      modelo: l.modelo ?? '',
      descripcion: l.descripcion ?? '',
      cant: l.cantVendida,
      precio: l.precioVenta,
      importe: l.importe,
      costoUnit: l.sinCosto ? 'sin costo' : (l.costoUnitActual ?? ''),
      costo: l.costoActual,
      origen: l.origen,
    });
  }
  const filaTotal = hoja.addRow({
    empresa: 'TOTAL',
    cant: detalle.totalPiezas,
    importe: detalle.totalVentas,
    costo: detalle.totalCosto,
  });
  filaTotal.font = { bold: true };

  const datos = await libro.xlsx.writeBuffer();
  return { buffer: Buffer.from(datos) };
}
