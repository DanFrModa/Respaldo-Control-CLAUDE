/**
 * LA VENTANA DE CAPTURA — hasta qué tan atrás puede fechar un acto quien lo captura.
 *
 * ## Por qué existe, y por qué vive en `comun/`
 *
 * En el sistema viejo, poner una fecha LIBRE a un movimiento era un privilegio con su propio
 * acceso: el #16 en Indicadores y el **#28 en el inventario de PT** (*«Poder meter la fecha que sea
 * en los movimientos de almacen de PT»*, doc `04-Inventarios`). v2 se trajo los dos permisos al
 * catálogo, pero sólo Indicadores se trajo la GUARDA — `ipt.fecha-libre` estuvo sembrado y sin un
 * solo llamador hasta la fila **0.171**.
 *
 * La regla es UNA y se escribe UNA vez: *sin la llave, sólo los últimos N días y nunca el futuro*.
 * Nació en `dominio/indicadores/fechas.ts` (F7-E4) y subió aquí en la 0.171, cuando el inventario
 * de PT necesitó exactamente la misma frase. Copiarla habría sido tener **dos ventanas de captura
 * que se pueden ir separando**, que es justo el defecto que este proyecto llama «un dato repetido
 * en N sitios».
 *
 * ## Qué NO es
 *
 * No es una guarda de pantalla. Vive en el servidor y la llaman los módulos de DOMINIO (A1): la
 * pantalla puede acotar el selector de fecha por cortesía, pero quien llame al dominio por otro
 * camino se topa con esta misma pared.
 */
import type { ClavePermiso } from '../contrato/index.js';

import { ErrorPermiso } from './errores.js';
import { tienePermiso, type SesionUsuario } from './permisos.js';

/**
 * Días hacia atrás que puede fechar quien NO tiene la llave de fecha libre.
 *
 * ⏳ **7 es el DEFAULT PROPUESTO, no una decisión del dueño.** Lo fijó F7-E4 para la captura de
 * Indicadores (cubre los atajos Hoy/Ayer/Sábado de la captura móvil) y la fila 0.171 lo adoptó
 * para el inventario de PT **por simetría**: ninguna de las dos ventanas la eligió Daniel. Si él
 * decide otra para PT, se le pasa `dias` a {@link verificarFechaCapturable} desde ese dominio y
 * ésta se queda como la de Indicadores.
 */
export const DIAS_VENTANA_CAPTURA = 7;

/** Milisegundos de un día (la ventana se mide en días completos, sobre fechas a medianoche UTC). */
const MS_POR_DIA = 86_400_000;

/**
 * Hoy a medianoche UTC — la base contra la que se mide la ventana.
 *
 * ⚠️ **SESGO CONOCIDO, heredado de F7-E4 y NO arreglado en la 0.171 (a propósito).** El ancla es el
 * día **UTC**, no el día del NEGOCIO (`ZONA_DEL_NEGOCIO`, `comun/fecha-negocio.ts`). Como México
 * va en −06:00, entre las 18:00 y las 23:59 de allá el día UTC ya avanzó, así que en esa franja:
 *  • la promesa *«nunca una fecha futura»* deja pasar el día siguiente del calendario mexicano, y
 *  • la ventana son {@link DIAS_VENTANA_CAPTURA} − 1 días de negocio completos, no N.
 *
 * Se deja como está para NO mover el comportamiento de Indicadores, que usa esta misma función
 * desde F7-E4 y no es de esta fila. Está numerado aparte. Quien lo arregle: el ancla correcta es
 * `ahora.toLocaleDateString('en-CA', { timeZone: ZONA_DEL_NEGOCIO })`, que es exactamente lo que ya
 * hace `hoyDelNegocio` en `dominio/inventarios/movimientos-pt.ts` para la ventana de LECTURA del
 * kardex — y por eso hoy ese archivo tiene dos husos, que es justo lo que aquel comentario decía
 * querer evitar.
 */
export function hoyUtc(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}

/** Opciones de la ventana: qué llave la abre y de cuántos días es. */
export interface OpcionesFechaCapturable {
  /** Permiso que deja fechar LIBRE (p. ej. `indicadores.fecha-libre`, `ipt.fecha-libre`). */
  permiso: ClavePermiso;
  /** Días hacia atrás permitidos sin ese permiso (default {@link DIAS_VENTANA_CAPTURA}). */
  dias?: number;
}

/**
 * Gate de «fecha libre»: con el permiso, cualquier fecha; sin él, sólo los últimos `dias` días y
 * NUNCA una fecha futura. `fecha` debe venir a medianoche UTC (como se guardan las columnas
 * `@db.Date`).
 */
export function verificarFechaCapturable(
  sesion: SesionUsuario,
  fecha: Date,
  opciones: OpcionesFechaCapturable,
): void {
  const { permiso, dias: ventana = DIAS_VENTANA_CAPTURA } = opciones;
  if (tienePermiso(sesion, permiso)) return;
  const dias = (hoyUtc().getTime() - fecha.getTime()) / MS_POR_DIA;
  if (dias < 0 || dias > ventana) {
    throw new ErrorPermiso(
      `Solo puedes capturar fechas de los últimos ${String(ventana)} días; para otra fecha necesitas el permiso de fecha libre.`,
      permiso,
    );
  }
}
