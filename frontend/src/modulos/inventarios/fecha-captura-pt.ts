/**
 * La VENTANA de fecha de la captura de PT (fila 0.171; el huso, fila 0.174) — el lado de la
 * pantalla.
 *
 * ⚠️ **Esto es cortesía, no la guarda.** La regla vive en el servidor
 * (`dominio/inventarios/movimientos-pt.ts` → `comun/fecha-capturable.ts`): sin el permiso
 * `ipt.fecha-libre` —el acceso #28 del sistema viejo, *«poder meter la fecha que sea en los
 * movimientos de almacen de PT»*— sólo se aceptan los últimos días y nunca una fecha futura. Aquí
 * sólo se acota el selector para no ofrecer una fecha que el servidor va a rechazar; A1: la
 * pantalla esconde, el servidor decide.
 *
 * Los DOS lados tienen que decir el mismo número: si el dominio cambia la ventana, éste se cambia
 * con él (por eso está en un solo sitio y no copiado en cada pantalla).
 */

/** Días hacia atrás que puede fechar quien NO tiene `ipt.fecha-libre` (espejo del backend). */
export const DIAS_VENTANA_CAPTURA_PT = 7;

/**
 * Huso en el que vive el negocio (FR Moda, Ciudad de México). Espejo de `ZONA_DEL_NEGOCIO` en
 * `backend/src/comun/fecha-negocio.ts`: son dos paquetes sin workspace, no se puede importar.
 *
 * ⚠️ Va ESCRITO, no se toma del navegador. Es el mismo día que usa el servidor para decidir, así
 * que un navegador puesto en otra zona —o un usuario de viaje— vería la misma ventana que aplica
 * la guarda, no una corrida.
 */
const ZONA_DEL_NEGOCIO = 'America/Mexico_City';

/**
 * Fecha de hoy en YYYY-MM-DD **del negocio** (México), igual que la compara el servidor.
 *
 * ⚠️ No es `toISOString()`. Hasta la fila 0.174 los dos lados miraban el día **UTC**, y entre las
 * 18:00 y las 23:59 de México eso es ya el día siguiente: el selector ofrecía MAÑANA como tope. El
 * servidor lo aceptaba (mismo defecto) hasta que la 0.174 ancló la guarda en el día del negocio;
 * si este espejo se hubiera quedado en UTC, la pantalla seguiría ofreciendo una fecha que ahora el
 * servidor rebota.
 */
export function hoy(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONA_DEL_NEGOCIO });
}

/** El día más viejo que acepta el servidor sin `ipt.fecha-libre`, en YYYY-MM-DD. */
export function inicioVentanaCapturaPt(): string {
  const base = Date.parse(`${hoy()}T00:00:00.000Z`);
  return new Date(base - DIAS_VENTANA_CAPTURA_PT * 86_400_000).toISOString().slice(0, 10);
}

/**
 * `min`/`max` del `<input type="date">` según la llave: con `ipt.fecha-libre`, ninguno (cualquier
 * fecha); sin ella, la ventana. Se devuelven como objeto para esparcirlo en el input y que las
 * props ni existan cuando no aplican.
 */
export function limitesFechaCapturaPt(puedeFechaLibre: boolean): { min?: string; max?: string } {
  return puedeFechaLibre ? {} : { min: inicioVentanaCapturaPt(), max: hoy() };
}
