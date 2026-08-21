/**
 * Sesión de dominio y verificación de permisos (RBAC).
 *
 * Implementa MEJORAS A4: un SOLO sistema de seguridad por roles y permisos,
 * que reemplaza a los dos del sistema viejo (niveles en cascada + arreglo
 * `PrP(50)` de accesos granulares — doc funcional 10 §4). El catálogo de
 * permisos vive en `src/contrato` (claves estables tipadas); aquí vive la
 * lógica: armar la sesión y verificar permisos en el servidor en CADA
 * operación (PLANMAESTRO §9.2).
 *
 * Uso (E3): la capa de autenticación arma la `SesionUsuario` (usuario de
 * better-auth + empresa activa + `cargarPermisosDeUsuario`) y las rutas/guards
 * llaman `verificarPermiso` (lanza) o `tienePermiso` (boolean, p. ej. para
 * pintar el menú filtrado). Los servicios de dominio vuelven a verificar su
 * propio permiso (defensa en profundidad): la pantalla esconde, el servidor decide.
 */
import { esClavePermiso, permisoApagado, type ClavePermiso } from '../contrato/index.js';

import { ErrorPermiso } from './errores.js';
import { clienteLectura, type ContextoBd } from './transaccion.js';

/**
 * Identidad y autorización vigentes de quien opera, ya resueltas a datos de
 * dominio (independiente del proveedor de autenticación). Es lo que viaja en
 * el contexto de la petición (E3) y lo que reciben TODOS los servicios de dominio.
 */
export interface SesionUsuario {
  /** Id del usuario (id de `Usuario` en BD; better-auth usa el mismo id). */
  id: string;
  /** Nombre de inicio de sesión, normalizado a minúsculas. */
  username: string;
  /** Nombre para mostrar (p. ej. en el encabezado y la bitácora). */
  nombre: string;
  /** Empresa activa de la sesión (multi-empresa explícito, MEJORAS A9). */
  idEmpresaActiva: number;
  /** Nombre de la empresa activa, para encabezados sin ir a la BD. */
  nombreEmpresaActiva: string;
  /** Permisos efectivos (unión de los permisos de todos sus roles). */
  permisos: ReadonlySet<ClavePermiso>;
}

/**
 * ¿La sesión tiene el permiso? Variante boolean para decidir qué mostrar
 * (menú, botones); NUNCA sustituye a `verificarPermiso` en el servidor.
 */
export function tienePermiso(sesion: SesionUsuario, clave: ClavePermiso): boolean {
  return sesion.permisos.has(clave);
}

/**
 * Exige un permiso; si falta, lanza `ErrorPermiso` (código `PERMISO`, que el
 * front mapea a 403). Es la ÚNICA forma en que los servicios de dominio niegan
 * acceso — no inventan sus propios mensajes de permiso.
 */
export function verificarPermiso(sesion: SesionUsuario, clave: ClavePermiso): void {
  if (!sesion.permisos.has(clave)) {
    throw new ErrorPermiso(undefined, clave);
  }
}

/**
 * Permisos efectivos de un usuario: la UNIÓN de los permisos de todos sus
 * roles (RBAC A4; reemplaza la carga del arreglo `PrP(50)` que el viejo hacía
 * en el login — doc 00 §1.1 y 10 §4). Reglas:
 *
 * - Usuario inexistente, INACTIVO o BLOQUEADO → set VACÍO (denegar por
 *   defecto: una cuenta apagada no conserva ningún acceso).
 * - Claves que estén en BD pero ya no en el catálogo de `src/contrato` se
 *   descartan: el catálogo en código es la fuente de verdad.
 * - Claves de un MÓDULO APAGADO (`contrato/modulos-apagados.ts`, V1-E3t) se
 *   descartan igual, sin importar de dónde salga la fila `RolPermiso`: rol de
 *   sistema, rol a la medida o concesión suelta. Éste es EL punto único donde
 *   el interruptor muerde — al no estar la clave en la sesión, `verificarPermiso`
 *   y los guards `conPermiso`/`conAlgunPermiso` responden 403 desde el SERVIDOR,
 *   y el frontend (que pinta menú y ruta con estos mismos permisos) esconde la
 *   opción y cierra la ruta. Las tres capas de §Post-F9.68, de un solo golpe.
 *
 * Lo llama la capa de autenticación (E3) al armar la `SesionUsuario`.
 */
export async function cargarPermisosDeUsuario(
  idUsuario: string,
  bd?: ContextoBd,
): Promise<Set<ClavePermiso>> {
  const usuario = await clienteLectura(bd).usuario.findUnique({
    where: { id: idUsuario },
    select: {
      activo: true,
      bloqueado: true,
      roles: {
        select: {
          rol: { select: { permisos: { select: { permiso: { select: { clave: true } } } } } },
        },
      },
    },
  });

  if (usuario === null || !usuario.activo || usuario.bloqueado) {
    return new Set();
  }

  const claves = usuario.roles
    .flatMap((usuarioRol) => usuarioRol.rol.permisos)
    .map((rolPermiso) => rolPermiso.permiso.clave)
    .filter(esClavePermiso)
    .filter((clave) => !permisoApagado(clave));
  return new Set(claves);
}
