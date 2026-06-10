/**
 * Fábrica de `SesionUsuario` para pruebas (unit e integración).
 *
 * Vive separada de `contexto.ts` a propósito: esto NO importa `src/datos`,
 * así los tests unitarios pueden armar sesiones sin arrastrar el cliente
 * Prisma ni exigir una base de datos.
 */
import type { ClavePermiso } from '../contrato/index.js';

import type { SesionUsuario } from '../comun/permisos.js';

/**
 * Sesión de prueba con valores por defecto sensatos; cualquier campo se
 * puede sobrescribir. `permisos` acepta un arreglo por comodidad.
 *
 * @example
 * const sesion = sesionDePrueba({ permisos: ["almacenes.administrar"] });
 */
export function sesionDePrueba(
  parcial: Partial<Omit<SesionUsuario, 'permisos'>> & { permisos?: ClavePermiso[] } = {},
): SesionUsuario {
  const { permisos, ...resto } = parcial;
  return {
    id: 'usuario-prueba',
    username: 'prueba',
    nombre: 'Usuario de Prueba',
    idEmpresaActiva: 1,
    nombreEmpresaActiva: 'FR Moda SA de CV',
    permisos: new Set<ClavePermiso>(permisos ?? []),
    ...resto,
  };
}
