/**
 * Tipos del modulo de salud.
 *
 * En E1 el chequeo de salud es minimo (sin BD). En E2 se agregara la
 * verificacion de PostgreSQL/Prisma a esta misma respuesta.
 */

/** Respuesta del endpoint GET /api/health. */
export interface RespuestaSalud {
  /** Estado global del servicio. */
  estado: 'ok';
  /** Nombre del servicio que responde. */
  servicio: 'backend';
  /** Momento de la respuesta en formato ISO 8601 (UTC). */
  hora: string;
}
