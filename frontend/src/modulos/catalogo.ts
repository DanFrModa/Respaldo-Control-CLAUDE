import {
  AlertTriangle,
  Banknote,
  CalendarRange,
  Calculator,
  ChartLine,
  ClipboardList,
  Factory,
  Files,
  Images,
  Library,
  ListChecks,
  type LucideIcon,
  Medal,
  Package,
  Route,
  Settings,
  Shirt,
  ShoppingCart,
  Truck,
  Warehouse,
} from 'lucide-react';

import type { ClavePermiso } from '@/api/tipos';

/**
 * Menu principal de CONTROL v2: los 13 modulos de PLANMAESTRO §5 (estructura
 * nueva, DECISION D8). Sucede al "Panel de Control" manejado por datos del
 * sistema viejo (doc funcional 00 §3), con su misma idea: el menu es
 * CONFIGURACION, no codigo repetido.
 *
 * Visibilidad (A4): un modulo se muestra si el usuario tiene ALGUNO de los
 * permisos listados en `permisos`; con `"autenticado"` basta haber iniciado
 * sesion. Sin permiso -> el modulo NO aparece (no se muestra deshabilitado), y
 * su ruta tampoco resuelve. La pantalla esconde, el servidor decide: cada ruta
 * del backend re-verifica su permiso.
 */

/** Iconos por nombre (string estable); el sidebar los resuelve a Lucide. */
export type IconoModulo =
  | 'libreria'
  | 'camisa'
  | 'imagenes'
  | 'carrito'
  | 'fabrica'
  | 'lista-tareas'
  | 'alerta'
  | 'calendario'
  | 'paquete'
  | 'almacen'
  | 'camion'
  | 'ruta'
  | 'medalla'
  | 'billete'
  | 'calculadora'
  | 'grafica'
  | 'archivo'
  | 'engrane'
  | 'portapapeles';

/**
 * Mapa nombre estable -> componente Lucide. Vive aqui (modulo de datos, no
 * componente) para reusarse SIN romper fast-refresh: el sidebar
 * (`NavegacionModulos`), el inicio y "Proximamente" pintan el icono de color de
 * cada modulo a partir de este mapa.
 */
export const ICONOS_MODULO: Record<IconoModulo, LucideIcon> = {
  libreria: Library,
  camisa: Shirt,
  imagenes: Images,
  carrito: ShoppingCart,
  fabrica: Factory,
  'lista-tareas': ListChecks,
  alerta: AlertTriangle,
  calendario: CalendarRange,
  paquete: Package,
  almacen: Warehouse,
  camion: Truck,
  ruta: Route,
  medalla: Medal,
  billete: Banknote,
  calculadora: Calculator,
  grafica: ChartLine,
  archivo: Files,
  engrane: Settings,
  portapapeles: ClipboardList,
};

export interface ModuloMenu {
  /** Identificador estable y primer segmento de la ruta (sin acentos). */
  clave: string;
  /** Titulo que ve el usuario (UI 100 % en español). */
  titulo: string;
  /** Que vive en el modulo; se usa en el inicio y en "Proximamente". */
  descripcion: string;
  ruta: `/${string}`;
  icono: IconoModulo;
  /**
   * Claves del catalogo de permisos que hacen visible el modulo (basta una), o
   * `"autenticado"` para modulos de uso general.
   *
   * El catalogo F0 (los 38 accesos reales de `Accesos.csv` + los nuevos de
   * administracion) gobierna ACCIONES mas que modulos; los modulos que en el
   * sistema viejo se filtraban solo por nivel quedan `"autenticado"` y se iran
   * acotando al construir cada modulo en su fase.
   */
  permisos: readonly ClavePermiso[] | 'autenticado';
  /** Modulo estrella del plan (la Ruta Critica, D10/D11). */
  destacado?: boolean;
  /**
   * `true` si la entrada NO es un módulo del plan §5 sino una SUB-VISTA de uno (p. ej. la
   * galería de modelos de F1-E5). Solo afecta a la documentación/tests; el menú las pinta igual.
   */
  subVista?: boolean;
}

/**
 * Entradas del menú: los 13 módulos del plan §5 EN ORDEN, más una sub-vista (la "Galería de
 * modelos" de F1-E5, que cuelga del módulo Modelos y comparte su permiso). Las entradas que NO
 * son módulos del plan se marcan con `subVista: true`.
 */
