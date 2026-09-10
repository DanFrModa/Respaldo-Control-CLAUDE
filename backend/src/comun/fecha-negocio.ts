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
