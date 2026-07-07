import {
  AlertTriangle,
  Banknote,
  CalendarRange,
  Calculator,
  ChartLine,
  ClipboardList,
  Factory,
  Files,
  House,
  Images,
  Layers,
  Library,
  ListChecks,
  type LucideIcon,
  Medal,
  Package,
  Receipt,
  Route,
  Scissors,
  Settings,
  Shirt,
  ShoppingCart,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react';

import type { ClavePermiso } from '@/api/tipos';

/**
 * MENÚ PRINCIPAL de CONTROL v2 — rediseño R1 (spec congelada en
 * `docs/rediseno/REDISENO-FRONTEND.md` §3.1, estructura APROBADA por Daniel el
 * 4-jul-2026): grupos (OPERACIÓN, INVENTARIOS, COMERCIAL, FINANZAS, ANÁLISIS,
 * SISTEMA) con desplegables de 2 niveles. Un padre con `hijos` SOLO despliega
 * (no navega); el hijo navega y el hijo principal va primero. Máximo 2 niveles.
 *
 * Decisiones de mapeo (lead, R1) para NO perder funcionalidad:
 *  - Las sub-vistas legadas que no aparecen en la estructura aprobada se cuelgan
 *    como HIJOS ADICIONALES bajo su padre lógico (después de los hijos
 *    aprobados). El menú se VE como el aprobado (colapsado) y nada se pierde
 *    (expandido); todo se encuentra también con Ctrl/⌘+K.
 *  - FINANZAS gana una 3ª entrada interina «EsMa (maquileros)»: EsMa se
 *    generaliza a Finanzas en F9 y mientras tanto no puede desaparecer.
 *  - El módulo «Catálogos» (/catalogos) desaparece del menú como grupo propio:
 *    telas/avíos → INVENTARIOS, clientes/proveedores → COMERCIAL, y
 *    colores/tallas/temporadas/tipos de proceso/almacenes → SISTEMA · Catálogos
 *    base. Sus RUTAS siguen vivas (los hubs quedan accesibles por URL directa).
 *  - Bordados y su galería (receta/BOM de modelos) cuelgan de Desarrollo;
 *    Etiquetas de marca cuelga de Catálogos base; Documental (aún sin construir)
 *    cuelga de Producción. Conceptos de costo y Estados de lista NO entran al
 *    menú (hoy tampoco están: se llega por el panel de administración).
 *  - Las hojas sin pantalla (Ventas, CxC, CxP, Análisis RC, Auditores) van a la
 *    página «Próximamente» con la nota de en qué fase llegan (`proximamente`).
 *  - Se CONSERVA el gate por permisos por entrada (A4): cada hoja mantiene los
 *    permisos de su entrada equivalente anterior; un padre/grupo se muestra si
 *    alguna hoja hija es visible. La pantalla esconde, el servidor decide (A1).
 */

/** Iconos por nombre (string estable); el riel los resuelve a Lucide. */
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
  | 'portapapeles'
  | 'inicio'
  | 'usuarios'
  | 'recibo'
  | 'capas'
  | 'tijeras';

/**
 * Mapa nombre estable -> componente Lucide. Vive aqui (modulo de datos, no
 * componente) para reusarse SIN romper fast-refresh: el riel
 * (`NavegacionModulos`), el inicio, la paleta ⌘K y "Proximamente" pintan el
 * icono de cada entrada a partir de este mapa.
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
  inicio: House,
  usuarios: Users,
  recibo: Receipt,
  capas: Layers,
  tijeras: Scissors,
};

/** Una HOJA del menú: navega a su ruta. (Nombre conservado por compatibilidad.) */
export interface ModuloMenu {
  /** Identificador estable (los claves históricos NO cambian entre fases). */
  clave: string;
  /** Titulo que ve el usuario (UI 100 % en español). */
  titulo: string;
  /** Que vive en la entrada; se usa en el inicio, la paleta y "Proximamente". */
  descripcion: string;
  ruta: `/${string}`;
  icono: IconoModulo;
  /**
   * Claves del catalogo de permisos que hacen visible la hoja (basta una), o
   * `"autenticado"` para entradas de uso general (A4).
   */
  permisos: readonly ClavePermiso[] | 'autenticado';
  /** Modulo estrella del plan (la Ruta Critica, D10/D11). */
  destacado?: boolean;
  /**
   * `true` si la entrada NO es un módulo del plan §5 sino una SUB-VISTA de uno.
   * Ademas de documentar, lo usan los hubs (p. ej. `InventariosPagina`) para
   * listar sus tarjetas por prefijo de ruta.
   */
  subVista?: boolean;
  /**
   * Nota de "Próximamente": la hoja aún no tiene pantalla y su ruta cae en la
   * página comodín, que muestra esta nota (p. ej. "Llega en R9").
   */
  proximamente?: string;
  /** Discriminante: una hoja nunca tiene hijos. */
  hijos?: undefined;
}

/** Un PADRE del menú: solo despliega (no navega); sus hijos navegan. */
export interface PadreMenu {
  clave: string;
  titulo: string;
  descripcion: string;
  icono: IconoModulo;
  destacado?: boolean;
  /** Hijos APROBADOS primero (el principal al frente); legados después. */
  hijos: readonly ModuloMenu[];
}

/** Una entrada de primer nivel del menú: hoja directa o padre desplegable. */
export type EntradaMenu = ModuloMenu | PadreMenu;

/** Un grupo del riel (`titulo: null` = sin rótulo, p. ej. Resumen). */
export interface GrupoMenu {
  clave: string;
  titulo: string | null;
  entradas: readonly EntradaMenu[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * La estructura aprobada (Daniel, 4-jul-2026) + hijos legados (lead, R1).
 * ──────────────────────────────────────────────────────────────────────────── */
export const GRUPOS_MENU: readonly GrupoMenu[] = [
  {
    clave: 'inicio',
    titulo: null,
    entradas: [
      {
        clave: 'resumen',
        titulo: 'Resumen',
        descripcion: 'Portada del sistema: tableros del negocio y accesos a los módulos',
        ruta: '/',
        icono: 'inicio',
        permisos: 'autenticado',
      },
    ],
  },
  {
    clave: 'operacion',
    titulo: 'Operación',
    entradas: [
      {
        clave: 'g-desarrollo',
        titulo: 'Desarrollo',
        descripcion: 'La capa previa al pedido: modelos, pre-costeos y cotizaciones (D13)',
        icono: 'portapapeles',
        hijos: [
          {
            clave: 'modelos',
            titulo: 'Modelos',
            descripcion: 'Catálogo de modelos con fotos y su receta completa (BOM)',
            ruta: '/modelos',
            icono: 'camisa',
            permisos: ['modelos.ver'],
          },
          // Pre-costeos = el módulo Desarrollo de F8-E2 (proyectos por Cliente+Departamento y sus
          // desarrollos con precosteo). Clave estable 'desarrollo'; el título es el aprobado.
          {
            clave: 'desarrollo',
            titulo: 'Pre-costeos',
            descripcion:
              'Proyectos de desarrollo por cliente y departamento, y sus desarrollos por modelo',
            ruta: '/desarrollo',
            icono: 'portapapeles',
            permisos: ['desarrollo.ver'],
          },
          {
            clave: 'listas-precios',
            titulo: 'Cotizaciones / Listas de precios',
            descripcion:
              'Listas de precios por cliente y departamento, con factores y aprobación del dueño (PDF/Excel)',
            ruta: '/listas-precios',
            icono: 'archivo',
            permisos: ['listas.ver'],
            subVista: true,
          },
          // ── Legados re-colgados (antes en Modelos / Catálogos) ──
          {
            clave: 'galeria-modelos',
            titulo: 'Galería de modelos',
            descripcion: 'Vista visual de los modelos con su foto, para enseñar producto',
            ruta: '/modelos/galeria',
            icono: 'imagenes',
            permisos: ['modelos.ver'],
            subVista: true,
          },
          // Bordados/estampados son parte de la receta (BOM) de los modelos → viven con Desarrollo.
          // Conservan el gate del hub Catálogos que los albergaba ("autenticado").
          {
            clave: 'bordados',
            titulo: 'Bordados',
            descripcion: 'Catálogo de bordados y estampados con su galería de fotos',
            ruta: '/catalogos/bordados',
            icono: 'libreria',
            permisos: 'autenticado',
            subVista: true,
          },
          {
            clave: 'galeria-bordados',
            titulo: 'Galería de bordados',
            descripcion: 'Vista visual de los bordados y estampados con su foto',
            ruta: '/catalogos/galeria-bordados',
            icono: 'imagenes',
            permisos: 'autenticado',
            subVista: true,
          },
        ],
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
        icono: 'fabrica',
        hijos: [
          {
            clave: 'ordenes',
            titulo: 'Órdenes (OP)',
            descripcion: 'Captura de órdenes de producción con matriz color × talla',
            ruta: '/produccion/ordenes',
            icono: 'fabrica',
            permisos: ['ordenes.ver'],
            subVista: true,
          },
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
          // ── Legados re-colgados (la operación diaria de F2–F4) ──
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
            clave: 'recibos',
            titulo: 'Recibo de maquila',
            descripcion:
              'Recibe prenda terminada de costura/estampado y mete a inventario lo de costura',
            ruta: '/produccion/recibos',
            icono: 'paquete',
            permisos: ['produccion.recibo'],
            subVista: true,
          },
          {
            clave: 'entregas',
            titulo: 'Entrega a cliente',
            descripcion:
              'Entrega producto terminado al cliente y cierra el pedido (salida de inventario)',
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
            clave: 'corte-semanal',
            titulo: 'Corte semanal',
            descripcion: 'Piezas cortadas por cortador y por semana',
            ruta: '/produccion/corte-semanal',
            icono: 'calendario',
            permisos: ['produccion.wip-ver'],
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
          {
            clave: 'consulta-ordenes',
            titulo: 'Consulta de órdenes',
            descripcion:
              'Localiza, imprime (individual o en lote) y salta a las órdenes de producción',
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
          {
            clave: 'notas-salida-consulta',
            titulo: 'Consulta de notas',
            descripcion:
              'Notas de salida con su encabezado, renglones y estatus (solo lectura, con PDF)',
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
          // Documental (fichas técnicas por orden) aún no se construye; cuelga de Producción
          // mientras llega su fase (la ficha técnica vive pegada a la orden).
          {
            clave: 'documental',
            titulo: 'Documental',
            descripcion: 'Fichas técnicas por orden y repositorio de adjuntos',
            ruta: '/documental',
            icono: 'archivo',
            permisos: 'autenticado',
            subVista: true,
            proximamente: 'Llega en una fase posterior del plan',
          },
        ],
      },
      {
        clave: 'ruta-critica',
        titulo: 'Ruta Crítica',
        descripcion: 'Workflow de procesos con fechas, semáforos y bandeja de tareas',
        icono: 'ruta',
        destacado: true,
        hijos: [
          // Acceso principal: la bandeja de tareas ("Mis pendientes" llega en R4).
          {
            clave: 'rc-bandeja',
            titulo: 'Bandeja de tareas',
            descripcion: 'Mis procesos pendientes de la Ruta Crítica, ordenados por urgencia',
            ruta: '/ruta-critica/bandeja',
            icono: 'lista-tareas',
            permisos: ['rc.ruta-ver'],
            subVista: true,
          },
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
            clave: 'rc-dependencias',
            titulo: 'Dependencias',
            descripcion: 'Editor del grafo de dependencias entre procesos (sin ciclos)',
            ruta: '/ruta-critica/dependencias',
            icono: 'ruta',
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
        ],
      },
      {
        clave: 'calidad',
        titulo: 'Calidad',
        descripcion: 'Auditorías AQL y catálogo de defectos',
        icono: 'medalla',
        hijos: [
          {
            clave: 'calidad-consulta-auditorias',
            titulo: 'Auditorías',
            descripcion: 'Busca auditorías, imprime su PDF y modifica o cancela las existentes',
            ruta: '/calidad/auditorias',
            icono: 'portapapeles',
            permisos: ['calidad.ver'],
            subVista: true,
          },
          // Hoja aprobada sin pantalla propia todavía → Próximamente.
          {
            clave: 'auditores',
            titulo: 'Auditores',
            descripcion: 'Catálogo de auditores de calidad',
            ruta: '/auditores',
            icono: 'usuarios',
            permisos: 'autenticado',
            proximamente: 'Llega en R9',
          },
          // ── Legados re-colgados (F6) ──
          {
            clave: 'calidad-auditorias',
            titulo: 'Alta de auditoría',
            descripcion:
              'Inspecciona una muestra de una orden, captura fallas y resuelve aprobar/reprobar',
            ruta: '/calidad/auditorias/nueva',
            icono: 'portapapeles',
            permisos: ['calidad.generar-auditorias'],
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
          {
            clave: 'calidad-defectos',
            titulo: 'Catálogo de defectos',
            descripcion:
              'Defectos del sistema AQL con severidad, nivel y tipos de producto aplicables',
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
            descripcion:
              'Tablas de muestreo AQL: tamaño de muestra y límites de aceptación/rechazo',
            ruta: '/calidad/planes-aql',
            icono: 'medalla',
            permisos: ['calidad.ver'],
            subVista: true,
          },
        ],
      },
    ],
  },
  {
    clave: 'inventarios',
    titulo: 'Inventarios',
    entradas: [
      {
        clave: 'inventarios',
        titulo: 'Inventario PT',
        descripcion: 'Kardex de producto terminado: existencias, movimientos y traspasos',
        icono: 'almacen',
        hijos: [
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
            clave: 'inventario-kardex',
            titulo: 'Kardex PT',
            descripcion: 'Movimientos con saldo corrido por modelo y detalle por folio',
            ruta: '/inventarios/kardex',
            icono: 'almacen',
            permisos: ['inventario-pt.ver'],
            subVista: true,
          },
        ],
      },
      {
        clave: 'telas',
        titulo: 'Telas',
        descripcion: 'Inventario de telas por lote (D5) y su catálogo',
        icono: 'capas',
        hijos: [
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
            clave: 'inventario-telas-salida-orden',
            titulo: 'Salida de tela a orden',
            descripcion: 'Descuenta tela del inventario ligándola a una orden de producción',
            ruta: '/inventarios/telas/salida-orden',
            icono: 'paquete',
            permisos: ['inventario-telas.mover'],
            subVista: true,
          },
          // Las vistas de "materiales" (telas + avíos juntos) cuelgan aquí: el flujo de telas es
          // el dominante y duplicarlas bajo Avíos ensuciaría el menú (decisión del lead, R1).
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
          // El catálogo de telas (antes bajo el hub Catálogos) conserva su gate "autenticado".
          {
            clave: 'catalogo-telas',
            titulo: 'Catálogo de telas',
            descripcion: 'Catálogo de telas con su composición y proveedores',
            ruta: '/catalogos/telas',
            icono: 'capas',
            permisos: 'autenticado',
            subVista: true,
          },
        ],
      },
      {
        clave: 'avios',
        titulo: 'Avíos',
        descripcion: 'Inventario de avíos multi-almacén (R4) y su catálogo',
        icono: 'tijeras',
        hijos: [
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
            clave: 'catalogo-avios',
            titulo: 'Catálogo de avíos',
            descripcion: 'Catálogo de avíos y habilitación con sus medidas por talla',
            ruta: '/catalogos/avios',
            icono: 'tijeras',
            permisos: 'autenticado',
            subVista: true,
          },
        ],
      },
      {
        clave: 'compras',
        titulo: 'Compras / MRP',
        descripcion: 'Explosión de materiales, órdenes de compra y recepciones',
        icono: 'carrito',
        hijos: [
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
            clave: 'explosion-materiales',
            titulo: 'Explosión de materiales',
            descripcion:
              'Qué y cuánto comprar por orden (BOM × cantidades) y generar la OC en un clic',
            ruta: '/compras/explosion',
            icono: 'calculadora',
            permisos: ['compras.ver'],
            subVista: true,
          },
          {
            clave: 'estatus-materiales',
            titulo: 'Qué tengo / qué falta',
            descripcion:
              'Semáforo de materiales por orden: requerido vs en órdenes de compra vs recibido',
            ruta: '/compras/estatus-materiales',
            icono: 'grafica',
            permisos: ['compras.ver'],
            subVista: true,
          },
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
        ],
      },
    ],
  },
  {
    clave: 'comercial',
    titulo: 'Comercial',
    entradas: [
      {
        clave: 'clientes',
        titulo: 'Clientes',
        descripcion: 'Clientes, sus listas de precios y sus ventas',
        icono: 'usuarios',
        hijos: [
          // El catálogo de clientes (antes bajo el hub Catálogos) conserva su gate "autenticado".
          {
            clave: 'clientes-catalogo',
            titulo: 'Catálogo',
            descripcion: 'Catálogo de clientes con sus CEDIS y campos de referencia (D7)',
            ruta: '/catalogos/clientes',
            icono: 'usuarios',
            permisos: 'autenticado',
          },
          // MISMA pantalla que la de Desarrollo (deliberado, estructura aprobada): la lista de
          // precios se trabaja desde ambos mundos. Clave propia para que el menú no repita claves.
          {
            clave: 'clientes-listas-precios',
            titulo: 'Listas de precios',
            descripcion:
              'Listas de precios por cliente y departamento, con factores y aprobación del dueño (PDF/Excel)',
            ruta: '/listas-precios',
            icono: 'archivo',
            permisos: ['listas.ver'],
            subVista: true,
          },
          {
            clave: 'ventas',
            titulo: 'Ventas',
            descripcion: 'Ventas por cliente (facturación y entregas)',
            ruta: '/ventas',
            icono: 'grafica',
            permisos: 'autenticado',
            proximamente: 'Llega en R9',
          },
        ],
      },
      // Acceso directo al catálogo (Daniel: sin desplegable de un solo elemento).
      {
        clave: 'proveedores',
        titulo: 'Proveedores',
        descripcion: 'Catálogo de proveedores enriquecido (R15): fiscal, contacto, pago',
        ruta: '/catalogos/proveedores',
        icono: 'camion',
        permisos: 'autenticado',
      },
    ],
  },
  {
    clave: 'finanzas',
    titulo: 'Finanzas',
    entradas: [
      {
        clave: 'cxc',
        titulo: 'Cuentas por cobrar',
        descripcion: 'Cuenta corriente de clientes: facturas, pagos y saldos (D12)',
        ruta: '/cxc',
        icono: 'billete',
        permisos: 'autenticado',
        proximamente: 'Llega con Finanzas (F9)',
      },
      {
        clave: 'cxp',
        titulo: 'Cuentas por pagar',
        descripcion: 'Cuenta corriente de proveedores: facturas, pagos y saldos (D12)',
        ruta: '/cxp',
        icono: 'recibo',
        permisos: 'autenticado',
        proximamente: 'Llega con Finanzas (F9)',
      },
      // Entrada INTERINA (decisión del lead, R1): EsMa se generaliza a Finanzas en F9; mientras
      // tanto la cuenta corriente de maquileros no puede desaparecer del menú.
      {
        clave: 'esma',
        titulo: 'EsMa (maquileros)',
        descripcion: 'Estados de cuenta de maquileros: cargos, abonos y pagos',
        icono: 'billete',
        hijos: [
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
            descripcion:
              'Detalle por orden/modelo, exportable a Excel y como PDF del estado de cuenta',
            ruta: '/esma/desglosado',
            icono: 'billete',
            permisos: ['esma.ver-pagos'],
            subVista: true,
          },
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
            clave: 'validacion-cargos',
            titulo: 'Validación de cargos',
            descripcion: 'Revisa y valida los cargos de maquila propuestos por los recibos',
            ruta: '/esma/validacion-cargos',
            icono: 'billete',
            permisos: ['esma.cargo-validar'],
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
        ],
      },
    ],
  },
  {
    clave: 'analisis',
    titulo: 'Análisis',
    entradas: [
      {
        clave: 'analisis-rc',
        titulo: 'Análisis RC',
        descripcion: 'Análisis de la Ruta Crítica: cumplimiento, atrasos y cuellos de botella',
        ruta: '/analisis-rc',
        icono: 'grafica',
        permisos: 'autenticado',
        proximamente: 'Llega en R7',
      },
      {
        clave: 'costos',
        titulo: 'Costos',
        descripcion: 'Pre-costo por modelo, costo real por orden y márgenes por pedido',
        icono: 'calculadora',
        hijos: [
          {
            clave: 'costos-pre-costo',
            titulo: 'Pre-costo por modelo',
            descripcion:
              'Costo estimado de un modelo (receta × catálogo + maquila) y precio sugerido',
            ruta: '/costos/pre-costo',
            icono: 'camisa',
            permisos: ['precostos.consultar'],
            subVista: true,
          },
          {
            clave: 'costos-lista-precios',
            titulo: 'Lista de precios',
            descripcion:
              'Precio de venta sugerido por modelo (utilidad + regalías), con PDF por género',
            ruta: '/costos/lista-precios',
            icono: 'archivo',
            permisos: ['precostos.consultar'],
            subVista: true,
          },
          {
            clave: 'costos-costeo',
            titulo: 'Costeo de orden',
            descripcion:
              'Costo real de una orden: teórico vs guardado, con su costo unitario por base',
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
            descripcion:
              'Importe, margen promedio, margen ponderado y margen $ por pieza (PDF/Excel)',
            ruta: '/costos/margenes',
            icono: 'grafica',
            permisos: ['costos.ver'],
            subVista: true,
          },
        ],
      },
      {
        clave: 'edr',
        titulo: 'EDR',
        descripcion: 'P&L mensual consolidado desde las entregas a cliente, a costo actual',
        icono: 'grafica',
        hijos: [
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
            descripcion:
              'Ajusta el precio facturado y las cantidades; agrega o borra líneas manuales',
            ruta: '/edr/conciliacion',
            icono: 'lista-tareas',
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
        ],
      },
      {
        clave: 'indicadores',
        titulo: 'Indicadores',
        descripcion: 'Tableros directivos, productividad, fichas confiables y muestrarios',
        icono: 'grafica',
        hijos: [
          {
            clave: 'indicadores-ruta-critica',
            titulo: 'KPIs de Ruta Crítica',
            descripcion: 'Entregas a tiempo, lead time, cuellos de botella y desempeño (PDF/Excel)',
            ruta: '/indicadores/ruta-critica',
            icono: 'ruta',
            permisos: ['indicadores.ver'],
            subVista: true,
          },
          {
            clave: 'indicadores-calidad',
            titulo: 'Calidad por maquilero',
            descripcion: '% de aprobación por maquilero, defectos top y tendencia (PDF/Excel)',
            ruta: '/indicadores/calidad',
            icono: 'medalla',
            permisos: ['indicadores.ver'],
            subVista: true,
          },
          {
            clave: 'indicadores-wip',
            titulo: 'WIP analítico',
            descripcion: 'Prendas atoradas por etapa y avance por orden (PDF/Excel)',
            ruta: '/indicadores/wip',
            icono: 'paquete',
            permisos: ['indicadores.ver'],
            subVista: true,
          },
          {
            clave: 'productividad-captura',
            titulo: 'Captura de productividad',
            descripcion: 'Registra la productividad de IP y almacén (Hoy/Ayer/Sábado)',
            ruta: '/indicadores/productividad/captura',
            icono: 'portapapeles',
            permisos: ['indicadores.ip-productividad', 'indicadores.almacen-productividad'],
            subVista: true,
          },
          {
            clave: 'productividad-tablero',
            titulo: 'Productividad vs estándar',
            descripcion: 'Índices agregados por periodo, actividad y persona',
            ruta: '/indicadores/productividad/tablero',
            icono: 'grafica',
            permisos: ['indicadores.ip-productividad', 'indicadores.almacen-productividad'],
            subVista: true,
          },
          {
            clave: 'productividad-catalogos',
            titulo: 'Catálogos de productividad',
            descripcion: 'Personas y actividades por área, con sus estándares',
            ruta: '/indicadores/productividad/catalogos',
            icono: 'libreria',
            permisos: ['indicadores.ip-productividad', 'indicadores.almacen-productividad'],
            subVista: true,
          },
          {
            clave: 'fichas-confiables',
            titulo: 'Fichas confiables',
            descripcion: 'Checklist de confiabilidad de la ficha técnica por orden y su %',
            ruta: '/indicadores/fichas-confiables',
            icono: 'portapapeles',
            permisos: ['indicadores.ip-confiabilidad'],
            subVista: true,
          },
          {
            clave: 'muestrarios',
            titulo: 'Muestrarios',
            descripcion: 'Boards y muestras solicitados, con su cumplimiento',
            ruta: '/indicadores/muestrarios',
            icono: 'paquete',
            permisos: ['indicadores.ip-muestrarios'],
            subVista: true,
          },
          {
            clave: 'inventarios-ciclicos',
            titulo: 'Inventarios cíclicos',
            descripcion:
              'Conteo físico contra el kardex: el alta congela el teórico y el ajuste es un movimiento',
            ruta: '/indicadores/ciclicos',
            icono: 'paquete',
            permisos: [
              'indicadores.ciclicos-alta',
              'indicadores.ciclicos-conteo',
              'indicadores.ciclicos-consulta',
            ],
            subVista: true,
          },
        ],
      },
    ],
  },
  {
    clave: 'sistema',
    titulo: 'Sistema',
    entradas: [
      // Catálogos base = listas de referencia de baja frecuencia (Daniel, 4-jul). Conservan el
      // gate del hub Catálogos que las albergaba ("autenticado"), salvo Tipos de proceso que ya
      // tenía permiso propio.
      {
        clave: 'catalogos',
        titulo: 'Catálogos base',
        descripcion: 'Listas de referencia: colores, tallas, temporadas, procesos y almacenes',
        icono: 'libreria',
        hijos: [
          {
            clave: 'colores',
            titulo: 'Colores',
            descripcion: 'Catálogo global de colores con su muestra visual',
            ruta: '/catalogos/colores',
            icono: 'libreria',
            permisos: 'autenticado',
            subVista: true,
          },
          {
            clave: 'tallas',
            titulo: 'Tallas',
            descripcion: 'Tallas ilimitadas (D4) y curvas de tallas',
            ruta: '/catalogos/tallas',
            icono: 'libreria',
            permisos: 'autenticado',
            subVista: true,
          },
          {
            clave: 'temporadas',
            titulo: 'Temporadas',
            descripcion: 'Temporadas comerciales para clasificar modelos y pedidos',
            ruta: '/catalogos/temporadas',
            icono: 'calendario',
            permisos: 'autenticado',
            subVista: true,
          },
          {
            clave: 'tipos-proceso',
            titulo: 'Tipos de proceso',
            descripcion: 'Catálogo de procesos de maquila (costura, estampado, bordado, lavado…)',
            ruta: '/produccion/tipos-proceso',
            icono: 'engrane',
            permisos: ['tipos-proceso.ver'],
            subVista: true,
          },
          {
            clave: 'almacenes',
            titulo: 'Almacenes',
            descripcion: 'Almacenes de producto terminado, telas y avíos',
            ruta: '/catalogos/almacenes',
            icono: 'almacen',
            permisos: 'autenticado',
            subVista: true,
          },
          // ── Legado re-colgado (antes en el hub Catálogos) ──
          {
            clave: 'etiquetas-marca',
            titulo: 'Etiquetas de marca',
            descripcion: 'Etiquetas de marca que se cosen a los modelos',
            ruta: '/catalogos/etiquetas-marca',
            icono: 'libreria',
            permisos: 'autenticado',
            subVista: true,
          },
        ],
      },
      // Config de la Ruta Crítica: procesos · tiempos · antecesores · responsables (la pantalla
      // unificada llega en R4; mientras, el catálogo de procesos actual).
      {
        clave: 'rc-procesos',
        titulo: 'Procesos y responsables',
        descripcion: 'Catálogo configurable de procesos: banderas, roles responsables y checklists',
        ruta: '/ruta-critica/procesos',
        icono: 'lista-tareas',
        permisos: ['rc.catalogo-ver'],
        subVista: true,
      },
      {
        clave: 'administracion',
        titulo: 'Usuarios y accesos',
        descripcion: 'Usuarios, roles y permisos, empresas, configuración y bitácora',
        icono: 'engrane',
        hijos: [
          {
            clave: 'administracion-panel',
            titulo: 'Panel de administración',
            descripcion: 'Usuarios, roles y permisos, empresas y configuración',
            ruta: '/administracion',
            icono: 'engrane',
            permisos: [
              'usuarios.administrar',
              'roles.administrar',
              'empresas.administrar',
              'almacenes.administrar',
            ],
          },
          {
            clave: 'bitacora',
            titulo: 'Bitácora',
            descripcion:
              'Auditoría de cambios del sistema: quién, qué, cuándo y sobre qué registro',
            ruta: '/administracion/bitacora',
            icono: 'portapapeles',
            permisos: ['admin.ver-bitacora'],
            subVista: true,
          },
          {
            clave: 'config-ruta-critica',
            titulo: 'Configuración de Ruta Crítica',
            descripcion: 'Colchón de costura, calendario laboral y festivos por empresa',
            ruta: '/administracion/ruta-critica',
            icono: 'calendario',
            permisos: ['empresas.administrar'],
            subVista: true,
          },
        ],
      },
    ],
  },
];

/**
 * Todas las HOJAS del menú, aplanadas (padres → hijos, en orden). La usan los
 * hubs (`InventariosPagina`, `RutaCriticaPagina`), el inicio y la paleta ⌘K.
 * Nombre conservado del menú plano anterior por compatibilidad.
 */
export const MODULOS_MENU: readonly ModuloMenu[] = GRUPOS_MENU.flatMap((grupo) =>
  grupo.entradas.flatMap((entrada) => (entrada.hijos !== undefined ? entrada.hijos : [entrada])),
);

/** Los PADRES desplegables del menú (para búsquedas por clave). */
const PADRES_MENU: readonly PadreMenu[] = GRUPOS_MENU.flatMap((grupo) =>
  grupo.entradas.filter((entrada): entrada is PadreMenu => entrada.hijos !== undefined),
);

/** ¿La hoja es visible con estos permisos? (A4) */
export function esModuloVisible(modulo: ModuloMenu, permisos: ReadonlySet<ClavePermiso>): boolean {
  if (modulo.permisos === 'autenticado') {
    return true;
  }
  return modulo.permisos.some((clave) => permisos.has(clave));
}

/** ¿La entrada es visible? Un padre se muestra si ALGUNA hoja hija es visible. */
export function esEntradaVisible(
  entrada: EntradaMenu,
  permisos: ReadonlySet<ClavePermiso>,
): boolean {
  if (entrada.hijos !== undefined) {
    return entrada.hijos.some((hijo) => esModuloVisible(hijo, permisos));
  }
  return esModuloVisible(entrada, permisos);
}

/**
 * Filtra las HOJAS visibles para un conjunto de permisos efectivos (aplanadas).
 * Funcion pura: la usan la paleta ⌘K, el inicio y los tests.
 */
export function filtrarModulosVisibles(permisos: ReadonlySet<ClavePermiso>): readonly ModuloMenu[] {
  return MODULOS_MENU.filter((modulo) => esModuloVisible(modulo, permisos));
}

/**
 * Filtra el menú AGRUPADO para el riel: descarta hojas sin permiso, poda los
 * hijos de cada padre, y elimina padres/grupos que quedaron vacíos.
 */
export function filtrarGruposVisibles(permisos: ReadonlySet<ClavePermiso>): readonly GrupoMenu[] {
  return GRUPOS_MENU.map((grupo) => {
    const entradas = grupo.entradas
      .map((entrada): EntradaMenu | null => {
        if (entrada.hijos === undefined) {
          return esModuloVisible(entrada, permisos) ? entrada : null;
        }
        const hijos = entrada.hijos.filter((hijo) => esModuloVisible(hijo, permisos));
        return hijos.length > 0 ? { ...entrada, hijos } : null;
      })
      .filter((entrada): entrada is EntradaMenu => entrada !== null);
    return { ...grupo, entradas };
  }).filter((grupo) => grupo.entradas.length > 0);
}

/**
 * Busca una entrada por su clave: primero las hojas, luego los padres. Los
 * padres entran porque las rutas legadas `/produccion` y `/compras` (hoy sin
 * pantalla propia) siguen cayendo en la página comodín, que los presenta.
 */
export function buscarModuloPorClave(clave: string): EntradaMenu | undefined {
  return (
    MODULOS_MENU.find((modulo) => modulo.clave === clave) ??
    PADRES_MENU.find((padre) => padre.clave === clave)
  );
}
