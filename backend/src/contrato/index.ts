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
  esquemaUsuarioAsignarRoles,
  esquemaUsuarioCambiarContrasena,
  esquemaUsuarioSalida,
  esquemaUsuariosQuery,
  esquemaUsuariosPagina,
  type DatosUsuarioCrear,
  type DatosUsuarioEditar,
  type DatosUsuarioAsignarRoles,
  type DatosUsuarioCambiarContrasena,
  type UsuarioSalida,
  type UsuariosQuery,
  type UsuariosPagina,
} from './esquemas/usuario.js';

export {
  esquemaEmpresaCrear,
  esquemaEmpresaEditar,
  esquemaEmpresaSalida,
  esquemaConfiguracionEmpresaActualizar,
  esquemaConfiguracionEmpresaSalida,
  type DatosEmpresaCrear,
  type DatosEmpresaEditar,
  type EmpresaSalida,
  type DatosConfiguracionEmpresaActualizar,
  type ConfiguracionEmpresaSalida,
} from './esquemas/empresa.js';

export { esquemaRolSalida, type RolSalida } from './esquemas/rol.js';

// ── Catálogos (F1-E1): maestros globales (ADR-0007) ──────────────────────────
export {
  TIPOS_PROVEEDOR,
  ETIQUETAS_TIPO_PROVEEDOR,
  esquemaProveedorCrear,
  esquemaProveedorEditar,
  esquemaProveedorSalida,
  esquemaProveedoresQuery,
  esquemaProveedoresPagina,
  type DatosProveedorCrear,
  type DatosProveedorEditar,
  type ProveedorSalida,
  type ProveedoresQuery,
  type ProveedoresPagina,
  type TipoProveedorClave,
} from './esquemas/proveedor.js';

export {
  esquemaCortadorCrear,
  esquemaCortadorEditar,
  esquemaCortadorSalida,
  esquemaCortadoresQuery,
  esquemaCortadoresPagina,
  type DatosCortadorCrear,
  type DatosCortadorEditar,
  type CortadorSalida,
  type CortadoresQuery,
  type CortadoresPagina,
} from './esquemas/cortador.js';

export {
  esquemaTemporadaCrear,
  esquemaTemporadaEditar,
  esquemaTemporadaSalida,
  esquemaTemporadasQuery,
  esquemaTemporadasPagina,
  type DatosTemporadaCrear,
  type DatosTemporadaEditar,
  type TemporadaSalida,
  type TemporadasQuery,
  type TemporadasPagina,
} from './esquemas/temporada.js';

export {
  esquemaEtiquetaMarcaCrear,
  esquemaEtiquetaMarcaEditar,
  esquemaEtiquetaMarcaSalida,
  esquemaEtiquetasMarcaQuery,
  esquemaEtiquetasMarcaPagina,
  type DatosEtiquetaMarcaCrear,
  type DatosEtiquetaMarcaEditar,
  type EtiquetaMarcaSalida,
  type EtiquetasMarcaQuery,
  type EtiquetasMarcaPagina,
} from './esquemas/etiqueta-marca.js';

export {
  esquemaColorCrear,
  esquemaColorEditar,
  esquemaColorSalida,
  esquemaColoresQuery,
  esquemaColoresPagina,
  type DatosColorCrear,
  type DatosColorEditar,
  type ColorSalida,
  type ColoresQuery,
  type ColoresPagina,
} from './esquemas/color.js';

export { esquemaSesionActual, type SesionActual } from './esquemas/sesion.js';

export { esquemaErrorApi, type ErrorApi } from './esquemas/error.js';
