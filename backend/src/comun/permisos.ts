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
import { esClavePermiso, type ClavePermiso } from '../contrato/index.js';

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
  /**
   * ⭐ ¿Esta PERSONA puede CORREGIR movimientos SIN FACTURA? (fila 0.145, `Usuario.puedeCorregirSinFactura`).
   *
   * No es un permiso y NO se comporta como uno: no está en el catálogo de `ClavePermiso`, ningún rol
   * la otorga y ninguna pantalla la asigna. Viaja en la sesión —igual que la empresa activa— porque
   * el DOMINIO tiene que poder exigirla (A1), no sólo la ruta. Ver {@link verificarCorrectorSinFactura}.
   */
  puedeCorregirSinFactura: boolean;
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
 * ⭐⭐ Exige la BANDERA de corrección de movimientos SIN FACTURA (fila 0.145). Lanza `ErrorPermiso`
 * (403) si la persona no la tiene.
 *
 * DANIEL (6-sep-2026, §Post-F9.203): *«Quiero tener manera de modificar cualquier registro que se
 * meta en cualquier estado de cuenta de los proveedores sin factura. **Sólo yo. Nadie más ni con
 * permiso. Sólo yo.»***
 *
 * 🔴 POR QUÉ NO ES UN PERMISO, y por qué esto vive aquí y no en una ruta:
 *  • *«ni con permiso»* descarta crear un `cxp.corregir` asignable: un permiso existe para
 *    repartirse, y éste no se reparte.
 *  • Reusar `roles.administrar` (o cualquier permiso de admin) como interruptor de «es el dueño» es
 *    EXACTAMENTE el defecto que Daniel señaló en la fila 0.120: un permiso que gobierna el gobierno
 *    del sistema acabó decidiendo cinco cosas que no tenían que ver con él.
 *  • El precedente de la casa para «una capacidad de la PERSONA» es `Usuario.esAuditor`. Ésta va un
 *    paso más allá: `esAuditor` sí se asigna desde Administración de perfiles; ésta **no se asigna
 *    desde ningún lado**, sólo por base de datos.
 *  • Y va en el DOMINIO (A1) porque la pantalla esconde pero el servidor decide: quien llame al
 *    dominio por otro camino —otra ruta, un script, una composición futura— topa con la misma pared.
 */
export function verificarCorrectorSinFactura(sesion: SesionUsuario): void {
  if (!sesion.puedeCorregirSinFactura) {
    throw new ErrorPermiso(
      'Corregir un movimiento sin factura está reservado a la dirección: no se otorga con ningún ' +
        'permiso ni desde ninguna pantalla.',
    );
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
    .filter(esClavePermiso);
  return new Set(claves);
}
