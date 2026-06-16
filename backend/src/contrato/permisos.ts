/**
 * Catálogo único y TIPADO de permisos de CONTROL v2.
 *
 * Implementa la mejora **A4** (un solo sistema de seguridad RBAC) y el plan maestro §4
 * "Seguridad": el catálogo vive en código y la base de datos se sincroniza desde aquí
 * (seed de `backend/prisma`). El resto del sistema SOLO puede referirse a un permiso por su
 * {@link ClavePermiso}; nunca por id numérico ni por texto libre. Es además la fuente
 * del contrato OpenAPI (E3).
 *
 * Origen: los 38 permisos granulares reales de la tabla `Accesos` del sistema viejo
 * (doc funcional `10-Modelo-Datos-y-Usuarios.md` §4, "Sistema 2 — el vigente"),
 * transcritos de `Respaldo CLAUDE/TABLAS/Accesos.csv`, más los permisos nuevos de
 * administración que el sistema viejo resolvía por nivel (doc `00-Arranque-Login-y-Menu.md` §2).
 */

/**
 * Módulos funcionales a los que pertenece cada permiso.
 * La clave del módulo es SIEMPRE el prefijo de la clave del permiso (`modulo.accion`);
 * el valor es la etiqueta para UI (menús, pantalla de administración de roles).
 */
export const MODULOS_PERMISO = {
  ordenes: 'Órdenes de producción',
  pedidos: 'Pedidos',
  // Sub-módulo Pedidos Reales (F2-E1): los pedidos reales (liberaciones del cliente) tienen
  // su propio permiso de captura porque en el viejo eran un nivel de acceso aparte (≤60,
  // doc 02-Pedidos §3). Cuelgan del módulo Pedidos en el menú.
  'pedidos-reales': 'Pedidos reales',
  clientes: 'Clientes',
  proveedores: 'Proveedores',
  // Módulo LEGADO de F0 (solo agrupa `etiquetas.modificar`, sin uso en v2): el
  // catálogo vigente vive en el módulo `etiquetas-marca` (más abajo).
  etiquetas: 'Etiquetas de marca (legado)',
  compras: 'Órdenes de compra',
  produccion: 'Producción (corte y maquila)',
  telas: 'Inventario de telas',
  ipt: 'Inventario de producto terminado',
  esma: 'Estados de cuenta de maquileros',
  rc: 'Ruta Crítica',
  calidad: 'Control de calidad',
  indicadores: 'Indicadores',
  consultas: 'Consultas transversales',
  usuarios: 'Administración de usuarios',
  roles: 'Administración de roles',
  almacenes: 'Almacenes',
  empresas: 'Empresas',
  // ── Catálogos maestros (F1-E1, globales — ADR-0007) ────────────────────────
  // NOTA (fusión de terceros, D12/R15): el módulo `cortadores` se eliminó; el cortador
  // es un Proveedor con el rol `corte`.
  temporadas: 'Temporadas',
  'etiquetas-marca': 'Etiquetas de marca',
  colores: 'Colores',
  // ── Catálogos estructurados (F1-E2) ────────────────────────────────────────
  // `clientes` ya existe como label arriba; `tallas` es nuevo. NOTA (fusión de terceros,
  // D12/R15): el módulo `maquileros` se eliminó; el maquilero es un Proveedor con roles.
  tallas: 'Tallas y curvas',
  // ── Catálogos de materiales (F1-E3) ────────────────────────────────────────
  // `telas` ya existe arriba (Inventario de telas): la administración del CATÁLOGO de
  // telas (telas.ver/.administrar) reutiliza ese módulo; `avios` y `bordados` son nuevos.
  avios: 'Avíos',
  bordados: 'Bordados y estampados',
  // ── Modelos (Módulo 2, F1-E4) ──────────────────────────────────────────────
  modelos: 'Modelos',
} as const;

/** Clave de módulo funcional (prefijo de toda {@link ClavePermiso}). */
export type ModuloPermiso = keyof typeof MODULOS_PERMISO;

/**
 * Referencia al permiso original del sistema viejo (tabla `Accesos`).
 * Se conserva como metadato para trazabilidad y para la migración de `UsuAccesos` (F8):
 * `descripcion` es el texto EXACTO de `Accesos.Descripcion` (con su ortografía original).
 */
