import {
  AlertTriangle,
  Banknote,
  CalendarRange,
  Calculator,
  ChartLine,
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
  | 'engrane';

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
  {
    clave: 'calidad',
    titulo: 'Calidad',
    descripcion: 'Auditorías AQL y catálogo de defectos',
    ruta: '/calidad',
    icono: 'medalla',
    permisos: 'autenticado',
  },
  {
    clave: 'esma',
    titulo: 'EsMa',
    descripcion: 'Estados de cuenta de maquileros: cargos, abonos y pagos',
    ruta: '/esma',
    icono: 'billete',
    permisos: 'autenticado',
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
  {
    clave: 'costos',
    titulo: 'Costos y EDR',
    descripcion: 'Pre-costo, costo real y estado de resultados',
    ruta: '/costos',
    icono: 'calculadora',
    permisos: 'autenticado',
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
