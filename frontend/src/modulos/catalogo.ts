import {
  Banknote,
  Barcode,
  Calculator,
  ChartLine,
  Factory,
  Files,
  Images,
  Library,
  type LucideIcon,
  Medal,
  Package,
  Route,
  Settings,
  Shirt,
  ShoppingCart,
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
  | 'codigo-barra'
  | 'carrito'
  | 'fabrica'
  | 'paquete'
  | 'almacen'
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
  'codigo-barra': Barcode,
  carrito: ShoppingCart,
  fabrica: Factory,
  paquete: Package,
  almacen: Warehouse,
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
  // Sub-vista de Modelos (F1-E5): el generador de códigos de barra (EAN-13 + DUN-14),
  // sucesor del form viejo `Codigo` (menú 1). NO es un módulo del plan §5: cuelga del
  // módulo Modelos, con su propio permiso de lectura `modelos.codigos-barra`.
  {
    clave: 'codigos-barra',
    titulo: 'Códigos de barra',
    descripcion: 'Genera el EAN-13 (pieza) y DUN-14 (caja) de un modelo y descarga su etiqueta',
    ruta: '/modelos/codigos-barra',
    icono: 'codigo-barra',
    permisos: ['modelos.codigos-barra'],
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
  {
    clave: 'compras',
    titulo: 'Compras y Materiales',
    descripcion: 'Explosión de materiales, órdenes de compra y recepciones',
    ruta: '/compras',
    icono: 'paquete',
    permisos: 'autenticado',
  },
  {
    clave: 'inventarios',
    titulo: 'Inventarios',
    descripcion: 'Kardex único: producto terminado, telas por lote y avíos',
    ruta: '/inventarios',
    icono: 'almacen',
    permisos: 'autenticado',
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