export interface OrigenAcceso {
  /** `Accesos.IdAccesos` (1–38) — posición que ocupaba en el arreglo `PrP()` del VBA. */
  readonly idAcceso: number;
  /** `Accesos.Formulario`: pantalla(s) del sistema viejo donde aplicaba. */
  readonly formulario: string;
  /** `Accesos.Descripcion` textual del sistema viejo. */
  readonly descripcion: string;
}

/** Definición de un permiso del catálogo. */
export interface DefinicionPermiso {
  /** Clave estable `modulo.accion` (kebab-case, sin acentos). Es LA identidad del permiso. */
  readonly clave: `${ModuloPermiso}.${string}`;
  /** Módulo funcional (siempre igual al prefijo de `clave`). */
  readonly modulo: ModuloPermiso;
  /** Descripción clara para UI (pantalla de roles/permisos). */
  readonly descripcion: string;
  /** Permiso equivalente del sistema viejo; ausente en permisos nuevos de v2. */
  readonly origen?: OrigenAcceso;
}

/**
 * Catálogo completo de permisos, agrupado por módulo.
 *
 * Los 38 con `origen` son la transcripción 1:1 de `Accesos.csv`; los 5 sin `origen`
 * son permisos nuevos de administración (A4: absorben lo que antes se decidía por
 * nivel ≤ 20, doc 00 §2 y §3.1 "botón Administración").
 */
