/**
 * Export a EXCEL del REPORTE FISCAL del contador (F9-E5; D12/R13). MISMO resultado que la pantalla:
 * reusa {@link reporteFiscal} (A1: la lógica NO se duplica) y vuelca sus filas a un `.xlsx`. Genera un
 * BUFFER en el servidor (mismo patrón que el export del concentrado RC y los impresos PDF): la ruta
 * solo valida permiso + Zod, llama aquí y responde el binario. Trae TODAS las filas del filtro
 * (paginando internamente con el tope del backend, 100), no solo una página.
 */
import ExcelJS from 'exceljs';

import type { esquemaReporteFiscalQuery } from '../../../../contrato/index.js';
import {
  ETIQUETAS_ORIGEN_MOVIMIENTO_TERCERO,
  type ReporteFiscalFila,
  type OrigenMovimientoTerceroClave,
} from '../../../../contrato/index.js';
import type { z } from 'zod';
import type { SesionUsuario } from '../../../../comun/permisos.js';
import type { ContextoBd } from '../../../../comun/transaccion.js';

import { reporteFiscal } from '../reportes-fiscales.js';

/** Filtros del reporte (forma de ENTRADA: la ruta pasa su query ya validada, aquí se acepta amplia). */
type FiltrosReporte = z.input<typeof esquemaReporteFiscalQuery>;

const TEAL = 'FF0D9488';

/** Etiqueta legible de un origen (usa el catálogo del motor; cae al valor crudo si no lo conoce). */
function origenTexto(origen: string): string {
  return ETIQUETAS_ORIGEN_MOVIMIENTO_TERCERO[origen as OrigenMovimientoTerceroClave] ?? origen;
}

/** Dependencias inyectables (los tests inyectan un `reporteFiscal` fake para no tocar BD). */
export interface DepsExcelReporteFiscal {
  reporteFiscal?: typeof reporteFiscal;
}

/** Trae TODAS las filas del filtro paginando internamente con el tope del backend (100). */
async function todasLasFilas(
  sesion: SesionUsuario,
  parametros: FiltrosReporte,
  bd: ContextoBd | undefined,
  consultar: typeof reporteFiscal,
): Promise<{
  filas: ReporteFiscalFila[];
  totales: Awaited<ReturnType<typeof reporteFiscal>>['totales'];
}> {
  const TOPE = 100;
  // La 1ª página trae ya los totales del periodo (idénticos en cada página); las demás solo suman filas.
  const primera = await consultar(sesion, { ...parametros, pagina: 1, porPagina: TOPE }, bd);
  const filas: ReporteFiscalFila[] = [...primera.filas];
  for (let pagina = 2; pagina <= primera.totalPaginas; pagina += 1) {
    const resultado = await consultar(sesion, { ...parametros, pagina, porPagina: TOPE }, bd);
    filas.push(...resultado.filas);
  }
  return { filas, totales: primera.totales };
}

/** Resultado del export: el buffer del `.xlsx` listo para responder. */
export interface ExcelReporteFiscal {
  buffer: Buffer;
}

/** Importe a celda numérica (o '—' si está oculto por `consultas.ver-importes`). */
function celdaImporte(v: number | null): number | string {
  return v === null ? '—' : v;
}

/**
 * Genera el `.xlsx` del reporte fiscal (A9: scope por la empresa activa, ya lo impone `reporteFiscal`).
 * MISMO resultado que la pantalla; trae todos los movimientos del filtro + una fila de totales.
 */
export async function excelReporteFiscal(
  sesion: SesionUsuario,
  parametros: FiltrosReporte,
  bd?: ContextoBd,
  deps: DepsExcelReporteFiscal = {},
): Promise<ExcelReporteFiscal> {
  const consultar = deps.reporteFiscal ?? reporteFiscal;
  const { filas, totales } = await todasLasFilas(sesion, parametros, bd, consultar);

  const libro = new ExcelJS.Workbook();
  libro.creator = 'CONTROL v2';
  libro.created = new Date();
  const hoja = libro.addWorksheet('Reporte fiscal', { views: [{ state: 'frozen', ySplit: 1 }] });

  hoja.columns = [
    { header: 'Folio', key: 'folio', width: 10 },
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Cuenta', key: 'cuenta', width: 10 },
    { header: 'Tercero', key: 'tercero', width: 32 },
    { header: 'RFC', key: 'rfc', width: 16 },
    { header: 'Concepto', key: 'concepto', width: 20 },
    { header: 'UUID (CFDI)', key: 'uuid', width: 38 },
    { header: 'XML', key: 'xml', width: 6 },
    { header: 'Tipo', key: 'tipo', width: 9 },
    { header: 'Importe', key: 'importe', width: 15 },
  ];

  const encabezado = hoja.getRow(1);
  encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
  encabezado.alignment = { vertical: 'middle' };

  for (const f of filas) {
    hoja.addRow({
      folio: f.folio,
      fecha: f.fecha,
      cuenta: f.tipoTercero === 'cliente' ? 'CxC' : 'CxP',
      tercero: f.tercero,
      rfc: f.rfcTercero ?? '—',
      concepto: origenTexto(f.origen),
      uuid: f.uuidCfdi ?? '(pendiente)',
      xml: f.tieneXml ? 'Sí' : '—',
      tipo: f.esCargo ? 'Cargo' : 'Abono',
      importe: celdaImporte(f.monto),
    });
  }

  // Fila de totales del periodo (todo el filtro).
  hoja.addRow({});
  const filaTotales = hoja.addRow({
    tercero: 'Totales del periodo',
    concepto: `Cargos: ${String(celdaImporte(totales.cargos))}`,
    uuid: `Abonos: ${String(celdaImporte(totales.abonos))}`,
    tipo: 'Neto',
    importe: celdaImporte(totales.neto),
  });
  filaTotales.font = { bold: true };

  const datos = await libro.xlsx.writeBuffer();
  return { buffer: Buffer.from(datos) };
}
