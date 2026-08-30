/**
 * Export a EXCEL de la LISTA DE PRECIOS (F8-E4, R20a). MISMO resultado que el impreso PDF: reusa
 * `obtenerLista` (A1: la lógica no se duplica) y vuelca sus renglones a un `.xlsx`. Genera un BUFFER
 * en el servidor (mismo patrón que `excel-concentrado.ts`): la ruta solo valida permiso + Zod (exige
 * `consultas.ver-importes`, como el PDF), llama aquí y responde el binario.
 *
 * Una fila por RENGLÓN con **modelo / descripción / número del cliente / precio** + una columna de
 * estado del renglón.
 *
 * ⭐⭐ **V1-E8x (§Post-F9.155) — LOS DROPEADOS NO SALEN.** Mismo criterio que el PDF y la
 * cotización, con la misma función: el archivo lleva los renglones NO dropeados.
 *
 * 🔴 **V1-E8b (§Post-F9.125(c)) — SIN APROBACIÓN NO SALE ESTE ARCHIVO.** Volcaba
 * `precioAprobado ?? precioCalculado`, así que de una lista sin firmar salía un `.xlsx` con precios
 * que nadie autorizó — y un Excel se reenvía al cliente igual de fácil que un PDF. Daniel: *"si no
 * está aprobado no debería de poder bajar ni un borrador porque puede confundir al cliente"*. Hoy
 * pasa por {@link exigirRenglonesAprobados}, el MISMO guard de la cotización y del impreso.
 */
import ExcelJS from 'exceljs';

import type { ListaPreciosDetalle } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { ARGB_MARCA } from '../../../comun/impresos-estilos.js';
import { renderizarExcelEnWorker } from '../../../comun/pdf-worker.js';
import { exigirRenglonesAprobados } from '../cotizaciones.js';
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
 * `consultas.ver-importes`), EXIGE que sus renglones VIGENTES estén aprobados (§Post-F9.125(c) +
 * §Post-F9.155) y devuelve la lista **ya sin los dropeados**. Corre en el HILO PRINCIPAL.
 */
export async function armarDatosExcelListaPrecios(
  sesion: SesionUsuario,
  idLista: number,
  bd?: ContextoBd,
  deps: DepsExcelListaPrecios = {},
): Promise<ListaPreciosDetalle> {
  const obtener = deps.obtenerLista ?? obtenerLista;
  const lista = await obtener(sesion, idLista, bd);
  // §Post-F9.125(c): ni un borrador de una lista sin aprobar. Va ANTES de mandar nada al worker.
  //
  // ⭐⭐ V1-E8x (§Post-F9.155): el guard exige la firma **sólo de los vigentes** y devuelve esos
  // vigentes — y son los ÚNICOS que viajan al worker. Filtrar aquí (y no dentro del constructor del
  // libro) tiene una razón: el worker recibe una lista ya recortada, así que ni por accidente puede
  // volcar un renglón que el guard no validó.
  const vigentes = exigirRenglonesAprobados(lista.lineas, 'bajar el Excel de la lista');
  return { ...lista, lineas: vigentes };
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
    // Siempre el APROBADO: `armarDatosExcelListaPrecios` ya rechazó la lista sin firmar
    // (§Post-F9.125(c)). El `??` es la red del tipo, no un camino vivo.
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