export const MODULOS_MENU: readonly ModuloMenu[] = [
  {
    clave: 'catalogos',
    titulo: 'Catálogos',
    descripcion: 'Clientes, proveedores, telas, avíos, colores, tallas y almacenes',
    ruta: '/catalogos',
    icono: 'libreria',
    permisos: 'autenticado',
  },
  {
    clave: 'modelos',
    titulo: 'Modelos',
    descripcion: 'Catálogo de modelos con fotos y su receta completa (BOM)',
    ruta: '/modelos',
    icono: 'camisa',
    permisos: ['modelos.ver'],
  },
  // Sub-vista de Modelos (F1-E5): la galería visual de fotos, móvil-primero, para enseñar
  // producto fuera de la oficina. NO es un módulo del plan §5: es una segunda vista del
  // módulo Modelos (misma `modelos.ver`), enlazada en el menú por descubribilidad.
  {
    clave: 'galeria-modelos',
    titulo: 'Galería de modelos',
    descripcion: 'Vista visual de los modelos con su foto, para enseñar producto',
    ruta: '/modelos/galeria',
    icono: 'imagenes',
    permisos: ['modelos.ver'],
    subVista: true,
  },
  {
    clave: 'pedidos',
    titulo: 'Pedidos',
    descripcion: 'Pedidos internos (forecast) y pedidos reales por CEDIS',
    ruta: '/pedidos',
    icono: 'carrito',
    permisos: ['pedidos.ver'],
  },
  {
    clave: 'produccion',
    titulo: 'Producción',
    descripcion: 'Órdenes, corte, maquila, recibos, entregas y avance (WIP)',
    ruta: '/produccion',
    icono: 'fabrica',
    permisos: 'autenticado',
  },
  // Sub-vista de Producción (F3-E1): catálogo de tipos de proceso de maquila (con la marca
  // «genera entrada a PT», editable solo por admin). Cuelga del módulo Producción; lo gobierna
  // su permiso de lectura `tipos-proceso.ver`.
  {
    clave: 'tipos-proceso',
    titulo: 'Tipos de proceso',
    descripcion: 'Catálogo de procesos de maquila (costura, estampado, bordado, lavado…)',
    ruta: '/produccion/tipos-proceso',
    icono: 'engrane',
    permisos: ['tipos-proceso.ver'],
    subVista: true,
  },
  // Sub-vista de Producción (F2-E3): la captura de Órdenes de producción con su matriz color ×
  // talla. NO es un módulo del plan §5: cuelga del módulo Producción, con su propio permiso de
  // lectura `ordenes.ver`.
  {
    clave: 'ordenes',
    titulo: 'Órdenes',
    descripcion: 'Captura de órdenes de producción con matriz color × talla',
    ruta: '/produccion/ordenes',
    icono: 'fabrica',
    permisos: ['ordenes.ver'],
    subVista: true,
  },
  // Sub-vistas de Producción (F2-E4): la operación diaria de ÓRDENES — consultar/imprimir, ver
  // incompletas con semáforo y el tablero de pedidos por mes. Cuelgan del módulo Producción y
  // comparten su permiso de lectura `ordenes.ver`.
  {
    clave: 'consulta-ordenes',
    titulo: 'Consulta de órdenes',
    descripcion: 'Localiza, imprime (individual o en lote) y salta a las órdenes de producción',
    ruta: '/produccion/consulta',
    icono: 'lista-tareas',
    permisos: ['ordenes.ver'],
    subVista: true,
  },
  {
    clave: 'ordenes-incompletas',
    titulo: 'Órdenes incompletas',
    descripcion: 'Órdenes capturadas sin matriz, con semáforo de antigüedad',
    ruta: '/produccion/incompletas',
    icono: 'alerta',
    permisos: ['ordenes.ver'],
    subVista: true,
  },
  {
    clave: 'pedidos-por-mes',
    titulo: 'Pedidos por mes',
    descripcion: 'Tablero de órdenes y piezas agregadas por mes',
    ruta: '/produccion/pedidos-por-mes',
    icono: 'calendario',
    permisos: ['ordenes.ver'],
    subVista: true,
  },
  // Sub-vistas de Producción (F3-E2): corte + envío a maquila unificado (M/A por TipoProceso, D8) y
  // la consulta de corte semanal por cortador. Cuelgan del módulo Producción con sus permisos
  // operativos (la captura de corte/envío, la consulta del WIP).
  {
    clave: 'corte',
    titulo: 'Captura de corte',
    descripcion: 'Registra el corte de una orden por color × talla',
    ruta: '/produccion/corte',
    icono: 'fabrica',
    permisos: ['produccion.corte'],
    subVista: true,
  },
  {
    clave: 'envios',
    titulo: 'Envío a maquila',
    descripcion: 'Envía a costura, estampado, bordado o lavado desde una sola pantalla',
    ruta: '/produccion/envios',
    icono: 'paquete',
    permisos: ['produccion.envio'],
    subVista: true,
  },
  {
    clave: 'corte-semanal',
    titulo: 'Corte semanal',
    descripcion: 'Piezas cortadas por cortador y por semana',
    ruta: '/produccion/corte-semanal',
    icono: 'calendario',
    permisos: ['produccion.wip-ver'],
    subVista: true,
  },
  // Sub-vistas de Producción (F3-E4): recibo de maquila unificado (recibe costura/estampado; lo de
  // costura entra a PT) y la consulta de recibos semanales por maquilero. Cuelgan del módulo
  // Producción con sus permisos operativos (la captura del recibo, la consulta del WIP).
  {
    clave: 'recibos',
    titulo: 'Recibo de maquila',
    descripcion: 'Recibe prenda terminada de costura/estampado y mete a inventario lo de costura',
    ruta: '/produccion/recibos',
    icono: 'paquete',
    permisos: ['produccion.recibo'],
    subVista: true,
  },
  {
    clave: 'recibos-semanales',
    titulo: 'Recibos semanales',
    descripcion: 'Piezas recibidas por maquilero y por semana',
    ruta: '/produccion/recibos-semanales',
    icono: 'calendario',
    permisos: ['produccion.wip-ver'],
    subVista: true,
  },
  // Sub-vistas de Producción (F3-E5): la ENTREGA a cliente (cierra el ciclo de la orden; saca de PT),
  // el TABLERO de avance (WIP por orden, derivado) y las existencias EN PODER del maquilero (enviado
  // − recibido). Cuelgan del módulo Producción con sus permisos operativos.
  {
    clave: 'entregas',
    titulo: 'Entrega a cliente',
    descripcion: 'Entrega producto terminado al cliente y cierra el pedido (salida de inventario)',
    ruta: '/produccion/entregas',
    icono: 'camion',
    permisos: ['produccion.entrega'],
    subVista: true,
  },
  {
    clave: 'wip',
    titulo: 'Tablero WIP',
    descripcion: 'Avance de las órdenes en producción (corte, maquila, recibo y entrega)',
    ruta: '/produccion/wip',
    icono: 'lista-tareas',
    permisos: ['produccion.wip-ver'],
    subVista: true,
  },
  {
    clave: 'existencias-maquilero',
    titulo: 'En poder del maquilero',
    descripcion: 'Piezas enviadas a maquila aún no recibidas, por maquilero y orden',
    ruta: '/produccion/existencias-maquilero',
    icono: 'paquete',
    permisos: ['produccion.wip-ver'],
    subVista: true,
  },
  // Sub-vistas de Producción (F4-E5): notas de salida a maquilero (captura/confirmación), su consulta
  // (solo lectura + PDF) y las notas por orden de producción. Cuelgan del módulo Producción con los
  // permisos de notas (`notas.ver` para consultar; `notas.administrar` para capturar/confirmar).
  {
    clave: 'notas-salida',
    titulo: 'Notas de salida',
    descripcion:
      'Envío de telas y avíos a maquileros contra una orden (descuenta avíos al confirmar)',
    ruta: '/produccion/notas-salida',
    icono: 'camion',
    permisos: ['notas.ver'],
    subVista: true,
  },
  {
    clave: 'notas-salida-consulta',
    titulo: 'Consulta de notas',
    descripcion: 'Notas de salida con su encabezado, renglones y estatus (solo lectura, con PDF)',
    ruta: '/produccion/notas-salida/consulta',
    icono: 'archivo',
    permisos: ['notas.ver'],
    subVista: true,
  },
  {
    clave: 'notas-salida-por-orden',
    titulo: 'Notas por orden',
    descripcion: 'Notas de salida que envían material a una orden de producción',
    ruta: '/produccion/notas-salida/por-orden',
    icono: 'fabrica',
    permisos: ['notas.ver'],
    subVista: true,
  },
  {
    clave: 'compras',
    titulo: 'Compras y Materiales',
    descripcion: 'Explosión de materiales, órdenes de compra y recepciones',
    ruta: '/compras',
    icono: 'paquete',
    permisos: 'autenticado',
  },
  // Sub-vistas de Compras (F4-E2): órdenes de compra (listado/captura), bandeja de autorización
  // (usable en móvil) y compras por orden de producción. Cuelgan del módulo Compras con sus
  // permisos (`compras.ver` para el listado; `compras.autorizar` para la bandeja).
  {
    clave: 'ordenes-compra',
    titulo: 'Órdenes de compra',
    descripcion: 'Captura, autoriza, duplica e imprime órdenes de compra a proveedores',
    ruta: '/compras/ordenes',
    icono: 'carrito',
    permisos: ['compras.ver'],
    subVista: true,
  },
  {
    clave: 'autorizacion-compras',
    titulo: 'Autorización de compras',
    descripcion: 'Bandeja de órdenes de compra pendientes de autorizar (desde el móvil)',
    ruta: '/compras/autorizacion',
    icono: 'lista-tareas',
    permisos: ['compras.autorizar'],
    subVista: true,
  },
  {
    clave: 'compras-por-orden',
    titulo: 'Compras por orden',
    descripcion: 'Órdenes de compra ligadas a una orden de producción',
    ruta: '/compras/por-orden',
    icono: 'fabrica',
    permisos: ['compras.ver'],
    subVista: true,
  },
  // Explosión MRP (F4-E4, R3): cruza el BOM del modelo con la matriz de la orden → qué/cuánto
  // comprar, netea genéricos contra el stock y genera la OC por proveedor en un clic. `compras.ver`.
  {
    clave: 'explosion-materiales',
    titulo: 'Explosión de materiales',
    descripcion: 'Qué y cuánto comprar por orden (BOM × cantidades) y generar la OC en un clic',
    ruta: '/compras/explosion',
    icono: 'calculadora',
    permisos: ['compras.ver'],
    subVista: true,
  },
  // Tablero "qué tengo / qué falta" (F4-E4, R7): cruce requerido vs en-OC vs recibido por material.
  {
    clave: 'estatus-materiales',
    titulo: 'Qué tengo / qué falta',
    descripcion: 'Semáforo de materiales por orden: requerido vs en órdenes de compra vs recibido',
    ruta: '/compras/estatus-materiales',
    icono: 'grafica',
    permisos: ['compras.ver'],
    subVista: true,
  },
  // Recepción de compras (F4-E3): recibe (parcial/total) el material de una OC autorizada, crea el
  // lote de tela (D5) y da entrada al kardex de telas/avíos. `compras.recibir` la gobierna.
  {
    clave: 'recepcion-compras',
    titulo: 'Recepción de compras',
    descripcion:
      'Recibe material contra una OC autorizada: crea el lote y da entrada al inventario',
    ruta: '/compras/recepcion',
    icono: 'paquete',
    permisos: ['compras.recibir'],
    subVista: true,
  },
  {
    clave: 'inventarios',
    titulo: 'Inventarios',
    descripcion: 'Kardex único: producto terminado, telas por lote y avíos',
    ruta: '/inventarios',
    icono: 'almacen',
    permisos: 'autenticado',
  },
  // Sub-vistas de Inventarios (F3-E3): inventario de PRODUCTO TERMINADO operable. Movimientos
  // manuales y traspasos (captura, `inventario-pt.mover`); existencias y kardex (consulta,
  // `inventario-pt.ver`). Cuelgan del módulo Inventarios.
  {
    clave: 'inventario-movimientos',
    titulo: 'Movimientos PT',
    descripcion: 'Entradas, salidas y ajustes de producto terminado por color × talla',
    ruta: '/inventarios/movimientos',
    icono: 'paquete',
    permisos: ['inventario-pt.mover'],
    subVista: true,
  },
  {
    clave: 'inventario-traspasos',
    titulo: 'Traspasos PT',
    descripcion: 'Mueve producto terminado entre almacenes en una sola operación',
    ruta: '/inventarios/traspasos',
    icono: 'paquete',
    permisos: ['inventario-pt.mover'],
    subVista: true,
  },
  {
    clave: 'inventario-existencias',
    titulo: 'Existencias PT',
    descripcion: 'Existencia por modelo, color, talla y almacén (suma de movimientos)',
    ruta: '/inventarios/existencias',
    icono: 'almacen',
    permisos: ['inventario-pt.ver'],
    subVista: true,
  },
  {
    clave: 'inventario-kardex',
    titulo: 'Kardex PT',
    descripcion: 'Movimientos con saldo corrido por modelo y detalle por folio',
    ruta: '/inventarios/kardex',
    icono: 'almacen',
    permisos: ['inventario-pt.ver'],
    subVista: true,
  },
  // Sub-vistas de Inventarios (F4-E1): inventario de TELAS (tela×lote, D5) y AVÍOS (multi-almacén,
  // R4) operables por el mismo kardex único. Consultas (`*.ver`) y capturas (`*.mover`). Cuelgan del
  // módulo Inventarios.
  {
    clave: 'inventario-telas-existencias',
    titulo: 'Existencias de telas',
    descripcion: 'Existencia por tela, lote y almacén con los componentes del lote (D5)',
    ruta: '/inventarios/telas/existencias',
    icono: 'almacen',
    permisos: ['inventario-telas.ver'],
    subVista: true,
  },
  {
    clave: 'inventario-avios-existencias',
    titulo: 'Existencias de avíos',
    descripcion: 'Existencia de avíos por almacén (multi-almacén), distingue genéricos',
    ruta: '/inventarios/avios/existencias',
    icono: 'almacen',
    permisos: ['inventario-avios.ver'],
    subVista: true,
  },
  {
    clave: 'inventario-materiales-kardex',
    titulo: 'Kardex de materiales',
    descripcion: 'Movimientos con saldo corrido por tela (lote) o por avío',
    ruta: '/inventarios/materiales/kardex',
    icono: 'almacen',
    permisos: ['inventario-telas.ver', 'inventario-avios.ver'],
    subVista: true,
  },
  {
    clave: 'inventario-telas-salida-orden',
    titulo: 'Salida de tela a orden',
    descripcion: 'Descuenta tela del inventario ligándola a una orden de producción',
    ruta: '/inventarios/telas/salida-orden',
    icono: 'paquete',
    permisos: ['inventario-telas.mover'],
    subVista: true,
  },
  {
    clave: 'inventario-materiales-traspasos',
    titulo: 'Traspaso de materiales',
    descripcion: 'Mueve tela (por lote) o avío entre almacenes en una sola operación',
    ruta: '/inventarios/materiales/traspasos',
    icono: 'paquete',
    permisos: ['inventario-telas.mover', 'inventario-avios.mover'],
    subVista: true,
  },
  {
    clave: 'inventario-materiales-ajustes',
    titulo: 'Ajuste de materiales',
    descripcion: 'Ajuste / inventario físico de telas (lote 1..N componentes) y avíos',
    ruta: '/inventarios/materiales/ajustes',
    icono: 'paquete',
    permisos: ['inventario-telas.mover', 'inventario-avios.mover'],
    subVista: true,
  },
  {
    clave: 'ruta-critica',
    titulo: 'Ruta Crítica',
    descripcion: 'Workflow de procesos con fechas, semáforos y bandeja de tareas',
    ruta: '/ruta-critica',
    icono: 'ruta',
    permisos: 'autenticado',
    destacado: true,
  },
  // Sub-vista de Ruta Crítica (F5-E5): la BANDEJA de "mis tareas" — el operador captura su avance de
  // la ruta por orden (Hoy/Ayer + checklist). Cuelga del módulo Ruta Crítica; la gobierna
  // `rc.ruta-ver` (capturar exige además `rc.capturar`, que el backend re-verifica, A1).
  {
    clave: 'rc-bandeja',
    titulo: 'Bandeja de tareas',
    descripcion: 'Mis procesos pendientes de la Ruta Crítica, ordenados por urgencia',
    ruta: '/ruta-critica/bandeja',
    icono: 'lista-tareas',
    permisos: ['rc.ruta-ver'],
    subVista: true,
  },
  // Sub-vista de Ruta Crítica (F5-E7): el CONCENTRADO "planeado vs real" — el tablero gerencial que
  // reemplaza la vista más pesada del viejo (RC_ConcentradoDif). Todas las órdenes con RC viva ×
  // sus procesos, con semáforo y atraso; export a Excel. Cuelga del módulo Ruta Crítica; la gobierna
  // `rc.ruta-ver` (la misma que la bandeja; el backend re-verifica, A1).
  {
    clave: 'rc-concentrado',
    titulo: 'Concentrado planeado vs real',
    descripcion:
      'Todas las órdenes con Ruta Crítica viva: semáforo y atraso por proceso, con Excel',
    ruta: '/ruta-critica/concentrado',
    icono: 'grafica',
    permisos: ['rc.ruta-ver'],
    subVista: true,
  },
  // Sub-vistas de Ruta Crítica (F5-E1): el CATÁLOGO CONFIGURABLE (procesos + roles + checklist) y el
  // editor de DEPENDENCIAS (DAG). Cuelgan del módulo Ruta Crítica; los gobierna `rc.catalogo-ver`.
  // El MOTOR (instancias por orden, fechas/semáforos) y la bandeja de tareas llegan en E2+.
  {
    clave: 'rc-procesos',
    titulo: 'Procesos (catálogo)',
    descripcion: 'Catálogo configurable de procesos: banderas, roles responsables y checklists',
    ruta: '/ruta-critica/procesos',
    icono: 'lista-tareas',
    permisos: ['rc.catalogo-ver'],
    subVista: true,
  },
  {
    clave: 'rc-dependencias',
    titulo: 'Dependencias',
    descripcion: 'Editor del grafo de dependencias entre procesos (sin ciclos)',
    ruta: '/ruta-critica/dependencias',
    icono: 'ruta',
    permisos: ['rc.catalogo-ver'],
    subVista: true,
  },
  // Sub-vistas de Ruta Crítica (F5-E2): plantillas de ruta (procesos + tiempo estándar +
  // encadenamiento propio por artículo/familia) y reglas de duración (cantidad/tela/aplicación).
  {
    clave: 'rc-plantillas',
    titulo: 'Plantillas de ruta',
    descripcion: 'Qué procesos lleva cada artículo, su tiempo estándar y su encadenamiento',
    ruta: '/ruta-critica/plantillas',
    icono: 'lista-tareas',
    permisos: ['rc.catalogo-ver'],
    subVista: true,
  },
  {
    clave: 'rc-reglas-duracion',
    titulo: 'Reglas de duración',
    descripcion: 'Factores por cantidad y días por tipo de tela o aplicación',
    ruta: '/ruta-critica/reglas-duracion',
    icono: 'calendario',
    permisos: ['rc.catalogo-ver'],
    subVista: true,
  },
  {
    clave: 'calidad',
    titulo: 'Calidad',
    descripcion: 'Auditorías AQL y catálogo de defectos',
    ruta: '/calidad',
    icono: 'medalla',
    permisos: ['calidad.ver'],
  },
  // Sub-vista de Calidad (F6-E2): ALTA de auditoría (la operación de piso). Cuelga del módulo
  // Calidad; la gobierna `calidad.generar-auditorias` (la captura de resultados se llega desde el
  // alta y exige `calidad.actualizar-auditorias`, que el backend re-verifica, A1).
  {
    clave: 'calidad-auditorias',
    titulo: 'Auditorías de calidad',
    descripcion: 'Inspecciona una muestra de una orden, captura fallas y resuelve aprobar/reprobar',
    ruta: '/calidad/auditorias/nueva',
    icono: 'portapapeles',
    permisos: ['calidad.generar-auditorias'],
    subVista: true,
  },
  // Sub-vistas de Calidad (F6-E3): consulta de auditorías (con impreso y modificar/cancelar) e
  // historial por maquilero (% de aprobación). Las gobierna `calidad.ver` (las acciones de escritura
  // de la consulta exigen además `calidad.modificar-auditorias`, que el backend re-verifica, A1).
  {
    clave: 'calidad-consulta-auditorias',
    titulo: 'Consulta de auditorías',
    descripcion: 'Busca auditorías, imprime su PDF y modifica o cancela las existentes',
    ruta: '/calidad/auditorias',
    icono: 'portapapeles',
    permisos: ['calidad.ver'],
    subVista: true,
  },
  {
    clave: 'calidad-historial-maquilero',
    titulo: 'Auditorías por maquilero',
    descripcion: 'Historial y porcentaje de aprobación operativo de cada maquilero',
    ruta: '/calidad/auditorias/maquilero',
    icono: 'medalla',
    permisos: ['calidad.ver'],
    subVista: true,
  },
  // Sub-vistas de Calidad (F6-E1): catálogos base del sistema AQL. Cuelgan del módulo Calidad y
  // las gobierna `calidad.ver` (consulta) / `calidad.administrar-catalogo` (escritura; el backend
  // re-verifica, A1).
  {
    clave: 'calidad-defectos',
    titulo: 'Catálogo de defectos',
    descripcion: 'Defectos del sistema AQL con severidad, nivel y tipos de producto aplicables',
    ruta: '/calidad/defectos',
    icono: 'portapapeles',
    permisos: ['calidad.ver'],
    subVista: true,
  },
  {
    clave: 'calidad-tipos-producto',
    titulo: 'Tipos de producto',
    descripcion: 'Segmentación de producto para acotar qué defectos aplican a cada familia',
    ruta: '/calidad/tipos-producto',
    icono: 'medalla',
    permisos: ['calidad.ver'],
    subVista: true,
  },
  {
    clave: 'calidad-planes-aql',
    titulo: 'Planes AQL',
    descripcion: 'Tablas de muestreo AQL: tamaño de muestra y límites de aceptación/rechazo',
    ruta: '/calidad/planes-aql',
    icono: 'medalla',
    permisos: ['calidad.ver'],
    subVista: true,
  },
  {
    clave: 'esma',
    titulo: 'EsMa',
    descripcion: 'Estados de cuenta de maquileros: cargos, abonos y pagos',
    ruta: '/esma',
    icono: 'billete',
    permisos: 'autenticado',
  },
  // Sub-vistas de EsMa (F6-E5, experiencia de usuario): estado de cuenta, saldos, desglosado y las
  // consultas semanales. Todas de LECTURA DE CUENTA (`esma.ver-pagos`); el backend re-verifica (A1).
  {
    clave: 'esma-estado-cuenta',
    titulo: 'Estado de cuenta',
    descripcion:
      'La cuenta corriente de un maquilero: cargos, abonos, descuentos y pagos por fecha',
    ruta: '/esma/estado-cuenta',
    icono: 'billete',
    permisos: ['esma.ver-pagos'],
    subVista: true,
  },
  {
    clave: 'esma-saldos',
    titulo: 'Saldos de maquileros',
    descripcion:
      'Maquileros activos con saldo distinto de cero, con drill-down al estado de cuenta',
    ruta: '/esma/saldos',
    icono: 'billete',
    permisos: ['esma.ver-pagos'],
    subVista: true,
  },
  {
    clave: 'esma-desglosado',
    titulo: 'Desglosado',
    descripcion: 'Detalle por orden/modelo, exportable a Excel y como PDF del estado de cuenta',
    ruta: '/esma/desglosado',
    icono: 'billete',
    permisos: ['esma.ver-pagos'],
    subVista: true,
  },
  {
    clave: 'esma-pagos-semanales',
    titulo: 'Pagos semanales',
    descripcion: 'Los pagos a maquileros de la semana, con su total',
    ruta: '/esma/pagos-semanales',
    icono: 'billete',
    permisos: ['esma.ver-pagos'],
    subVista: true,
  },
  {
    clave: 'esma-recibos-semanales',
    titulo: 'Recibos semanales de maquila',
    descripcion: 'Recibos del periodo por maquilero y modelo, valuados al precio pactado',
    ruta: '/esma/recibos-semanales',
    icono: 'billete',
    permisos: ['esma.ver-pagos'],
    subVista: true,
  },
  // Sub-vista de EsMa (F3-E4): la cola de validación de cargos de maquila que proponen los recibos.
  // Cuelga del módulo EsMa con su permiso operativo `esma.cargo-validar`.
  {
    clave: 'validacion-cargos',
    titulo: 'Validación de cargos',
    descripcion: 'Revisa y valida los cargos de maquila propuestos por los recibos',
    ruta: '/esma/validacion-cargos',
    icono: 'billete',
    permisos: ['esma.cargo-validar'],
    subVista: true,
  },
  // Sub-vistas de EsMa (F6-E4, corazón contable): conciliación y pagos + lectura de cuenta
  // (`esma.ver-pagos`); abonos y descuentos (`esma.modificar`). El backend re-verifica (A1).
  {
    clave: 'esma-conciliacion',
    titulo: 'Conciliación de cargos',
    descripcion: 'Cuadra lo recibido de maquila vs lo cargado a EsMa y detecta lo faltante',
    ruta: '/esma/conciliacion',
    icono: 'billete',
    permisos: ['esma.ver-pagos'],
    subVista: true,
  },
  {
    clave: 'esma-abonos',
    titulo: 'Abonos',
    descripcion: 'Captura abonos a la cuenta corriente de un maquilero',
    ruta: '/esma/abonos',
    icono: 'billete',
    permisos: ['esma.modificar'],
    subVista: true,
  },
  {
    clave: 'esma-descuentos',
    titulo: 'Descuentos',
    descripcion: 'Captura descuentos a la cuenta corriente de un maquilero',
    ruta: '/esma/descuentos',
    icono: 'billete',
    permisos: ['esma.modificar'],
    subVista: true,
  },
  {
    clave: 'esma-pagos',
    titulo: 'Pagos',
    descripcion: 'Paga cargos validados (prendas por pagar) e imprime el recibo de pago',
    ruta: '/esma/pagos',
    icono: 'billete',
    permisos: ['esma.ver-pagos'],
    subVista: true,
  },
  {
    clave: 'costos',
    titulo: 'Costos',
    descripcion: 'Pre-costo por modelo, costo real por orden y márgenes por pedido',
    ruta: '/costos',
    icono: 'calculadora',
    permisos: ['precostos.consultar', 'costos.ver'],
  },
  // Sub-vistas de Costos (F7-E1): pre-costo y lista de precios (precostos.consultar, nivel ≤45);
  // costeo de orden, lista de costos y márgenes por pedido (costos.ver, nivel ≤30). El EDR llega en
  // F7-E2. Cuelgan del módulo Costos; el backend re-verifica cada permiso (A1).
  {
    clave: 'costos-pre-costo',
    titulo: 'Pre-costo por modelo',
    descripcion: 'Costo estimado de un modelo (receta × catálogo + maquila) y precio sugerido',
    ruta: '/costos/pre-costo',
    icono: 'camisa',
    permisos: ['precostos.consultar'],
    subVista: true,
  },
  {
    clave: 'costos-lista-precios',
    titulo: 'Lista de precios',
    descripcion: 'Precio de venta sugerido por modelo (utilidad + regalías), con PDF por género',
    ruta: '/costos/lista-precios',
    icono: 'archivo',
    permisos: ['precostos.consultar'],
    subVista: true,
  },
  {
    clave: 'costos-costeo',
    titulo: 'Costeo de orden',
    descripcion: 'Costo real de una orden: teórico vs guardado, con su costo unitario por base',
    ruta: '/costos/costeo',
    icono: 'calculadora',
    permisos: ['costos.ver'],
    subVista: true,
  },
  {
    clave: 'costos-lista',
    titulo: 'Lista de costos',
    descripcion: 'Órdenes ya costeadas con su costo total y unitario',
    ruta: '/costos/lista',
    icono: 'lista-tareas',
    permisos: ['costos.ver'],
    subVista: true,
  },
  {
    clave: 'costos-margenes',
    titulo: 'Márgenes por pedido',
    descripcion: 'Importe, margen promedio, margen ponderado y margen $ por pieza (PDF/Excel)',
    ruta: '/costos/margenes',
    icono: 'grafica',
    permisos: ['costos.ver'],
    subVista: true,
  },
  // Estado de Resultados (Módulo 6, F7-E2): el P&L mensual consolidado, a costo actual. Módulo propio
  // (menú 6.2) con 4 sub-vistas. `edr.ver` para consultar; `edr.capturar` para generar/conciliar.
  {
    clave: 'edr',
    titulo: 'Estado de resultados',
    descripcion: 'P&L mensual consolidado desde las entregas a cliente, a costo actual (PDF/Excel)',
    ruta: '/edr',
    icono: 'grafica',
    permisos: ['edr.ver'],
  },
  {
    clave: 'edr-mes',
    titulo: 'Gestión del mes',
    descripcion: 'Crea/selecciona un mes, captura gastos y genera las ventas del EDR',
    ruta: '/edr/mes',
    icono: 'portapapeles',
    permisos: ['edr.capturar'],
    subVista: true,
  },
  {
    clave: 'edr-conciliacion',
    titulo: 'Conciliación de ventas',
    descripcion: 'Ajusta el precio facturado y las cantidades; agrega o borra líneas manuales',
    ruta: '/edr/conciliacion',
    icono: 'lista-tareas',
    permisos: ['edr.ver'],
    subVista: true,
  },
  {
    clave: 'edr-por-mes',
    titulo: 'EDR por mes',
    descripcion: 'Resultado del mes con corte por empresa y por cliente (PDF/Excel)',
    ruta: '/edr/por-mes',
    icono: 'grafica',
    permisos: ['edr.ver'],
    subVista: true,
  },
  {
    clave: 'edr-por-anio',
    titulo: 'EDR por año',
    descripcion: 'Comparativo mensual del año, con corte por empresa (PDF)',
    ruta: '/edr/por-anio',
    icono: 'calendario',
    permisos: ['edr.ver'],
    subVista: true,
  },
  {
    clave: 'indicadores',
    titulo: 'Indicadores',
    descripcion: 'KPIs de entregas, tiempos y desempeño derivados de la Ruta Crítica',
    ruta: '/indicadores',
    icono: 'grafica',
    permisos: 'autenticado',
  },
  {
    clave: 'documental',
    titulo: 'Documental',
    descripcion: 'Fichas técnicas por orden y repositorio de adjuntos',
    ruta: '/documental',
    icono: 'archivo',
    permisos: 'autenticado',
  },
  {
    clave: 'administracion',
    titulo: 'Administración',
    descripcion: 'Usuarios, roles y permisos, empresas, configuración y bitácora',
    ruta: '/administracion',
    icono: 'engrane',
    permisos: [
      'usuarios.administrar',
      'roles.administrar',
      'empresas.administrar',
      'almacenes.administrar',
    ],
  },
  // Sub-vista de Administración (F5-E2): configuración de la RC por empresa — colchón de costura,
  // calendario laboral (días hábiles) y días festivos. La gobierna `empresas.administrar`.
  {
    clave: 'config-ruta-critica',
    titulo: 'Configuración de Ruta Crítica',
    descripcion: 'Colchón de costura, calendario laboral y festivos por empresa',
    ruta: '/administracion/ruta-critica',
    icono: 'calendario',
    permisos: ['empresas.administrar'],
    subVista: true,
  },
  // Sub-vista de Administración (F6-E1): bitácora de auditoría (A7) — registro inmutable de
  // todas las acciones del sistema (quién, qué, cuándo, sobre qué). Solo lectura.
  // La gobierna `admin.ver-bitacora`.
  {
    clave: 'bitacora',
    titulo: 'Bitácora',
    descripcion: 'Auditoría de cambios del sistema: quién, qué, cuándo y sobre qué registro',
    ruta: '/administracion/bitacora',
    icono: 'portapapeles',
    permisos: ['admin.ver-bitacora'],
    subVista: true,
  },
] as const;

/**
 * Filtra los modulos visibles para un conjunto de permisos efectivos. Funcion
 * pura: la usan el sidebar, el inicio y la pagina "Proximamente", y la cubren
 * los tests unitarios.
 */
export function filtrarModulosVisibles(permisos: ReadonlySet<ClavePermiso>): readonly ModuloMenu[] {
  return MODULOS_MENU.filter((modulo) => esModuloVisible(modulo, permisos));
}

/** ¿El modulo es visible con estos permisos? */
export function esModuloVisible(modulo: ModuloMenu, permisos: ReadonlySet<ClavePermiso>): boolean {
  if (modulo.permisos === 'autenticado') {
    return true;
  }
  return modulo.permisos.some((clave) => permisos.has(clave));
}

/** Busca un modulo por su primer segmento de ruta (p. ej. "ruta-critica"). */
export function buscarModuloPorClave(clave: string): ModuloMenu | undefined {
  return MODULOS_MENU.find((modulo) => modulo.clave === clave);
}
