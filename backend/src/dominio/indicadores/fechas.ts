/**
 * Utilidades de FECHA compartidas por los submódulos de captura de Indicadores (F7-E4:
 * productividad, fichas confiables y muestrarios). Todas las fechas de captura son de DÍA
 * (`@db.Date`); se manejan a medianoche UTC para evitar corrimientos por zona horaria.
 *
 * ⭐ La REGLA de la ventana de captura («sin la llave, sólo los últimos N días») ya NO vive aquí:
 * subió a `comun/fecha-capturable.ts` en la fila 0.171, cuando el inventario de PT necesitó la
 * misma frase con su propio permiso (`ipt.fecha-libre`). Aquí queda el envoltorio que le pone el
 * permiso de Indicadores, para que los llamadores de este módulo no cambien.
 */
import {
  hoyUtc,
  verificarFechaCapturable as verificarFechaCapturableConPermiso,
} from '../../comun/fecha-capturable.js';
import type { SesionUsuario } from '../../comun/permisos.js';

export { hoyUtc };

/** Convierte una fecha ISO (AAAA-MM-DD) a Date en medianoche UTC (para columnas @db.Date). */
export function fechaAUtc(fechaIso: string): Date {
  return new Date(`${fechaIso}T00:00:00.000Z`);
}

/**
 * Gate de "fecha libre" (permiso `indicadores.fecha-libre`, ex acceso #16 del viejo). Sin el
 * permiso solo se capturan fechas de los ÚLTIMOS 7 días y NO futuras (cubre los atajos
 * Hoy/Ayer/Sábado de la captura móvil). Con el permiso, cualquier fecha.
 */
export function verificarFechaCapturable(sesion: SesionUsuario, fecha: Date): void {
  verificarFechaCapturableConPermiso(sesion, fecha, { permiso: 'indicadores.fecha-libre' });
}
