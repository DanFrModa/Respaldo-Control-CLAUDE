/**
 * Export a EXCEL de la LISTA DE PRECIOS (F8-E4, R20a). MISMO resultado que el impreso PDF: reusa
 * `obtenerLista` (A1: la lógica no se duplica) y vuelca sus renglones a un `.xlsx`. Genera un BUFFER
 * en el servidor (mismo patrón que `excel-concentrado.ts`): la ruta solo valida permiso + Zod (exige
 * `consultas.ver-importes`, como el PDF), llama aquí y responde el binario.
 *
 * Una fila por RENGLÓN con **modelo / descripción / número del cliente / precio** (= `precioAprobado`
 * si existe, si no `precioCalculado`) + una columna de estado del renglón (aprobado / calculado).
 */
import ExcelJS from 'exceljs';

import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { obtenerLista } from '../listas-precios.js';

const TEAL = 'FF0D9488';

/** Dependencias inyectables (los tests inyectan un `obtenerLista` fake para no tocar BD). */
export interface DepsExcelListaPrecios {
  obtenerLista?: typeof obtenerLista;
}

/** Resultado del export: el buffer del `.xlsx` + el folio (para el filename). */
export interface ExcelListaPrecios {
  buffer: Buffer;
  folio: number;
}

/**
 * Genera el `.xlsx` de una lista de precios (A9: scope por empresa activa, lo impone `obtenerLista`).
 * MISMO resultado que el PDF; los precios vienen resueltos (la ruta exige `consultas.ver-importes`).
 */
export async function excelListaPrecios(
  sesion: SesionUsuario,
  idLista: number,
  bd?: ContextoBd,
  deps: DepsExcelListaPrecios = {},
): Promise<ExcelListaPrecios> {
  const obtener = deps.obtenerLista ?? obtenerLista;
  const lista = await obtener(sesion, idLista, bd);

  const libro = new ExcelJS.Workbook();
  libro.creator = 'CONTROL v2';
  libro.created = new Date();
  const hoja = libro.addWorksheet(`Lista ${lista.folio}`, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  hoja.columns = [
    { header: 'Modelo', key: 'modelo', width: 18 },
    { header: 'Descripción', key: 'descripcion', width: 32 },
    { header: 'Nº cliente', key: 'numeroCliente', width: 18 },
    { header: 'Precio', key: 'precio', width: 14 },
    { header: 'Estado', key: 'estado', width: 14 },
  ];

  const encabezado = hoja.getRow(1);
  encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
  encabezado.alignment = { vertical: 'middle' };

  for (const linea of lista.lineas) {
    const precio = linea.precioAprobado ?? linea.precioCalculado;
    const renglon = hoja.addRow({
      modelo: linea.codigoModelo,
      descripcion: linea.descripcionModelo ?? '',
      numeroCliente: linea.numeroCliente ?? '',
      precio: precio ?? '',
      estado: linea.aprobado ? 'Aprobado' : 'Calculado',
    });
    renglon.getCell('precio').numFmt = '$#,##0.00';
  }

  const datos = await libro.xlsx.writeBuffer();
  return { buffer: Buffer.from(datos), folio: lista.folio };
}
