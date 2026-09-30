/**
 * EL DÍA DEL NEGOCIO, EN UN SOLO SITIO.
 *
 * Espejo de `backend/src/comun/fecha-negocio.ts`: son dos paquetes sin workspace, así que la zona no
 * se puede importar del backend — pero sí tiene que estar escrita **una vez** de este lado, y éste
 * es ese sitio. Lo estrenó la ventana de captura de PT (fila 0.174) y lo comparte cualquier pantalla
 * que necesite «hoy» para proponerlo o para acotar un selector.
 */

/**
 * Huso en el que vive el negocio (FR Moda, Ciudad de México).
 *
 * ⚠️ Va ESCRITO, no se toma del navegador. Es el mismo día que usa el servidor para decidir, así
 * que un navegador puesto en otra zona —o un usuario de viaje— ve la misma fecha que aplica la
 * guarda, no una corrida.
 */
export const ZONA_DEL_NEGOCIO = 'America/Mexico_City';

/**
 * Fecha de hoy en YYYY-MM-DD **del negocio** (México), igual que la compara el servidor.
 *
 * ⚠️ No es `toISOString()`. Hasta la fila 0.174 los dos lados miraban el día **UTC**, y entre las
 * 18:00 y las 23:59 de México eso es ya el día siguiente: el selector ofrecía MAÑANA como tope. El
 * servidor lo aceptaba (mismo defecto) hasta que la 0.174 ancló la guarda en el día del negocio.
 * ⇒ Un campo que proponga «hoy» con `toISOString()` propone **mañana** media tarde en adelante, que
 * es justo lo contrario de lo que se le pidió (fila 0.216: *«por default que dé la fecha de hoy»*).
 */
export function hoy(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONA_DEL_NEGOCIO });
}