export const CATALOGO_PERMISOS = [
  // ── Órdenes de producción ────────────────────────────────────────────────────
  {
    clave: 'ordenes.modificar',
    modulo: 'ordenes',
    descripcion: 'Modificar la orden de producción',
    origen: {
      idAcceso: 3,
      formulario: 'OrdenVer/Otras',
      descripcion: 'Poder Modificar la Orden de produccion',
    },
  },
  {
    clave: 'ordenes.precio-maquila',
    modulo: 'ordenes',
    descripcion: 'Capturar o modificar el precio de maquila',
    origen: {
      idAcceso: 4,
      formulario: 'OrdenVer',
      descripcion: 'Meter o modificar el precio de maquila',
    },
  },
  {
    clave: 'ordenes.habilitacion',
    modulo: 'ordenes',
    descripcion: 'Capturar o modificar la habilitación de la orden',
    origen: {
      idAcceso: 31,
      formulario: 'OrdenVer',
      descripcion: 'Poder meter o modificar habilitacion.',
    },
  },
  {
    clave: 'ordenes.ver-costos',
    modulo: 'ordenes',
    descripcion: 'Ver el botón de costos de la orden',
    origen: { idAcceso: 34, formulario: 'OrdenVer', descripcion: 'Ver el boton de costos' },
  },
  {
    clave: 'ordenes.ver-precio-real-maquila',
    modulo: 'ordenes',
    descripcion: 'Ver el precio real de maquila',
    origen: { idAcceso: 36, formulario: 'OrdenVer', descripcion: 'Ver Precio Real de maquila' },
  },

  // ── Pedidos ──────────────────────────────────────────────────────────────────
  {
    clave: 'pedidos.modificar',
    modulo: 'pedidos',
    descripcion: 'Modificar pedidos',
    origen: { idAcceso: 5, formulario: 'PedidosPorMes', descripcion: 'Modificar Pedidos' },
  },
  {
    clave: 'pedidos.modificar-reales',
    modulo: 'pedidos',
    descripcion: 'Modificar pedidos reales',
    origen: {
      idAcceso: 14,
      formulario: 'PedidosRealesVer',
      descripcion: 'Poder modificar pedidos reales.',
    },
  },

  // ── Pedidos (Módulo PEDIDOS, F2-E1; doc 02-Pedidos) — permisos NUEVOS de v2 ────
  // El módulo Pedidos en v2: ver (consulta), administrar (alta/edición/copiar/cancelar el
  // pedido interno) e importes (ver `precio`/totales en $). En el viejo, los importes se
  // ocultaban a nivel 45+ (doc 02 §3); aquí es un permiso RBAC propio (A4). El pedido REAL
  // (liberaciones por CEDIS) lleva su permiso de captura aparte (`pedidos-reales.administrar`),
  // como en el viejo era un acceso a nivel ≤60.
  {
    clave: 'pedidos.ver',
    modulo: 'pedidos',
    descripcion: 'Consultar pedidos internos y sus renglones',
  },
  {
    clave: 'pedidos.administrar',
    modulo: 'pedidos',
    descripcion:
      'Administrar pedidos internos: alta, edición de renglones, copiar y cancelar (suave)',
  },
  {
    clave: 'pedidos.importes',
    modulo: 'pedidos',
    descripcion: 'Ver los importes (precio por renglón y totales en $) de los pedidos',
  },
  {
    clave: 'pedidos-reales.administrar',
    modulo: 'pedidos-reales',
    descripcion:
      'Administrar pedidos reales: crear desde un pedido y capturar el seguimiento por renglón',
  },

  // ── Clientes / Proveedores ───────────────────────────────────────────────────
  {
    clave: 'clientes.modificar',
    modulo: 'clientes',
    descripcion: 'Modificar clientes (cualquiera puede agregar)',
    origen: {
      idAcceso: 6,
      formulario: 'Clientes',
      descripcion: 'Modificar Clientes (Cualquiera puede agregar)',
    },
  },
  // LEGADO (F0, de Accesos.csv): SIN uso en el código de v2. El dominio y las rutas
  // de proveedores usan solo las claves nuevas `proveedores.ver`/`.administrar` (F1-E1,
  // ver más abajo). Se conserva por trazabilidad; se consolidará al construir la
  // administración fina de roles (fase posterior). NO asignarla en seeds futuros.
  {
    clave: 'proveedores.modificar',
    modulo: 'proveedores',
    descripcion: 'Modificar información de proveedores',
    origen: {
      idAcceso: 38,
      formulario: 'Proveedores',
      descripcion: 'Poder modificar informacion de proveedores',
    },
  },

  // ── Maquileros (LEGADO de Accesos.csv) ─────────────────────────────────────────
  // NOTA (fusión de terceros, D12/R15): el catálogo `Maquilero` se eliminó (un maquilero
  // es un Proveedor con roles de servicio). Los accesos granulares 15 y 37 del sistema
  // viejo (programar maquileros / alta de asegurados) pertenecen a flujos de PRODUCCIÓN
  // (programación, EsMa) que se modelarán en sus fases (F3/F6) con su propio permiso; NO
  // son del catálogo. Se omiten aquí; el ETL de `UsuAccesos` (F8) los remapeará entonces.

  // ── Etiquetas de marca ───────────────────────────────────────────────────────
  // LEGADO (F0, de Accesos.csv; módulo `etiquetas`): SIN uso en el código de v2. El
  // dominio y las rutas del catálogo usan solo las claves nuevas
  // `etiquetas-marca.ver`/`.administrar` (F1-E1, ver más abajo). Se conserva por
  // trazabilidad; se consolidará al construir la administración fina de roles (fase
  // posterior). NO asignarla en seeds futuros.
  {
    clave: 'etiquetas.modificar',
    modulo: 'etiquetas',
    descripcion: 'Modificar las etiquetas de marca',
    origen: {
      idAcceso: 9,
      formulario: 'EtiquetasM',
      descripcion: 'Modificar las Etiquetas de Marca',
    },
  },

  // ── Órdenes de compra ────────────────────────────────────────────────────────
  {
    clave: 'compras.autorizar',
    modulo: 'compras',
    descripcion: 'Autorizar órdenes de compra',
    origen: {
      idAcceso: 8,
      formulario: 'OrdCompraProceso',
      descripcion: 'Poder autorizar Ordenes de Compra',
    },
  },

  // ── Producción (corte y maquila) ─────────────────────────────────────────────
  {
    clave: 'produccion.corte-salidas',
    modulo: 'produccion',
    descripcion: 'Capturar información de corte y salidas a maquileros',
    origen: {
      idAcceso: 32,
      formulario: 'Procesos',
      descripcion: 'Poder meter informacion de corte y salidas a maquileros',
    },
  },
  {
    clave: 'produccion.entradas-maquila',
    modulo: 'produccion',
    descripcion: 'Capturar información de entradas de maquila',
    origen: {
      idAcceso: 33,
      formulario: 'Procesos',
      descripcion: 'Poder meter informacion de entradas de maquila',
    },
  },

  // ── Inventario de telas ──────────────────────────────────────────────────────
  {
    clave: 'telas.ver-totales',
    modulo: 'telas',
    descripcion: 'Ver totales de telas e importes',
    origen: {
      idAcceso: 7,
      formulario: 'Existencia',
      descripcion: 'Ver Totales de telas e importes',
    },
  },

  // ── Inventario de producto terminado (IPT) ───────────────────────────────────
  {
    clave: 'ipt.clasificar-modelos',
    modulo: 'ipt',
    descripcion: 'Clasificar los modelos del inventario de producto terminado',
    origen: {
      idAcceso: 26,
      formulario: 'IPT_Modelos',
      descripcion: 'Poder Accesar al form (Para clasificar los modelos)',
    },
  },
  {
    clave: 'ipt.consultar-existencias',
    modulo: 'ipt',
    descripcion: 'Consultar las existencias de producto terminado',
    origen: {
      idAcceso: 27,
      formulario: 'IPT_Exis',
      descripcion: 'Poder Accesar al form (Consultar los inventarios de PT)',
    },
  },
  {
    clave: 'ipt.fecha-libre',
    modulo: 'ipt',
    descripcion: 'Capturar cualquier fecha en los movimientos de almacén de PT',
    origen: {
      idAcceso: 28,
      formulario: 'IPT_Movimientos',
      descripcion: 'Poder meter la fecha que sea en los movimientos de almacen de PT',
    },
  },
  {
    clave: 'ipt.modificar-movimientos',
    modulo: 'ipt',
    descripcion: 'Modificar movimientos del inventario de PT',
    origen: {
      idAcceso: 29,
      formulario: 'IPT_MovsLista',
      descripcion: 'Poder MODIFICAR algun movimiento del inventario de PT',
    },
  },
  {
    clave: 'ipt.cantidades-negativas',
    modulo: 'ipt',
    descripcion: 'Capturar cantidades en negativo en el inventario de PT',
    origen: {
      idAcceso: 30,
      formulario: 'IPT_Movimientos',
      descripcion: 'Poder meter cantidades en negativo al Inventario de PT',
    },
  },

  // ── Estados de cuenta de maquileros (EsMa) ───────────────────────────────────
  {
    clave: 'esma.ver-pagos',
    modulo: 'esma',
    descripcion: 'Acceder al estado de cuenta de maquileros solo para ver y registrar pagos',
    origen: {
      idAcceso: 24,
      formulario: 'EsMa_EdoCta',
      descripcion: 'Poder Accesar al form (Solo para ver y meter pagos)',
    },
  },
  {
    clave: 'esma.modificar',
    modulo: 'esma',
    descripcion: 'Hacer cualquier modificación a las cuentas de los maquileros',
    origen: {
      idAcceso: 25,
      formulario: 'EsMa_EdoCta',
      descripcion: 'Poder hacer cualquier modficacion a las cuentas de los maquileros',
    },
  },

  // ── Ruta Crítica (RC) ────────────────────────────────────────────────────────
  {
    clave: 'rc.ver-botones',
    modulo: 'rc',
    descripcion: 'Ver todos los botones de la Ruta Crítica',
    origen: { idAcceso: 1, formulario: 'OrdenVer', descripcion: 'Ver todos los botones de la RC' },
  },
  {
    clave: 'rc.fechas-retraso',
    modulo: 'rc',
    descripcion: 'Capturar fechas con más de 2 días de retraso en la RC',
    origen: {
      idAcceso: 10,
      formulario: 'RC_MeterFechas',
      descripcion: 'Se puede meter las fechas con mas de 2 dias de retrazo',
    },
  },
  {
    clave: 'rc.fecha-libre-cumplimiento',
    modulo: 'rc',
    descripcion: 'Capturar cualquier fecha en el cumplimiento de la RC',
    origen: {
      idAcceso: 35,
      formulario: 'RC_MeterDatosDet',
      descripcion: 'Poder meter la fecha que sea en el cumplimiento',
    },
  },

  // ── Control de calidad ───────────────────────────────────────────────────────
  {
    clave: 'calidad.generar-auditorias',
    modulo: 'calidad',
    descripcion: 'Generar auditorías de calidad',
    origen: {
      idAcceso: 11,
      formulario: 'CC_AltaAuditorias',
      descripcion: 'Se puedes generar auditorias',
    },
  },
  {
    clave: 'calidad.modificar-auditorias',
    modulo: 'calidad',
    descripcion: 'Modificar auditorías de calidad (en todas partes)',
    origen: {
      idAcceso: 12,
      formulario: 'CC_AltaAuditorias',
      descripcion: 'Modificar Auditorias (En Todas Partes)',
    },
  },
  {
    clave: 'calidad.actualizar-auditorias',
    modulo: 'calidad',
    descripcion: 'Actualizar auditorías de calidad (solo algunos datos)',
    origen: {
      idAcceso: 13,
      formulario: 'CC_ConsultaAuditorias',
      descripcion: 'Se pueden Actualizar las auditorias (Solo algunos datos, dando doble click)',
    },
  },

  // ── Indicadores ──────────────────────────────────────────────────────────────
  {
    clave: 'indicadores.fecha-libre',
    modulo: 'indicadores',
    descripcion: 'Capturar cualquier fecha en los formularios de indicadores',
    origen: {
      idAcceso: 16,
      formulario: 'Indicadores General',
      descripcion: 'Poder agregar la fecha que sea en varios formularios de indicadores',
    },
  },
  {
    clave: 'indicadores.ip-productividad',
    modulo: 'indicadores',
    descripcion: 'Capturar la productividad de Ingeniería del Producto',
    origen: {
      idAcceso: 17,
      formulario: 'IP_Productiv',
      descripcion: 'Poder accesar al formulario (Meter Productividad de IP)',
    },
  },
  {
    clave: 'indicadores.ip-confiabilidad',
    modulo: 'indicadores',
    descripcion: 'Evaluar la confiabilidad de fichas técnicas',
    origen: {
      idAcceso: 18,
      formulario: 'IP_ConfAgregar',
      descripcion: 'Poder accesar al formulario (Evaluar la confiabilidad de Fichas)',
    },
  },
  {
    clave: 'indicadores.ip-muestrarios',
    modulo: 'indicadores',
    descripcion: 'Capturar el avance de los muestrarios pendientes',
    origen: {
      idAcceso: 22,
      formulario: 'IP_MuesPend_Pend',
      descripcion: 'Poder Accesar al form. (Meter el avance de los muestrarios pendientes)',
    },
  },
  {
    clave: 'indicadores.ciclicos-alta',
    modulo: 'indicadores',
    descripcion: 'Dar de alta los modelos a revisar en inventarios cíclicos',
    origen: {
      idAcceso: 19,
      formulario: 'Alm_IC_Alta',
      descripcion: 'Poder accesar al form. (Dar de alta los modelos que se van a revisar)',
    },
  },
  {
    clave: 'indicadores.ciclicos-conteo',
    modulo: 'indicadores',
    descripcion: 'Capturar el conteo de inventarios cíclicos',
    origen: {
      idAcceso: 20,
      formulario: 'Alm_IC_Cont',
      descripcion: 'Poder accesar al form. (Meter la cantidad que se conto)',
    },
  },
  {
    clave: 'indicadores.ciclicos-consulta',
    modulo: 'indicadores',
    descripcion: 'Consultar los inventarios cíclicos',
    origen: {
      idAcceso: 21,
      formulario: 'Alm_IC_Consulta',
      descripcion: 'Poder Accesar al form. (Consultar los inventarios ciclicos)',
    },
  },
  {
    clave: 'indicadores.almacen-productividad',
    modulo: 'indicadores',
    descripcion: 'Capturar la productividad del almacén',
    origen: {
      idAcceso: 23,
      formulario: 'Alm_Prd_Diaria',
      descripcion: 'Poder Accesar al form. (Meter la productividad de Almacen)',
    },
  },

  // ── Consultas transversales ──────────────────────────────────────────────────
  {
    clave: 'consultas.ver-importes',
    modulo: 'consultas',
    descripcion: 'Ver importes totales y precios en las consultas',
    origen: {
      idAcceso: 2,
      formulario: 'PedidosPorMes/Otras',
      descripcion: 'Ver Importes Totales (TotalImporte) y Precios. En varias consultas',
    },
  },

  // ── Administración (nuevos en v2, sin equivalente granular en el viejo) ──────
  {
    clave: 'usuarios.administrar',
    modulo: 'usuarios',
    descripcion: 'Administrar usuarios (alta, edición, bloqueo, asignación de roles)',
  },
  {
    clave: 'roles.administrar',
    modulo: 'roles',
    descripcion: 'Administrar roles y sus permisos',
  },
  {
    clave: 'almacenes.ver',
    modulo: 'almacenes',
    descripcion: 'Consultar el catálogo de almacenes',
  },
  {
    clave: 'almacenes.administrar',
    modulo: 'almacenes',
    descripcion: 'Administrar el catálogo de almacenes (alta, edición, desactivación)',
  },
  {
    clave: 'empresas.administrar',
    modulo: 'empresas',
    descripcion: 'Administrar empresas y su configuración',
  },

  // ── Catálogos maestros (F1-E1, globales — ADR-0007; CRUD patrón Almacenes) ───
  // Cada catálogo tiene `ver` (consulta) y `administrar` (alta/edición/des-reactivación).
  // No tienen equivalente granular en el viejo: eran tablas planas sin control de acceso
  // propio (lo regía el nivel). En v2 son permisos RBAC nuevos (A4).
  {
    clave: 'proveedores.ver',
    modulo: 'proveedores',
    descripcion: 'Consultar el catálogo de proveedores',
  },
  {
    clave: 'proveedores.administrar',
    modulo: 'proveedores',
    descripcion: 'Administrar el catálogo de proveedores (alta, edición, desactivación)',
  },
  {
    clave: 'temporadas.ver',
    modulo: 'temporadas',
    descripcion: 'Consultar el catálogo de temporadas',
  },
  {
    clave: 'temporadas.administrar',
    modulo: 'temporadas',
    descripcion: 'Administrar el catálogo de temporadas (alta, edición, desactivación)',
  },
  {
    clave: 'etiquetas-marca.ver',
    modulo: 'etiquetas-marca',
    descripcion: 'Consultar el catálogo de etiquetas de marca',
  },
  {
    clave: 'etiquetas-marca.administrar',
    modulo: 'etiquetas-marca',
    descripcion: 'Administrar el catálogo de etiquetas de marca (alta, edición, desactivación)',
  },
  {
    clave: 'colores.ver',
    modulo: 'colores',
    descripcion: 'Consultar el catálogo de colores',
  },
  {
    clave: 'colores.administrar',
    modulo: 'colores',
    descripcion: 'Administrar el catálogo de colores (alta, edición, desactivación)',
  },

  // ── Catálogos estructurados (F1-E2, globales — ADR-0007; CRUD patrón Almacenes) ─
  // Tallas/curvas (D4) y clientes con campos de referencia (D7). Como los catálogos de
  // F1-E1: `ver` (consulta) y `administrar` (alta/edición/des-reactivación).
  // NOTA (fusión de terceros, D12/R15): el catálogo `maquileros` y sus permisos se
  // eliminaron (un maquilero es un Proveedor con roles → `proveedores.*`). El catálogo
  // `tipos-proceso` (que se conserva para la Ruta Crítica, F5) ya no tiene selector ni
  // permiso propio; su ABM se definirá en F5.
  {
    clave: 'tallas.ver',
    modulo: 'tallas',
    descripcion: 'Consultar el catálogo de tallas y curvas',
  },
  {
    clave: 'tallas.administrar',
    modulo: 'tallas',
    descripcion: 'Administrar el catálogo de tallas y curvas (alta, edición, desactivación)',
  },
  {
    clave: 'clientes.ver',
    modulo: 'clientes',
    descripcion: 'Consultar el catálogo de clientes',
  },
  {
    clave: 'clientes.administrar',
    modulo: 'clientes',
    descripcion:
      'Administrar el catálogo de clientes y sus campos de referencia (alta, edición, desactivación)',
  },

  // ── Catálogos de materiales (F1-E3, globales — ADR-0007/ADR-0009; CRUD patrón Almacenes) ─
  // Telas unificadas (D5) con sus colores, avíos (R1) con sus proveedores y bordados (R2)
  // con foto. Como los catálogos de F1-E1/E2: `ver` (consulta) y `administrar`
  // (alta/edición/des-reactivación). Las CATEGORÍAS de tela y los PROVEEDORES de un avío
  // NO tienen permiso propio: se gobiernan con `telas.administrar` / `avios.administrar`
  // (mismo criterio de sub-catálogo embebido sin permiso propio).
  {
    clave: 'telas.ver',
    modulo: 'telas',
    descripcion: 'Consultar el catálogo de telas y sus colores',
  },
  {
    clave: 'telas.administrar',
    modulo: 'telas',
    descripcion:
      'Administrar el catálogo de telas, sus categorías y colores (alta, edición, desactivación)',
  },
  {
    clave: 'avios.ver',
    modulo: 'avios',
    descripcion: 'Consultar el catálogo de avíos',
  },
  {
    clave: 'avios.administrar',
    modulo: 'avios',
    descripcion:
      'Administrar el catálogo de avíos y sus proveedores (alta, edición, desactivación)',
  },
  {
    clave: 'bordados.ver',
    modulo: 'bordados',
    descripcion: 'Consultar el catálogo de bordados y estampados',
  },
  {
    clave: 'bordados.administrar',
    modulo: 'bordados',
    descripcion:
      'Administrar el catálogo de bordados y estampados, incluida su foto (alta, edición, desactivación)',
  },

  // ── Modelos (Módulo 2, F1-E4, global — ADR-0007; doc 01-Modelos) ────────────
  // El catálogo de productos con su receta/BOM (telas/avíos/bordados) y sus fotos. Como
  // los catálogos de F1: `ver` (consulta) y `administrar` (alta/edición/des-reactivación,
  // BOM y fotos). El selector de Género (`GET /api/generos`) se gobierna con `modelos.ver`
  // (no tiene permiso propio: mismo criterio de sub-catálogo selector que RolProveedor).
  {
    clave: 'modelos.ver',
    modulo: 'modelos',
    descripcion: 'Consultar el catálogo de modelos, su receta (BOM) y sus fotos',
  },
  {
    clave: 'modelos.administrar',
    modulo: 'modelos',
    descripcion:
      'Administrar el catálogo de modelos: ficha, BOM (telas/avíos/bordados) y fotos (alta, edición, desactivación)',
  },
  // ── Generador de códigos de barra (F1-E5, Módulo 1 del viejo → form `Codigo`) ─
  // Permiso de SOLO LECTURA: generar/ver/imprimir el EAN-13 y DUN-14 de un modelo para la
  // empresa activa (prefijo de `Empresa.upc`). Es una sub-función del módulo Modelos
  // (misma fila que `modelos.ver`); no muta datos. Como es de lectura, los roles que ven
  // modelos lo heredan (el seed lo incluye salvo donde se restrinja explícitamente).
  {
    clave: 'modelos.codigos-barra',
    modulo: 'modelos',
    descripcion: 'Generar y descargar los códigos de barra (EAN-13 / DUN-14) de un modelo',
  },
] as const satisfies readonly DefinicionPermiso[];

