/**
 * Contrato — lo compartido entre front y back (plan maestro §3): catálogo
 * tipado de permisos (A4) y esquemas Zod de entrada (una sola definición de
 * reglas de captura para UI y servidor). Es la fuente del OpenAPI que se genera
 * en E3 y desde el que el frontend deriva su cliente tipado.
 */
export {
  CATALOGO_PERMISOS,
  CLAVES_PERMISO,
  MODULOS_PERMISO,
  esClavePermiso,
  permisosPorModulo,
  type ClavePermiso,
  type DefinicionPermiso,
  type ModuloPermiso,
  type OrigenAcceso,
} from './permisos.js';

export { esquemaLogin, type DatosLogin } from './esquemas/login.js';

export {
  ETIQUETAS_TIPO_ALMACEN,
  TIPOS_ALMACEN,
  esquemaAlmacenCrear,
  esquemaAlmacenEditar,
  esquemaAlmacenSalida,
  esquemaAlmacenesQuery,
  esquemaAlmacenesPagina,
  type DatosAlmacenCrear,
  type DatosAlmacenEditar,
  type AlmacenSalida,
  type AlmacenesQuery,
  type AlmacenesPagina,
  type TipoAlmacenClave,
} from './esquemas/almacen.js';

export {
  esquemaUsuarioCrear,
  esquemaUsuarioEditar,
  type DatosUsuarioCrear,
  type DatosUsuarioEditar,
} from './esquemas/usuario.js';

export { esquemaSesionActual, type SesionActual } from './esquemas/sesion.js';

export { esquemaErrorApi, type ErrorApi } from './esquemas/error.js';
