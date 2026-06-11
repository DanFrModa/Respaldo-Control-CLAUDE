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
}

/** Los 13 modulos en el orden de PLANMAESTRO §5. */
export const MODULOS_MENU: readonly ModuloMenu[] = [
  {
    clave: 'catalogos',
    titulo: 'Catálogos',
    descripcion: 'Clientes, maquileros, proveedores, telas, avíos, colores, tallas y almacenes',
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
    permisos: 'autenticado',
  },
  {
    clave: 'pedidos',
    titulo: 'Pedidos',
    descripcion: 'Pedidos internos (forecast) y pedidos reales por CEDIS',
    ruta: '/pedidos',
    icono: 'carrito',
    permisos: 'autenticado',
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
