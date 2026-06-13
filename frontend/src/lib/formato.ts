/**
 * Helpers de formato para presentar valores del API en español (es-MX). Las
 * entidades traen `creadoEn` / `modificadoEn` como cadenas ISO; estos helpers las
 * vuelven legibles para el panel de detalle (seccion "Historial"). Una fecha
 * faltante o invalida devuelve el guion largo "—" (mismo placeholder que usa la UI
 * para "sin dato").
 */

/** Placeholder de "sin dato" usado en toda la UI. */
const SIN_DATO = '—';

/** Intenta construir una fecha valida a partir de una cadena ISO (o `null`). */
function aFecha(valor: string | null | undefined): Date | null {
  if (valor === null || valor === undefined || valor === '') {
    return null;
  }
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * Formatea una fecha ISO como fecha corta es-MX (p. ej. "13 jun 2026"). Vacia o
 * invalida -> "—".
 */
export function formatearFecha(valor: string | null | undefined): string {
  const fecha = aFecha(valor);
  if (fecha === null) {
    return SIN_DATO;
  }
  return fecha.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Formatea una fecha ISO con hora es-MX (p. ej. "13 jun 2026, 14:05"). Vacia o
 * invalida -> "—".
 */
export function formatearFechaHora(valor: string | null | undefined): string {
  const fecha = aFecha(valor);
  if (fecha === null) {
    return SIN_DATO;
  }
  return fecha.toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
