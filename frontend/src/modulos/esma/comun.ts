/**
 * Utilidades compartidas de las pantallas de EsMa (F6-E4). Vive aparte de los componentes para no
 * mezclar exportaciones de funciones con las de componentes (regla fast-refresh).
 */
import type { EsMaPendienteRevision } from '@/api/tipos';

/**
 * Formatea un importe en pesos (o "—" si es `null`). El backend devuelve `null` cuando el usuario
 * NO tiene `consultas.ver-importes`, así que "—" es el ocultamiento de importes.
 */
export function moneda(monto: number | null): string {
  if (monto === null) {
    return '—';
  }
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);
}

/**
 * ¿Hay algo capturado esperando revisión? (V1, fila 0.115). Lo decide el CONTEO de partidas que
 * manda el servidor, no los importes: dos partidas pueden netear cero —un abono y un pago iguales, o
 * dos abonos de +500 y −500 como los que carga el ETL— y seguir siendo dos cosas que alguien tiene
 * que decidir. Por eso `partidas` NO se oculta aunque los importes sí: sin ver el dinero se sigue
 * sabiendo que hay algo pendiente. Es exactamente el mismo criterio que usa el backend
 * (`dominio/esma/formula-saldo.ts::hayPendiente`) y el que decide qué filas trae el tablero.
 */
export function hayPendienteDeRevision(p: EsMaPendienteRevision): boolean {
  return p.partidas > 0;
}

/** «1 partida» / «3 partidas» — el conteo con su sustantivo, que se repite en varias pantallas. */
export function partidas(n: number): string {
  return `${String(n)} ${n === 1 ? 'partida' : 'partidas'}`;
}

/**
 * TEXTO de un bloque «por revisar» (V1, fila 0.115) — el mismo en el tablero de EsMa y en la bandeja
 * de CxP, escritorio y móvil. Lleva SIEMPRE el CONTEO de partidas, y el importe sólo cuando se puede
 * ver. Las dos mitades hacen falta:
 *
 *  • sin el conteo, quien no tiene `consultas.ver-importes` vería un «—» y no sabría que hay algo
 *    esperando decisión (el servidor oculta el neto, nunca `partidas`);
 *  • sin el importe no se sabe de cuánto se habla; y sin el conteo, dos partidas que NETEAN cero —un
 *    abono y un pago capturados iguales, o los ±500 que carga el ETL— se leerían como «$0.00», o sea
 *    como si no hubiera nada que revisar. Justo lo que esta fila vino a destapar.
 *
 * Se llama sólo cuando {@link hayPendienteDeRevision} dice que sí (si no, la celda va vacía).
 */
export function textoPorRevisar(p: Pick<EsMaPendienteRevision, 'neto' | 'partidas'>): string {
  return p.neto === null ? partidas(p.partidas) : `${moneda(p.neto)} · ${partidas(p.partidas)}`;
}

/**
 * Valores iniciales de "Duplicar partida" (F6-E5): viajan por el `state` del router hacia las
 * pantallas de captura de abono/descuento/pago para pre-llenar el formulario con la partida origen.
 * Al guardar se crea un movimiento NUEVO e independiente.
 */
export interface PartidaInicial {
  idMaquilero?: number;
  monto?: string;
  conFactura?: '' | 'con' | 'sin';
  observaciones?: string;
}

/** Fecha de hoy en formato YYYY-MM-DD (default de los campos fecha). */
export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Lunes (inicio de semana ISO) de la fecha dada, en YYYY-MM-DD. */
export function inicioSemana(fecha: Date): string {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  const dia = d.getUTCDay(); // 0=domingo … 6=sábado
  const desplazamiento = dia === 0 ? -6 : 1 - dia; // al lunes
  d.setUTCDate(d.getUTCDate() + desplazamiento);
  return d.toISOString().slice(0, 10);
}

/** Domingo (fin de semana ISO) a partir del lunes en YYYY-MM-DD. */
export function finSemana(inicioISO: string): string {
  const d = new Date(`${inicioISO}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}
