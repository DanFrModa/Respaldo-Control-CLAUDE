/**
 * Topes de renglones para impresos PDF que listan datasets de RANGO LIBRE (blindaje general de PDFs).
 *
 * Los impresos de inventarios / concentrados / estados de cuenta pueden abarcar miles de renglones. Al
 * renderizarse con `@react-pdf/renderer` eso se traduce en miles de páginas y segundos de CPU (incidente
 * 11-jul: el impreso de Telas). Estos impresos ACOTAN cuántos renglones dibujan (`MAX_FILAS_PDF`) y
 * avisan cuando truncaron, remitiendo al export a Excel para el total. Los TOTALES del impreso siguen
 * siendo del universo COMPLETO del filtro (no del truncado) — igual que el reporte fiscal (F9-E5).
 *
 * Este helper es PURO (sin BD ni react-pdf) para poder testearse solo.
 */

/**
 * Tope por defecto de renglones dibujados en un impreso de rango libre. Cada impreso puede afinar el
 * suyo según su densidad, pero este es el punto de partida (tablas densas caben ~250 renglones sin que
 * el render se dispare).
 */
export const MAX_FILAS_PDF = 250;

/**
 * Texto del aviso de truncado, o `null` si el impreso ya muestra TODOS los renglones del filtro. Se pinta
 * cuando `total > mostrados`: el lector vería renglones que no cuadran con los totales (que sí son del
 * universo completo), así que hay que avisarlo y remitirlo al Excel.
 */
export function leyendaTruncado(mostrados: number, total: number): string | null {
  if (total <= mostrados) {
    return null;
  }
  return (
    `Se muestran ${mostrados.toLocaleString('es-MX')} de ${total.toLocaleString('es-MX')} renglones — ` +
    'acota con filtros o usa el export a Excel para el total.'
  );
}
