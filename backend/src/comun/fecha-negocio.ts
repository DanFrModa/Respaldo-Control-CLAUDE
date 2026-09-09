/**
 * La FECHA DE UN ACTO tal y como la va a LEER quien lo hizo, aquí en México.
 *
 * ⚠️ No es `toISOString()`. Los sellos de auditoría (`aprobadoEn`, `revisadoEn`, …) son INSTANTES,
 * el servidor corre en UTC y quien los lee vive en `-06:00`. Una firma puesta a las 18:00 de Ciudad
 * de México cae ya en el día siguiente en UTC, así que el mensaje del servidor diría un día y la
 * pantalla —que lo pinta con `toLocaleDateString('es-MX')` en el navegador— diría otro: **dos fechas
 * para el mismo acto**. Se formatea con la MISMA llamada que la pantalla, con el huso escrito a mano
 * porque el servidor no lo hereda de nadie.
 *
 * Nació en `dominio/modelos/revision-modelo.ts` (V1-E7d, arreglando exactamente ese desfase) y se
 * subió aquí en V1-E8b, cuando la invalidación de la firma del PRECIO necesitó la misma frase: una
 * segunda copia habría sido dos fechas para el mismo problema.
 */

/** Huso en el que vive el negocio (FR Moda, Ciudad de México). */
export const ZONA_DEL_NEGOCIO = 'America/Mexico_City';

/** `DD/MM/AAAA` en el huso del negocio — el mismo día que enseña la pantalla. */
export function fechaDelActo(fecha: Date): string {
  return fecha.toLocaleDateString('es-MX', { timeZone: ZONA_DEL_NEGOCIO });
}

/**
 * EL DÍA DE HOY tal como lo vive el negocio (México), en `YYYY-MM-DD`.
 *
 * El ancla de todo lo que se mide «contra hoy» en el servidor. `en-CA` da exactamente
 * `YYYY-MM-DD`, y la zona va escrita porque el servidor no la hereda de nadie: corre en UTC, así
 * que `new Date().toISOString()` a las 18:00 de México devuelve **el día siguiente**.
 *
 * Nació dentro de `dominio/inventarios/movimientos-pt.ts` (fila 0.138) para el periodo de LECTURA
 * del kardex, pasó a `periodo-kardex.ts` al generalizarse (0.173) y subió aquí en la 0.174, cuando
 * la ventana de CAPTURA de fecha —que hasta entonces se anclaba en el día UTC— tuvo que medirse
 * contra el mismo día. Tener dos anclas era tener dos «hoy»: el que decide qué se puede capturar y
 * el que decide qué se puede leer, separados seis horas cada tarde.
 *
 * `ahora` se puede inyectar para probar sin depender de la hora a la que corra la prueba.
 */
export function hoyDelNegocio(ahora: Date = new Date()): string {
  return ahora.toLocaleDateString('en-CA', { timeZone: ZONA_DEL_NEGOCIO });
}
