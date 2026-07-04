/**
 * Utilidades compartidas de las pantallas de EsMa (F6-E4). Vive aparte de los componentes para no
 * mezclar exportaciones de funciones con las de componentes (regla fast-refresh).
 */

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
