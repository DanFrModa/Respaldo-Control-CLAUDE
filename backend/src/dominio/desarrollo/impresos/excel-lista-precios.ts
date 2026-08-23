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

import type { ListaPreciosDetalle } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { ARGB_MARCA } from '../../../comun/impresos-estilos.js';
import { renderizarExcelEnWorker } from '../../../comun/pdf-worker.js';
import { obtenerLista } from '../listas-precios.js';

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
 * Resuelve la lista de precios (A9: scope por empresa activa, lo impone `obtenerLista`; la ruta exige
 * `consultas.ver-importes`). Corre en el HILO PRINCIPAL.
 */
export async function armarDatosExcelListaPrecios(
  sesion: SesionUsuario,
  idLista: number,
  bd?: ContextoBd,
  deps: DepsExcelListaPrecios = {},
): Promise<ListaPreciosDetalle> {
  const obtener = deps.obtenerLista ?? obtenerLista;
  return obtener(sesion, idLista, bd);
}

/** Construye el `.xlsx` de una lista de precios a partir de datos ya resueltos. PURO: en el WORKER. */
export async function construirExcelListaPrecios(lista: ListaPreciosDetalle): Promise<Buffer> {
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
  encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB_MARCA } };
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

  const buffer = await libro.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Genera el `.xlsx` de una lista de precios. MISMO resultado que el PDF. Datos en el hilo principal,
 * libro en un worker (blindaje del event loop); el folio (para el filename) sale del hilo principal.
 */
export async function excelListaPrecios(
  sesion: SesionUsuario,
  idLista: number,
  bd?: ContextoBd,
  deps: DepsExcelListaPrecios = {},
): Promise<ExcelListaPrecios> {
  const lista = await armarDatosExcelListaPrecios(sesion, idLista, bd, deps);
  const buffer = await renderizarExcelEnWorker('excel-lista-precios', lista);
  return { buffer, folio: lista.folio };
}
