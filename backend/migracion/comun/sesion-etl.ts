/**
 * Sesión de SISTEMA para el ETL (F1-E6).
 *
 * El ETL carga VÍA los servicios de dominio (`crear*`) — regla A1: la lógica de negocio
 * vive en `backend/src/dominio` y el ETL NO la reimplementa. Esos servicios reciben una
 * `SesionUsuario` y como PRIMER paso llaman `verificarPermiso(sesion, '...')`. Por eso el
 * ETL NO puede pasarles `null` (reventaría en `verificarPermiso`); les pasa esta sesión de
 * sistema con TODOS los permisos del catálogo.
 *
 * Sobre `creadoPorId`: las columnas de auditoría `creado_por_id`/`modificado_por_id` NO
 * tienen FK física a `usuarios` (lo documenta `schema.prisma`: "referencian usuarios SIN
 * constraint físico a propósito"). Esta sesión usa el id sentinela `'etl-sistema'`, así los
 * registros migrados quedan marcados como de origen ETL (auditable) sin necesitar un usuario
 * real. La bitácora (`registrarBitacora`) guarda ese mismo id en `id_usuario`.
 *
 * NOTA (desviación documentada del enunciado): la ficha pedía pasar `null` a los servicios;
 * como las firmas reales exigen `SesionUsuario` no-nulo (verifican permiso), se usa esta
 * sesión de sistema en su lugar. El efecto auditado es equivalente (origen identificable),
 * y NO se tocan las firmas de los servicios de dominio (carpeta de CoderFusion).
 */
import { CLAVES_PERMISO, type ClavePermiso } from '../../src/contrato/index.js';

import type { SesionUsuario } from '../../src/comun/permisos.js';

/** Id sentinela del usuario de sistema del ETL (queda en `creado_por_id`/bitácora). */
export const ID_USUARIO_ETL = 'etl-sistema';

/**
 * Construye la sesión de sistema del ETL: todos los permisos del catálogo de `src/contrato`,
 * id sentinela `etl-sistema`. `idEmpresaActiva` es la de la empresa favorita (FR Moda); los
 * catálogos de F1 son GLOBALES (sin `idEmpresa`), así que no se usa para escribir, pero la
 * `SesionUsuario` lo exige por tipo.
 */
export function sesionEtl(idEmpresaActiva = 1): SesionUsuario {
  return {
    id: ID_USUARIO_ETL,
    username: 'etl',
    nombre: 'ETL de migración (F1-E6)',
    idEmpresaActiva,
    nombreEmpresaActiva: 'FR Moda',
    permisos: new Set<ClavePermiso>(CLAVES_PERMISO),
  };
}
