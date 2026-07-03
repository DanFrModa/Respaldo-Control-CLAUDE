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
  // Costos y márgenes (Módulo 6, F7-E1) — costo real por orden + márgenes por pedido (ex nivel ≤30,
  // menú 6). El PRE-COSTO tiene su propio módulo (`precostos`, ex nivel ≤45, accesible desde Modelos).
  costos: 'Costos y márgenes',
  precostos: 'Pre-costos',
  // Estado de Resultados (EDR, Módulo 6, F7-E2) — el P&L mensual consolidado. Módulo financiero
  // propio (ex nivel ≤30, menú 6.2), separado de `costos` porque tiene su propio flujo (generar mes
  // + conciliar ventas). Se reparte a los MISMOS roles que `costos` (directivo/dirección/admin).
  edr: 'Estado de resultados',
  indicadores: 'Indicadores',
  consultas: 'Consultas transversales',
  usuarios: 'Administración de usuarios',
  roles: 'Administración de roles',
  // Administración transversal del sistema (F6-E1): la consulta de la bitácora (lectura del
  // motor A7). No tenía equivalente granular en el viejo (lo regía el nivel).
  admin: 'Administración del sistema',
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
  // ── Producción / WIP (Módulo 4, F3) ────────────────────────────────────────
  // Catálogo de tipos de proceso de maquila (F3-E1): hasta F3 solo se sembraba; E1 le da CRUD.
  // Su consumidor real (la RC) llega en F5; aquí es un catálogo administrable más.
  'tipos-proceso': 'Tipos de proceso',
  // Inventario de PRODUCTO TERMINADO operable por kardex (F3-E3). `ipt` (arriba) son los accesos
  // granulares LEGADO del viejo; `inventario-pt` es el módulo NUEVO del kardex de v2 (D3).
  'inventario-pt': 'Inventario de producto terminado (kardex)',
  // ── Inventario de TELAS y AVÍOS operable por kardex (Módulo 4, F4-E1, D5/R4) ──
  // `telas` (arriba) son los accesos granulares LEGADO del viejo (incl. el ex-acceso #7
  // `telas.ver-totales`, que oculta importes); `inventario-telas`/`inventario-avios` son los
  // módulos NUEVOS del kardex de materiales de v2 (D3). Mismo esquema ver/mover que `inventario-pt`.
  'inventario-telas': 'Inventario de telas (kardex)',
  'inventario-avios': 'Inventario de avíos (kardex)',
  // ── Notas de salida estructuradas (Módulo 5, F4-E5, R4/R9) ──
  // El documento de envío de materiales a un maquilero contra una orden de producción.
  notas: 'Notas de salida',
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

  // ── Órdenes de producción (Módulo ÓRDENES, F2-E2; doc 03-Produccion) — permisos NUEVOS de v2 ──
  // El módulo Órdenes en v2: ver (consulta), administrar (alta desde un renglón de pedido,
  // edición del encabezado, captura de la matriz colores/tallas, copiar matriz, referencias y
  // comentarios) y cancelar (cancelación suave con motivo). Igual reparto que Pedidos: ver es
  // lectura, administrar muta, y cancelar es su propio permiso (acción crítica e irreversible).
  // Los permisos LEGADOS `ordenes.modificar`/`.precio-maquila`/etc. (arriba, de Accesos.csv)
  // pertenecen a sub-funciones (precio de maquila, costos, habilitación) que se modelarán en sus
  // fases (F3/F6); NO se reutilizan para el CRUD nuevo de la orden.
  {
    clave: 'ordenes.ver',
    modulo: 'ordenes',
    descripcion: 'Consultar órdenes de producción, su matriz, referencias y comentarios',
  },
  {
    clave: 'ordenes.administrar',
    modulo: 'ordenes',
    descripcion:
      'Administrar órdenes de producción: alta desde un pedido, edición, matriz (colores/tallas), copiar, referencias y comentarios',
  },
  {
    clave: 'ordenes.cancelar',
    modulo: 'ordenes',
    descripcion: 'Cancelar (suave) una orden de producción con su motivo',
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
  // Permisos NUEVOS de v2 (F4-E2, A4): el CRUD de la orden de compra. `ver` (consulta),
  // `administrar` (alta/edición/duplicado) y `cancelar` (cancelación suave con motivo). La
  // autorización tiene su permiso propio LEGADO (`compras.autorizar`, arriba). La edición de una
  // OC YA autorizada queda reservada al admin (decisión (a)): el dominio usa `roles.administrar`
  // como marcador de admin (mismo criterio que `generaEntradaPt` de tipos-proceso, F3-E1).
  {
    clave: 'compras.ver',
    modulo: 'compras',
    descripcion: 'Consultar órdenes de compra',
  },
  {
    clave: 'compras.administrar',
    modulo: 'compras',
    descripcion: 'Crear y editar órdenes de compra (y duplicarlas a un borrador nuevo)',
  },
  {
    clave: 'compras.cancelar',
    modulo: 'compras',
    descripcion: 'Cancelar (suave, con motivo) órdenes de compra',
  },
  // Permiso NUEVO de v2 (F4-E3, A4): RECIBIR material contra una OC autorizada (recepción que
  // crea el lote de tela y mueve el kardex de telas/avíos) y REVERSAR una recepción (inverso
  // auditado, D3). Se da a quien administra compras (mismo reparto que `compras.administrar`).
  {
    clave: 'compras.recibir',
    modulo: 'compras',
    descripcion:
      'Recibir material contra una OC autorizada (recepción + entrada al kardex) y reversar recepciones (F4-E3)',
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
  // Catálogo configurable de la Ruta Crítica (Módulo 8, F5-E1, A4) — permisos NUEVOS de v2.
  // Gobiernan el "corazón configurable": el catálogo de procesos, sus roles responsables (N:M),
  // las dependencias (DAG) y los checklists. Mismo reparto que un catálogo maestro: `ver`
  // (consulta) y `administrar` (alta/edición/des-reactivación + roles + dependencias + checklist).
  // Los `rc.*` LEGADO de arriba (ver-botones/fechas-retraso/fecha-libre-cumplimiento) son del
  // MOTOR de la RC (instancias por orden, E2+); NO se reutilizan para el catálogo configurable.
  {
    clave: 'rc.catalogo-ver',
    modulo: 'rc',
    descripcion: 'Consultar el catálogo de procesos, dependencias y checklists de la Ruta Crítica',
  },
  {
    clave: 'rc.catalogo-administrar',
    modulo: 'rc',
    descripcion:
      'Administrar procesos, roles responsables, dependencias y checklists de la Ruta Crítica',
  },
  // Motor de la RUTA VIVA por orden (Módulo 8, F5-E3, A4) — permisos NUEVOS de v2. Gobiernan la
  // programación (generar/re-generar/ajustar la ruta de una orden) y su consulta. Son OPERATIVOS
  // (producción/IP los usa día a día): cascadean a los roles como los `produccion.*`, no se restan a
  // los bajos. Distintos del catálogo configurable (`rc.catalogo-*`, que define las plantillas).
  {
    clave: 'rc.programar',
    modulo: 'rc',
    descripcion:
      'Programar (generar/re-generar) y ajustar la Ruta Crítica de una orden de producción (F5-E3)',
  },
  {
    clave: 'rc.ruta-ver',
    modulo: 'rc',
    descripcion:
      'Consultar la Ruta Crítica viva de una orden (procesos, duraciones, fechas) (F5-E3)',
  },
  // Captura de avance de la RUTA VIVA por orden (Módulo 8, F5-E4, A4) — permiso NUEVO de v2. Gobierna
  // marcar/revertir la fecha REAL de cumplimiento de un proceso y los ítems de su checklist. Es
  // OPERATIVO (producción/IP lo usa día a día); cascadea a los roles como `rc.programar`/`produccion.*`.
  // Además, el dominio exige que ALGUNO de los roles del usuario sea responsable del proceso
  // (`ProcesoDefRol`, N:M); el admin (`roles.administrar`) captura cualquier proceso.
  {
    clave: 'rc.capturar',
    modulo: 'rc',
    descripcion:
      'Capturar (o revertir) el cumplimiento de los procesos de la Ruta Crítica de una orden y su checklist (F5-E4)',
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
  // Calidad — base configurable (Módulo 8, F6-E1, A4) — permisos NUEVOS de v2. Gobiernan el
  // catálogo de defectos enriquecido, los tipos de producto y el motor de planes AQL. Mismo
  // reparto que un catálogo maestro: `ver` (consulta) y `administrar-catalogo` (alta/edición/
  // des-reactivación de defectos, tipos de producto y planes). Los `calidad.*-auditorias`
  // LEGADO (arriba, de Accesos.csv) son del NÚCLEO de auditorías (F6-E2+); NO se reutilizan
  // para el catálogo configurable.
  {
    clave: 'calidad.ver',
    modulo: 'calidad',
    descripcion: 'Consultar el catálogo de defectos, tipos de producto y planes de muestreo AQL',
  },
  {
    clave: 'calidad.administrar-catalogo',
    modulo: 'calidad',
    descripcion:
      'Administrar el catálogo de defectos, tipos de producto y planes AQL (alta, edición, desactivación)',
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
  // Tableros directivos de indicadores (Módulo Indicadores, F7-E3, A4) — permiso NUEVO de v2. Gobierna
  // los 3 TABLEROS calculados en segundo plano (KPIs de Ruta Crítica/D11, calidad por maquilero/F6,
  // WIP analítico/F3). Es de DIRECCIÓN/GERENCIA (los `indicadores.*` legado de arriba son CAPTURA de
  // productividad/cíclicos, operativos): se reparte como los tableros directivos → Administrador,
  // AdministracionDireccion, Directivo y Gerencial (a diferencia de `costos.ver`/`edr.ver`, que
  // Gerencial NO tiene por ser financieros; estos KPIs no revelan costos ni precios).
  {
    clave: 'indicadores.ver',
    modulo: 'indicadores',
    descripcion: 'Consultar los tableros directivos de indicadores (Ruta Crítica, calidad y WIP)',
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

  // ── Costos y márgenes (Módulo 6, F7-E1; doc 06-Costos-y-EDR) — permisos NUEVOS de v2 ──────
  // El módulo financiero de costeo. `costos.ver` (consultar costos de orden, lista de costos y
  // márgenes por pedido) y `costos.capturar` (guardar/ajustar el costo de una orden) absorben el
  // nivel ≤30 (menú 6 Costos era Directivo). `precostos.consultar` absorbe el nivel ≤45 (la pantalla
  // `PreCostos`, accesible también desde MODELOS). Para OCULTAR los importes/precios ($) en las
  // pantallas que el usuario sí ve, se REUSA `consultas.ver-importes` (ex acceso #2, transversal) —
  // no se crea un permiso de importes propio (F2 ya lo tenía). La lista de precios sí es del pre-costo.
  {
    clave: 'costos.ver',
    modulo: 'costos',
    descripcion:
      'Consultar el costo real de una orden, la lista de costos y los márgenes por pedido (menú Costos, nivel ≤30)',
  },
  {
    clave: 'costos.capturar',
    modulo: 'costos',
    descripcion: 'Capturar o ajustar el costo real de una orden de producción (nivel ≤30)',
  },
  {
    clave: 'precostos.consultar',
    modulo: 'precostos',
    descripcion:
      'Consultar el pre-costo (estimado) de un modelo y la lista de precios sugeridos (nivel ≤45)',
  },

  // ── Estado de Resultados (EDR, Módulo 6, F7-E2; doc 06-Costos-y-EDR §4) — permisos NUEVOS de v2 ──
  // El P&L mensual consolidado, valuado a costo ACTUAL (D1). `edr.ver` (consultar el EDR por mes/año)
  // y `edr.capturar` (capturar el encabezado global, generar el mes desde las entregas y conciliar/
  // ajustar sus líneas) absorben el nivel ≤30 (menú 6.2 EDR era Directivo). Todo el EDR es financiero
  // → no se ocultan columnas por `consultas.ver-importes` (a diferencia de costos): el módulo entero
  // se protege con `edr.ver`. Mismo reparto por rol que `costos.ver`/`costos.capturar`.
  {
    clave: 'edr.ver',
    modulo: 'edr',
    descripcion:
      'Consultar el estado de resultados mensual y anual (ventas, costo actual y resultado) (nivel ≤30)',
  },
  {
    clave: 'edr.capturar',
    modulo: 'edr',
    descripcion:
      'Capturar el encabezado, generar y conciliar las líneas del estado de resultados (nivel ≤30)',
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
  // Consulta de la BITÁCORA del sistema (F6-E1, A4/A7) — permiso NUEVO de v2. F0 entregó el motor
  // de auditoría A7 SOLO como escritura (sin endpoint de lectura); E1 agrega el GET de bitácora y
  // su pantalla de consulta para que la administración pueda auditar los cambios sin SQL. Lo regía
  // el nivel en el viejo (no era un acceso granular).
  {
    clave: 'admin.ver-bitacora',
    modulo: 'admin',
    descripcion: 'Consultar la bitácora de cambios del sistema (auditoría A7)',
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

  // ── Producción / WIP (Módulo 4, F3 — doc 03-Produccion) ──────────────────────
  // Permisos NUEVOS de v2 (A4). El esquema y motor nacen en F3-E1; los flujos que cada permiso
  // gobierna se construyen en E2 (corte/envío), E4 (recibo/cargo) y E5 (entrega/WIP). El catálogo
  // de tipos de proceso (F3-E1) tiene su `ver`/`administrar` como cualquier catálogo; la bandera
  // `generaEntradaPt` es EDITABLE solo por admin (se exige `roles.administrar`, ver dominio).
  {
    clave: 'tipos-proceso.ver',
    modulo: 'tipos-proceso',
    descripcion: 'Consultar el catálogo de tipos de proceso de maquila',
  },
  {
    clave: 'tipos-proceso.administrar',
    modulo: 'tipos-proceso',
    descripcion:
      'Administrar el catálogo de tipos de proceso (alta, edición, desactivación). La bandera "genera entrada a PT" solo la edita un administrador',
  },
  {
    clave: 'produccion.corte',
    modulo: 'produccion',
    descripcion: 'Capturar el corte de una orden de producción (F3-E2)',
  },
  {
    clave: 'produccion.envio',
    modulo: 'produccion',
    descripcion: 'Capturar envíos de maquila (costura/estampado/…) de una orden (F3-E2)',
  },
  {
    clave: 'produccion.recibo',
    modulo: 'produccion',
    descripcion:
      'Capturar recibos de maquila (WIP + entrada a PT + cargo EsMa según proceso) (F3-E4)',
  },
  {
    clave: 'produccion.entrega',
    modulo: 'produccion',
    descripcion: 'Capturar entregas a cliente (salida de PT) (F3-E5)',
  },
  {
    clave: 'produccion.wip-ver',
    modulo: 'produccion',
    descripcion: 'Consultar el avance (WIP) y los pendientes por etapa de las órdenes (F3-E5)',
  },
  {
    clave: 'produccion.cancelar',
    modulo: 'produccion',
    descripcion: 'Cancelar (suave, con inverso auditado) corte, envíos, recibos o entregas (F3)',
  },

  // ── Inventario de producto terminado por kardex (Módulo 6, F3-E3 — doc 04-Inventarios) ──
  {
    clave: 'inventario-pt.ver',
    modulo: 'inventario-pt',
    descripcion: 'Consultar existencias y kardex de producto terminado (F3-E3)',
  },
  {
    clave: 'inventario-pt.mover',
    modulo: 'inventario-pt',
    descripcion: 'Capturar movimientos manuales y traspasos de producto terminado (F3-E3)',
  },

  // ── Inventario de TELAS y AVÍOS por kardex (Módulo 4, F4-E1 — doc 04-Inventarios §B; D5/R4) ──
  // Mismo esquema ver/mover que inventario-pt. El ex-acceso #7 (telas.ver-totales) es APARTE: sobre
  // estos permisos, controla si las consultas de TELAS muestran o no los importes/costos en dinero
  // (las cantidades sí se ven con `inventario-telas.ver`).
  {
    clave: 'inventario-telas.ver',
    modulo: 'inventario-telas',
    descripcion: 'Consultar existencias y kardex de telas por lote (F4-E1, D5)',
  },
  {
    clave: 'inventario-telas.mover',
    modulo: 'inventario-telas',
    descripcion: 'Capturar ajustes, traspasos y salidas a orden de telas (F4-E1)',
  },
  {
    clave: 'inventario-avios.ver',
    modulo: 'inventario-avios',
    descripcion: 'Consultar existencias y kardex de avíos multi-almacén (F4-E1, R4)',
  },
  {
    clave: 'inventario-avios.mover',
    modulo: 'inventario-avios',
    descripcion: 'Capturar ajustes y traspasos de avíos (F4-E1, R4)',
  },

  // ── Estados de cuenta de maquileros (EsMa, F3-E4) — permiso NUEVO de v2 ──────
  {
    clave: 'esma.cargo-validar',
    modulo: 'esma',
    descripcion:
      'Validar (o ajustar/cancelar) los cargos propuestos de EsMa desde los recibos (F3-E4)',
  },

  // ── Notas de salida estructuradas (Módulo 5, F4-E5 — doc 03-Produccion §Notas de Salida; R4/R9) ──
  // Permisos NUEVOS de v2 (A4). `ver` (consulta), `administrar` (alta/edición/confirmar la nota — el
  // confirmar descuenta los avíos del kardex; la tela solo se referencia, decisión (e)) y `cancelar`
  // (cancelación suave con motivo + reverso auditado de los avíos, D3). Mismo reparto que compras:
  // ver es lectura, administrar muta/confirma, cancelar es su propio permiso (acción que revierte
  // movimientos de kardex). Operativos (no se restan a los roles bajos, como `compras.recibir`).
  {
    clave: 'notas.ver',
    modulo: 'notas',
    descripcion: 'Consultar notas de salida y sus renglones',
  },
  {
    clave: 'notas.administrar',
    modulo: 'notas',
    descripcion:
      'Crear, editar y CONFIRMAR notas de salida (confirmar descuenta los avíos del kardex, R4)',
  },
  {
    clave: 'notas.cancelar',
    modulo: 'notas',
    descripcion: 'Cancelar (suave, con motivo) notas de salida; reversa los avíos descontados (D3)',
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
