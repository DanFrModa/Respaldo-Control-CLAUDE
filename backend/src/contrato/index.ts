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
  TIPOS_ARCHIVO_PROVEEDOR,
  ETIQUETAS_TIPO_ARCHIVO_PROVEEDOR,
  esquemaProveedorCrear,
  esquemaProveedorEditar,
  esquemaProveedorPatchCuerpo,
  esquemaProveedorSalida,
  esquemaProveedoresQuery,
  esquemaProveedoresPagina,
  esquemaRolProveedorSalida,
  esquemaProveedorAdjuntoCrear,
  esquemaProveedorAdjuntoSubida,
  esquemaProveedorAdjuntoSalida,
  esquemaProveedorAdjuntosLista,
  type DatosProveedorCrear,
  type DatosProveedorEditar,
  type DatosProveedorPatchCuerpo,
  type ProveedorSalida,
  type ProveedoresQuery,
  type ProveedoresPagina,
  type TipoProveedorClave,
  type TipoArchivoProveedorClave,
  type RolProveedorSalida,
  type DatosProveedorAdjuntoCrear,
  type ProveedorAdjuntoSubida,
  type ProveedorAdjuntoSalida,
  type ProveedorAdjuntosLista,
} from './esquemas/proveedor.js';

export {
  MONEDAS,
  METODOS_PAGO,
  esRfcValido,
  esClabeValida,
  type Moneda,
  type MetodoPago,
} from './esquemas/fiscal.js';

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

// ── Catálogos estructurados (F1-E2): maestros globales con relaciones (ADR-0007) ──
// NOTA (fusión de terceros, D12/R15): maquileros se eliminó como catálogo (un maquilero
// es ahora un Proveedor con sus roles de servicio).
export {
  esquemaTallaCrear,
  esquemaTallaEditar,
  esquemaTallaSalida,
  esquemaListarTallas,
  esquemaTallasPagina,
  esquemaCurvaCrear,
  esquemaCurvaEditar,
  esquemaCurvaSalida,
  esquemaCurvaTallaItemSalida,
  esquemaListarCurvas,
  esquemaCurvasPagina,
  type DatosTallaCrear,
  type DatosTallaEditar,
  type TallaSalida,
  type ListarTallas,
  type TallasPagina,
  type DatosCurvaCrear,
  type DatosCurvaEditar,
  type CurvaSalida,
  type CurvaTallaItemSalida,
  type ListarCurvas,
  type CurvasPagina,
} from './esquemas/talla.js';

export {
  TIPOS_CAMPO_CLIENTE,
  esquemaClienteCrear,
  esquemaClienteEditar,
  esquemaClienteSalida,
  esquemaListarClientes,
  esquemaClientesPagina,
  esquemaClienteCampoCrear,
  esquemaClienteCampoEditar,
  esquemaClienteCampoSalida,
  type TipoCampoClienteClave,
  type DatosClienteCrear,
  type DatosClienteEditar,
  type ClienteSalida,
  type ListarClientes,
  type ClientesPagina,
  type DatosClienteCampoCrear,
  type DatosClienteCampoEditar,
  type ClienteCampoSalida,
} from './esquemas/cliente.js';

// ── Catálogos de materiales (F1-E3): globales con relaciones (ADR-0007/ADR-0009) ──
export {
  TIPOS_COMPONENTE_TELA,
  esquemaTelaCrear,
  esquemaTelaEditar,
  esquemaTelaSalida,
  esquemaListarTelas,
  esquemaTelasPagina,
  esquemaTelaColorSalida,
  esquemaTelaColoresLista,
  esquemaTelaCategoriaCrear,
  esquemaTelaCategoriaEditar,
  esquemaTelaCategoriaSalida,
  esquemaTelasCategoriasQuery,
  esquemaTelasCategoriasPagina,
  type TipoComponenteTelaClave,
  type DatosTelaCrear,
  type DatosTelaEditar,
  type TelaSalida,
  type ListarTelas,
  type TelasPagina,
  type TelaColorSalida,
  type TelaColoresLista,
  type DatosTelaCategoriaCrear,
  type DatosTelaCategoriaEditar,
  type TelaCategoriaSalida,
  type TelasCategoriasQuery,
  type TelasCategoriasPagina,
} from './esquemas/tela.js';

export {
  esquemaAvioCrear,
  esquemaAvioEditar,
  esquemaAvioPatchCuerpo,
  esquemaAvioSalida,
  esquemaListarAvios,
  esquemaAviosPagina,
  esquemaAvioProveedorSalida,
  esquemaAvioProveedoresLista,
  type DatosAvioCrear,
  type DatosAvioEditar,
  type DatosAvioPatchCuerpo,
  type AvioSalida,
  type ListarAvios,
  type AviosPagina,
  type AvioProveedorSalida,
  type AvioProveedoresLista,
} from './esquemas/avio.js';

export {
  TIPOS_BORDADO,
  ETIQUETAS_TIPO_BORDADO,
  esquemaBordadoCrear,
  esquemaBordadoEditar,
  esquemaBordadoPatchCuerpo,
  esquemaBordadoSalida,
  esquemaBordadosQuery,
  esquemaBordadosPagina,
  esquemaBordadoFotoCrear,
  esquemaBordadoFotoSubida,
  esquemaBordadoFotoSalida,
  type TipoBordadoClave,
  type DatosBordadoCrear,
  type DatosBordadoEditar,
  type DatosBordadoPatchCuerpo,
  type BordadoSalida,
  type BordadosQuery,
  type BordadosPagina,
  type DatosBordadoFotoCrear,
  type BordadoFotoSubida,
  type BordadoFotoSalida,
} from './esquemas/bordado.js';

export { esquemaSesionActual, type SesionActual } from './esquemas/sesion.js';

export { esquemaErrorApi, type ErrorApi } from './esquemas/error.js';