/**
 * Unión de literales con TODAS las claves de permiso válidas.
 * El resto del sistema (servicios de dominio, rutas REST, UI) solo puede referirse
 * a un permiso mediante este tipo — un typo es error de compilación.
 */
export type ClavePermiso = (typeof CATALOGO_PERMISOS)[number]['clave'];

/** Todas las claves del catálogo, en el orden del catálogo. */
export const CLAVES_PERMISO: readonly ClavePermiso[] = CATALOGO_PERMISOS.map((p) => p.clave);

/** Type guard: valida en runtime que un string sea una {@link ClavePermiso} del catálogo. */
export function esClavePermiso(valor: string): valor is ClavePermiso {
  return (CLAVES_PERMISO as readonly string[]).includes(valor);
}

/**
 * Catálogo agrupado por módulo (para la pantalla de administración de roles y
 * para armar menús por permisos). Solo incluye módulos con al menos un permiso.
 */
export function permisosPorModulo(): ReadonlyMap<ModuloPermiso, readonly DefinicionPermiso[]> {
  const grupos = new Map<ModuloPermiso, DefinicionPermiso[]>();
  for (const permiso of CATALOGO_PERMISOS) {
    const grupo = grupos.get(permiso.modulo);
    if (grupo) {
      grupo.push(permiso);
    } else {
      grupos.set(permiso.modulo, [permiso]);
    }
  }
  return grupos;
}
