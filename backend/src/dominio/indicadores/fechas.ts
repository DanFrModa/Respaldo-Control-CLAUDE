/**
 * Utilidades de FECHA compartidas por los submódulos de captura de Indicadores (F7-E4:
 * productividad, fichas confiables y muestrarios). Todas las fechas de captura son de DÍA
 * (`@db.Date`); se manejan a medianoche UTC para evitar corrimientos por zona horaria.
 */
import { ErrorPermiso } from '../../comun/errores.js';
import { tienePermiso, type SesionUsuario } from '../../comun/permisos.js';

/** Convierte una fecha ISO (AAAA-MM-DD) a Date en medianoche UTC (para columnas @db.Date). */
export function fechaAUtc(fechaIso: string): Date {
  return new Date(`${fechaIso}T00:00:00.000Z`);
}

/** Hoy a medianoche UTC (base del gate de fecha libre). */
export function hoyUtc(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}

/**
 * Gate de "fecha libre" (permiso `indicadores.fecha-libre`, ex acceso #16 del viejo). Sin el
 * permiso solo se capturan fechas de los ÚLTIMOS 7 días y NO futuras (cubre los atajos
 * Hoy/Ayer/Sábado de la captura móvil). Con el permiso, cualquier fecha.
 */
export function verificarFechaCapturable(sesion: SesionUsuario, fecha: Date): void {
  if (tienePermiso(sesion, 'indicadores.fecha-libre')) return;
  const dias = (hoyUtc().getTime() - fecha.getTime()) / 86_400_000;
  if (dias < 0 || dias > 7) {
    throw new ErrorPermiso(
      'Solo puedes capturar fechas de los últimos 7 días; para otra fecha necesitas el permiso de fecha libre.',
      'indicadores.fecha-libre',
    );
  }
}
