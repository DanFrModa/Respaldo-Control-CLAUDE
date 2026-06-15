import type { ModeloCodigosBarra } from '@/api/modelos';

/**
 * Nombre de archivo sugerido para la descarga del PDF de la etiqueta de un modelo (F1-E5).
 * Vive aparte del componente `EtiquetaPdf` para no romper el fast-refresh (un archivo de
 * componente debe exportar solo componentes).
 */
export function nombreArchivoEtiqueta(datos: ModeloCodigosBarra): string {
  return `etiqueta-modelo-${datos.codigoModelo}-${datos.ean13}.pdf`;
}
