/**
 * Tipos del modulo de salud.
 *
 * Desde E2 el chequeo incluye un ping ligero a PostgreSQL via Prisma
 * (`SELECT 1`): si la base no responde, el endpoint contesta 503 para que
 * Railway/Docker no manden trafico a un backend sin base.
 */

/** Estado de un componente revisado por el chequeo de salud. */
export type EstadoComponente = 'ok' | 'error';

/** Respuesta del endpoint GET /api/health. */
export interface RespuestaSalud {
  /** Estado global del servicio (`ok` solo si todos los componentes responden). */
  estado: EstadoComponente;
  /** Nombre del servicio que responde. */
  servicio: 'backend';
  /** Estado de la conexion a PostgreSQL (resultado del `SELECT 1`). */
  bd: EstadoComponente;
  /** Momento de la respuesta en formato ISO 8601 (UTC). */
  hora: string;
}
