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
 * MENÚ PRINCIPAL de CONTROL v2 — spec congelada en
 * `docs/rediseno/REDISENO-FRONTEND.md` §3.1 / `prototipo.html` `const NAV`
 * (estructura APROBADA por Daniel el 4-jul-2026).
 *
 * DOS estructuras separadas (rediseño de fidelidad del menú, sobre R1–R4):
 *
 *  1. EL CATÁLOGO COMPLETO (`GRUPOS_MENU`): el registro EXHAUSTIVO de TODAS las
 *     pantallas (hojas + sub-vistas legadas), cada una con su ruta, su gate de
 *     permisos (A4) y su descripción. Alimenta ⌘K (`filtrarCatalogoVisible`),
 *     los hubs de módulo, los títulos de página y la página «Próximamente».
 *     NADA se pierde: aunque una pantalla no salga en el riel, sigue viva por
 *     su ruta directa y por ⌘K. Aquí NO se toca ningún permiso.
 *
 *  2. EL RIEL (`RIEL_GRUPOS`): la PROYECCIÓN PODADA que ve el menú lateral —
 *     EXACTAMENTE la estructura de Daniel, ni una entrada de más. Se deriva del
 *     catálogo referenciando claves (hereda ruta/permisos/icono/descr.), sin
 *     duplicar datos. Un padre con `hijos` SOLO despliega (no navega); el hijo
 *     navega y el hijo principal va primero. Máximo 2 niveles. Alimenta el
 *     sidebar (`filtrarGruposVisibles`) y la portada (`Inicio`).
 *
 * Lo secundario (galerías, sub-vistas de F3/F4/F6/F7, catálogos de referencia
 * que R2–R4 ya reemplazaron) NO es entrada del riel: se alcanza desde su
 * pantalla padre (mosaicos, tabs, sub-nav) + ⌘K, tal como el prototipo.
 *
 * ÚNICA desviación del NAV de Daniel: FINANZAS suma «EsMa (maquileros)» como
 * hoja interina (EsMa se generaliza a Finanzas en F9 y hasta entonces no puede
 * orfanarse). El HTML no lo tiene; todo lo demás es fiel 1:1.
 *
 * Gate por permisos INTACTO (A4): cada hoja del catálogo conserva EXACTAMENTE
 * su permiso; un padre/grupo se muestra si alguna hoja hija es visible. La
 * pantalla esconde, el servidor decide (A1). La definición del riel está al
 * final del archivo (`ESPEC_RIEL`).
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
   * página comodín, que muestra esta nota (p. ej. "Llega con Finanzas (F9)").
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
            // «Cotizaciones» a secas: el título largo ("Cotizaciones / Listas de
            // precios") se TRUNCABA feo en el riel (queja de Gabriel, 9-jul-2026).
            // Bajo el padre «Desarrollo» es inequívoco; «Listas de precios» sigue
            // existiendo bajo Clientes (misma pantalla) y la descripción conserva
            // el nombre completo para que ⌘K lo encuentre por cualquiera de los dos.
            titulo: 'Cotizaciones',
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
          // El ARTE (bordado/estampado) dejó de ser catálogo en V1-E3d (§Post-F9.35): vive DENTRO
          // del modelo y se captura en su receta. Lo que sobrevive es la GALERÍA, armada desde los
          // modelos —cada foto dice de qué modelo es— y gobernada por `modelos.ver`.
          {
            clave: 'galeria-arte',
            titulo: 'Galería de arte',
            descripcion: 'Vista visual del arte (bordado y estampado) con su modelo',
            ruta: '/arte/galeria',
            icono: 'imagenes',
            permisos: ['modelos.ver'],
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
            descripcion:
              'Centro de comando de órdenes: filtros ágiles, avance de producción y precios (R2)',
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
          //
          // ⚠️ «Captura de corte», «Envío a maquila» y «Recibo de maquila» YA NO SON HOJAS
          // (V1-E3a, 13-ago-2026): eran TRES pantallas del MISMO acto que ya vive en el panel de
          // AVANCE DE PRODUCCIÓN del Centro de Órdenes, y ninguna de las dos mitades era completa
          // (las viejas imprimían y capturaban segundas; el panel tenía el default de maquilero y
          // el typeahead). Daniel lo cerró en `DECISIONES.md §Post-F9.36 punto 2`: *"Ok. Una sola
          // pantalla está bien."* → se retiraron del catálogo (y por tanto de ⌘K) tras migrarle al
          // panel lo que solo ellas tenían. Sus rutas `/produccion/{corte,envios,recibos}` siguen
          // vivas como REDIRECCIÓN a `/produccion/ordenes` (`App.tsx`), para no romper marcadores.
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
            clave: 'archivo-ordenes',
            titulo: 'Archivo de órdenes',
            descripcion:
              'Producción del sistema anterior (solo consulta): busca por cliente, modelo, tipo de prenda, fecha o maquilero',
            ruta: '/produccion/archivo-ordenes',
            icono: 'lista-tareas',
            permisos: ['ordenes.ver'],
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
      // Ruta Crítica = HOJA DIRECTA a "Mis pendientes" (R4: revierte la desviación interina (a)
      // de R1 — decisión Daniel 6-jul: la operación diaria es la guía por persona). Las vistas de
      // configuración viven bajo SISTEMA · Procesos y responsables; el concentrado, en ANÁLISIS.
      {
        clave: 'ruta-critica',
        titulo: 'Ruta Crítica',
        descripcion: 'Mis pendientes: tu guía diaria de procesos de la Ruta Crítica',
        ruta: '/ruta-critica/pendientes',
        icono: 'ruta',
        destacado: true,
        permisos: ['rc.ruta-ver'],
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
          {
            clave: 'auditores',
            titulo: 'Auditores',
            descripcion: 'Catálogo de auditores de calidad',
            ruta: '/auditores',
            icono: 'usuarios',
            permisos: ['calidad.ver'],
            subVista: true,
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
        descripcion: 'Inventario de telas por color (partidas, A2) y su catálogo',
        icono: 'capas',
        hijos: [
          // Los 4 hijos APROBADOS del riel van PRIMERO (existencias por color = la principal;
          // pedido de Daniel 6-ago-2026: que el catálogo de telas se VEA en el menú).
          {
            clave: 'inventario-telas-existencias',
            titulo: 'Existencias de telas',
            descripcion:
              'Existencia por tela y color (cuerpo y complemento juntos) con kardex por color',
            ruta: '/inventarios/telas/existencias',
            icono: 'almacen',
            permisos: ['inventario-telas.ver'],
            subVista: true,
          },
          // El catálogo de telas (antes bajo el hub Catálogos) conserva su gate "autenticado", como
          // TODA la familia de catálogos de uso general (colores, tallas, temporadas, almacenes,
          // clientes, proveedores, etiquetas de marca, bordados, avíos): es el pedido de Daniel en
          // A2 — «que el catálogo de telas siempre se vea en el menú, como los demás catálogos de
          // uso general». El backend sí exige `telas.ver` en `GET /telas`, así que a un rol sin ese
          // permiso la entrada le aparece y le da 403; ese desajuste es de la FAMILIA COMPLETA
          // (8 de 10 hojas están igual, 4 de ellas dentro del padre «Catálogos base» del riel) y se
          // arregla parejo o no se arregla — con decisión de Daniel de por medio. Deuda anotada en
          // `HOJA-DE-RUTA.md` §4. Alinear solo telas/avíos sería una excepción sin razón.
          {
            clave: 'catalogo-telas',
            titulo: 'Catálogo de telas',
            descripcion: 'Catálogo de telas con su composición y proveedores',
            ruta: '/catalogos/telas',
            icono: 'capas',
            permisos: 'autenticado',
            subVista: true,
          },
          {
            clave: 'inventario-telas-salida-orden',
            titulo: 'Salida de tela a orden',
            descripcion:
              'Descuenta tela POR COLOR ligándola a una orden (avisa el riesgo de tono, sin bloquear)',
            ruta: '/inventarios/telas/salida-orden',
            icono: 'paquete',
            permisos: ['inventario-telas.mover'],
            subVista: true,
          },
          {
            clave: 'inventario-telas-entradas',
            titulo: 'Entradas de tela por factura',
            descripcion:
              'Entrada SIN orden de compra: factura o remisión del proveedor con N partidas y su PDF',
            ruta: '/inventarios/telas/entradas',
            icono: 'paquete',
            permisos: ['inventario-telas.ver'],
            subVista: true,
          },
          {
            clave: 'inventario-telas-ajuste',
            titulo: 'Ajuste de telas por color',
            descripcion:
              'Conteo físico / arranque desde cero por color: la entrada crea la partida',
            ruta: '/inventarios/telas/ajuste',
            icono: 'paquete',
            permisos: ['inventario-telas.mover'],
            subVista: true,
          },
          // Sub-vistas fuera del riel (⌘K / URL directa).
          {
            clave: 'inventario-telas-traspaso',
            titulo: 'Traspaso de telas por color',
            descripcion: 'Mueve tela por color entre almacenes (cuerpo y complemento juntos)',
            ruta: '/inventarios/telas/traspaso',
            icono: 'paquete',
            permisos: ['inventario-telas.mover'],
            subVista: true,
          },
          {
            clave: 'inventario-telas-existencias-lote',
            titulo: 'Existencias por lote (legado)',
            descripcion: 'Vista LEGADA del flujo viejo por lote (solo consulta)',
            ruta: '/inventarios/telas/existencias-lote',
            icono: 'almacen',
            permisos: ['inventario-telas.ver'],
            subVista: true,
          },
          {
            clave: 'inventario-telas-salida-orden-lote',
            titulo: 'Salida a orden por lote (legado)',
            descripcion:
              'Captura LEGADA de la salida a orden por lote (el flujo nuevo va por color)',
            ruta: '/inventarios/telas/salida-orden-lote',
            icono: 'paquete',
            permisos: ['inventario-telas.mover'],
            subVista: true,
          },
          // Las vistas de "materiales" que sirven a las DOS dimensiones (telas por lote + avíos)
          // cuelgan aquí: el flujo de telas es el dominante y duplicarlas bajo Avíos ensuciaría el
          // menú (decisión del lead, R1). Ya solo son DOS: el ajuste se volvió solo-avíos el
          // 13-ago-2026 y se mudó al grupo «Avíos».
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
          // Mismo criterio que el catálogo de telas: "autenticado" como toda la familia de
          // catálogos de uso general (ver el comentario allá arriba y la deuda de `HOJA-DE-RUTA.md`
          // §4). El backend exige `avios.ver` en `GET /avios`; el desajuste es de la familia entera.
          {
            clave: 'catalogo-avios',
            titulo: 'Catálogo de avíos',
            descripcion: 'Catálogo de avíos con sus medidas por talla',
            ruta: '/catalogos/avios',
            icono: 'tijeras',
            permisos: 'autenticado',
            subVista: true,
          },
          {
            // AQUÍ, bajo Avíos, desde el 13-ago-2026. Vivía bajo «Telas» como «Ajuste de
            // materiales» porque servía a las dos dimensiones, pero su pestaña de TELAS estaba
            // atada al motor LEGADO por lote —y la pantalla ARRANCABA en ella—, así que lo
            // capturado ahí no aparecía en «Existencias de telas» (la vista `existencia_tela_color`
            // excluye los renglones con `id_tela_color = NULL`). Al quedarse SOLO con avíos, dejarla
            // colgando de «Telas» escondía la pantalla justo de quien la busca: se desplegaba
            // «Avíos» y no estaba. El ajuste de TELA es «Ajuste de telas por color», hijo de
            // «Telas». Su gate se estrechó al permiso que de verdad usa (A4).
            clave: 'inventario-materiales-ajustes',
            titulo: 'Ajuste de avíos',
            descripcion:
              'Ajuste / inventario físico de avíos (entrada o salida, motivo obligatorio)',
            ruta: '/inventarios/materiales/ajustes',
            icono: 'paquete',
            permisos: ['inventario-avios.mover'],
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
            descripcion: 'Bandeja de órdenes de compra en borrador, por autorizar (desde el móvil)',
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
            descripcion: 'Facturación por modelo del cliente (base del EDR)',
            ruta: '/ventas',
            icono: 'grafica',
            permisos: ['edr.ver'],
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
      {
        clave: 'directorio-historico',
        titulo: 'Directorio histórico',
        descripcion:
          'Teléfonos y direcciones de los terceros del sistema anterior (solo consulta; NO es el catálogo)',
        ruta: '/catalogos/directorio-historico',
        icono: 'camion',
        permisos: ['proveedores.ver'],
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
        descripcion:
          'Cuenta corriente de clientes: bandeja por cobrar con antigüedad de saldos, estado de cuenta, cobros e importación de CFDI de venta (D12, F9-E4)',
        ruta: '/cxc',
        icono: 'billete',
        permisos: ['cxc.ver'],
      },
      {
        clave: 'cxp',
        titulo: 'Cuentas por pagar',
        descripcion:
          'Cuenta corriente de proveedores: bandeja por pagar con antigüedad de saldos, estado de cuenta y pagos (D12, F9-E2)',
        ruta: '/cxp',
        icono: 'recibo',
        permisos: ['cxp.ver'],
      },
      {
        clave: 'reportes-fiscales',
        titulo: 'Reportes fiscales',
        descripcion:
          'Información fiscal para el contador: movimientos con CFDI de clientes y proveedores, salud fiscal y export Excel/PDF (D12, R13, F9-E5)',
        ruta: '/reportes-fiscales',
        icono: 'billete',
        permisos: ['terceros.fiscal'],
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
        permisos: ['rc.ruta-ver'],
      },
      // Hija INTERINA (decisión R4): el concentrado planeado-vs-real es ANÁLISIS, no operación
      // diaria; vive junto a "Análisis RC" hasta que R7 lo absorba/reacomode.
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
      // Config de la Ruta Crítica (R4): la pantalla unificada "Procesos y responsables" es el
      // acceso principal; las demás vistas de configuración (plantillas, reglas de duración,
      // dependencias y el catálogo avanzado) cuelgan como hijas — enlazadas también desde la
      // propia pantalla (sub-nav) y accesibles por ⌘K.
      {
        clave: 'g-rc-config',
        titulo: 'Procesos y responsables',
        descripcion:
          'Configuración de la Ruta Crítica: procesos, tiempos, antecesores y responsables',
        icono: 'lista-tareas',
        hijos: [
          {
            clave: 'rc-procesos-responsables',
            titulo: 'Procesos y responsables',
            descripcion:
              'Catálogo de procesos de la RC: responsables, tiempos, dependencias y auto-completado',
            ruta: '/ruta-critica/procesos-responsables',
            icono: 'lista-tareas',
            permisos: ['rc.catalogo-ver'],
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
            clave: 'rc-reglas-duracion',
            titulo: 'Reglas de duración',
            descripcion: 'Factores por cantidad, días por tela/aplicación y rangos de dificultad',
            ruta: '/ruta-critica/reglas-duracion',
            icono: 'calendario',
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
            clave: 'rc-procesos',
            titulo: 'Catálogo de procesos (avanzado)',
            descripcion:
              'Catálogo configurable de procesos: banderas, roles responsables y checklists',
            ruta: '/ruta-critica/procesos',
            icono: 'lista-tareas',
            permisos: ['rc.catalogo-ver'],
            subVista: true,
          },
        ],
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
 * Todas las HOJAS del CATÁLOGO COMPLETO, aplanadas (padres → hijos, en orden).
 * Es el registro EXHAUSTIVO de pantallas: lo usan los hubs (p. ej.
 * `InventariosPagina`), el inicio, la paleta ⌘K, los títulos y «Próximamente».
 * NADA se pierde aquí aunque el riel no lo muestre. Nombre conservado del menú
 * plano anterior por compatibilidad.
 */
export const MODULOS_MENU: readonly ModuloMenu[] = GRUPOS_MENU.flatMap((grupo) =>
  grupo.entradas.flatMap((entrada) => (entrada.hijos !== undefined ? entrada.hijos : [entrada])),
);

/** Los PADRES desplegables del catálogo completo (para búsquedas por clave). */
const PADRES_MENU: readonly PadreMenu[] = GRUPOS_MENU.flatMap((grupo) =>
  grupo.entradas.filter((entrada): entrada is PadreMenu => entrada.hijos !== undefined),
);

/* ────────────────────────────────────────────────────────────────────────────
 * EL RIEL — estructura EXACTA aprobada por Daniel (REDISENO-FRONTEND.md §3.1 /
 * prototipo.html `const NAV`). El menú lateral muestra SOLO esto; todo lo demás
 * del catálogo sigue vivo por ruta directa y por ⌘K (`filtrarCatalogoVisible`).
 *
 * Es una PROYECCIÓN PODADA del catálogo: cada entrada referencia una clave del
 * catálogo y hereda su ruta/permisos/icono/descripción. Tres formas:
 *  - `hoja`     → una hoja del catálogo tal cual (entrada de primer nivel).
 *  - `padre`    → un desplegable con SOLO los hijos aprobados (por clave, en
 *                 orden; el principal primero). Los hijos legados quedan fuera
 *                 del riel pero vivos en el catálogo/⌘K.
 *  - `colapsar` → un padre del catálogo que Daniel quiere como HOJA DIRECTA: se
 *                 pinta como una sola hoja que navega a su pantalla principal
 *                 (`ruta`) con el gate `permisos` de esa pantalla. Cuando el
 *                 destino es un HUB que auto-filtra sus tarjetas (Costos, EDR,
 *                 Indicadores, EsMa) se usa la UNIÓN de permisos de los hijos
 *                 para preservar EXACTO a quién le aparece el padre. Sus
 *                 sub-vistas salen del riel y se alcanzan desde esa pantalla + ⌘K.
 * ──────────────────────────────────────────────────────────────────────────── */
type EspecRiel =
  | { tipo: 'hoja'; clave: string }
  | { tipo: 'padre'; clave: string; hijos: readonly string[] }
  | { tipo: 'colapsar'; clave: string; ruta: `/${string}`; permisos: readonly ClavePermiso[] };

const ESPEC_RIEL: readonly { grupo: string; entradas: readonly EspecRiel[] }[] = [
  { grupo: 'inicio', entradas: [{ tipo: 'hoja', clave: 'resumen' }] },
  {
    grupo: 'operacion',
    entradas: [
      { tipo: 'padre', clave: 'g-desarrollo', hijos: ['modelos', 'desarrollo', 'listas-precios'] },
      { tipo: 'hoja', clave: 'pedidos' },
      {
        // Producción DESTAPADA (V1-E3a, 13-ago-2026): hasta hoy el padre solo mostraba «Órdenes
        // (OP)» y «Notas de salida», y las OTRAS 15 sub-vistas no tenían ENTRADA EN EL MENÚ —
        // exactamente lo que ya se destapó el 11/12-ago en Compras, Inventario PT, Telas y Avíos,
        // pero a Producción nunca se le hizo. La peor consecuencia: la ENTREGA A CLIENTE —el cierre
        // del ciclo— no la enlazaba NADA (ni el riel, ni el panel de avance, ni el tablero WIP), así
        // que el producto entraba a PT y no salía nunca.
        //
        // Hijos CURADOS con el mismo criterio que Telas/Compras (lo de captura diaria + los
        // tableros que se consultan seguido + lo que tiene una CAPACIDAD PROPIA; el resto vive en
        // ⌘K y en la portada-hub `/produccion`):
        //  • `ordenes`   — el principal: desde su panel de AVANCE se capturan corte, envío y recibo
        //                  (una sola pantalla por acto, §Post-F9.36 punto 2).
        //  • `entregas`  — la captura diaria que CIERRA el ciclo (antes inalcanzable).
        //  • `wip` + `existencias-maquilero` — los dos tableros de la operación diaria (qué falta
        //                  por etapa; qué le debe cada maquilero).
        //  • `consulta-ordenes` — NO es una consulta duplicada: es la única que IMPRIME EN LOTE
        //                  (el Centro de Órdenes imprime de a una). Esa capacidad no está en
        //                  ninguna otra pantalla, así que no puede vivir solo en ⌘K.
        //  • `notas-salida` — la salida de material contra la orden.
        //
        // Quedan FUERA del riel, vivas en ⌘K y en el hub `/produccion`:
        //  • `archivo-ordenes` — NO la duplica el Centro (es la producción del sistema ANTERIOR, que
        //    el Centro no lista); queda fuera por ser solo-consulta de histórico, no por duplicada.
        //  • `corte-semanal`, `recibos-semanales`, `ordenes-incompletas`, `pedidos-por-mes`,
        //    `notas-salida-consulta`, `notas-salida-por-orden` — SÍ son cortes/vistas de lo que ya
        //    resuelven el Centro de Órdenes (filtros + semáforo) o Pedidos por mes.
        // Y «Documental», que sigue siendo un «Próximamente»: vive SOLO en ⌘K, ni en el riel ni en
        // el hub — su ruta es `/documental` y el hub lista lo que cuelga de `/produccion/`.
        tipo: 'padre',
        clave: 'produccion',
        hijos: [
          'ordenes',
          'entregas',
          'wip',
          'existencias-maquilero',
          'consulta-ordenes',
          'notas-salida',
        ],
      },
      { tipo: 'hoja', clave: 'ruta-critica' },
      {
        // Calidad pasó de PADRE desplegable a HOJA COLAPSADA a su hub (V1-E3a, 13-ago-2026). Como
        // padre solo listaba 2 de sus 7 hijos y `PadreNav` NO NAVEGA (es un `<button>` que solo
        // expande): defectos, tipos de producto, planes AQL y auditorías por maquilero eran
        // INALCANZABLES desde toda la app, y `CalidadPagina` —que tiene las 7 tarjetas— no la
        // enlazaba nadie. Se resuelve con el patrón que el riel YA usa para los hubs que
        // auto-filtran sus tarjetas (Costos, EDR, Indicadores, EsMa, Administración): hoja directa
        // al hub + gate = UNIÓN de los permisos de sus hijos, para que la entrada aparezca a
        // EXACTAMENTE quien veía el padre antes.
        tipo: 'colapsar',
        clave: 'calidad',
        ruta: '/calidad',
        permisos: ['calidad.ver', 'calidad.generar-auditorias'],
      },
    ],
  },
  {
    // 4 entradas (Daniel), las CUATRO desplegables desde el 12-ago-2026 («destapa las cosas de una
    // vez, para no dejar pendientes»): ya no queda ninguna hoja colapsada en el grupo. Cada padre
    // lleva sus hijos (curados solo en Telas y Compras); lo único que sigue fuera del riel son las
    // dos vistas LEGADAS de telas por lote (existencias y salida a orden, que ya no operan) y las
    // sub-vistas de compras (autorización, compras por orden), vivas en su pantalla + ⌘K.
    grupo: 'inventarios',
    entradas: [
      {
        // Inventario PT es PADRE desplegable (Daniel, 12-ago-2026): como hoja colapsada solo
        // navegaba a Existencias y sus otras tres pantallas no tenían ENTRADA EN EL MENÚ — se
        // alcanzaban por ⌘K/URL o desde la propia pantalla de Existencias (las pestañas
        // Movimientos/Traspasos de `PestanasInventarioPt`, que solo salen con `inventario-pt.mover`,
        // y el botón «Kardex»). Van sus CUATRO hijos, que son todos los que tiene el padre: nada
        // que curar y nada que se quede sin menú.
        tipo: 'padre',
        clave: 'inventarios',
        hijos: [
          'inventario-existencias',
          'inventario-movimientos',
          'inventario-traspasos',
          'inventario-kardex',
        ],
      },
      {
        // Telas es PADRE desplegable (pedido de Daniel, 6-ago-2026): como hoja colapsada el
        // «Catálogo de telas» quedaba invisible (solo ⌘K/URL; la paleta SÍ se abre en el celular,
        // con la lupa de la topbar — `CascaronSistema`, `abrir-paleta-movil`). Hijos
        // CURADOS para no saturar: la nueva Existencias por color (principal), el catálogo, la
        // ENTRADA por factura (B1 — es la puerta diaria del inventario junto con la recepción de
        // compra: sin riel sólo se alcanzaría por ⌘K), la salida a orden, el ajuste y el TRASPASO,
        // los cinco POR COLOR; solo las vistas por lote LEGADAS quedan fuera del riel (vivas por ⌘K).
        //
        // El traspaso POR COLOR entró el 12-ago-2026 y NO es opcional: lo dictó Daniel («El
        // traspaso se hace por color. No siempre hay un lote completo para traspasar» —
        // `DECISIONES.md §Post-F9.32`, que continúa el pedido de §Post-F9.13) y, además, el de lote
        // ya NO opera — graba sus renglones con `id_tela_color = NULL` y la vista
        // `existencia_tela_color` los excluye (`WHERE d."id_tela_color" IS NOT NULL`, migración
        // 20260806130000_a2_partidas_telas), así que traspasar por lote deja «Existencias de telas»
        // —el primer hijo de este mismo menú— sin moverse. Ofrecer solo el de lote era mandar al
        // usuario al flujo muerto.
        //
        // + las DOS vistas de «materiales» que SÍ sirven a las dos dimensiones (12-ago-2026), AL
        // FINAL porque son las de lote/avíos: kardex y traspaso (su gate es `inventario-telas.* |
        // inventario-avios.*`). Cuelgan del padre «Telas» en el catálogo y `resolverEntradaRiel`
        // solo admite hijos del MISMO padre, así que no se pueden colgar de Avíos. Hasta el
        // 12-ago-2026 no tenían ENTRADA EN EL MENÚ ni enlace estable: solo ⌘K/URL o el hub
        // `/inventarios` (`InventariosPagina`), que tampoco es entrada del riel. OJO al leer el
        // menú: para TELAS el traspaso vigente es el de color; «Traspaso de materiales» está por
        // los AVÍOS (su pata de tela es la legada por lote) — así lo fijó `DECISIONES.md
        // §Post-F9.32`. La TERCERA vista de «materiales», el ajuste, se fue al padre «Avíos» el
        // 13-ago-2026: ya es solo-avíos («Ajuste de avíos») y aquí no la encontraba quien la busca.
        tipo: 'padre',
        clave: 'telas',
        hijos: [
          'inventario-telas-existencias',
          'catalogo-telas',
          'inventario-telas-entradas',
          'inventario-telas-salida-orden',
          'inventario-telas-ajuste',
          'inventario-telas-traspaso',
          'inventario-materiales-kardex',
          'inventario-materiales-traspasos',
        ],
      },
      {
        // Avíos es PADRE desplegable (Daniel, 12-ago-2026): como hoja colapsada solo navegaba a
        // Existencias y el «Catálogo de avíos» se quedaba sin ENTRADA EN EL MENÚ —igual que le pasó
        // al de telas en A2—; su único enlace era la tarjeta del hub `/catalogos`, que tampoco es
        // entrada del riel. Van sus TRES hijos, que son todos los que tiene el padre: +«Ajuste de
        // avíos» el 13-ago-2026, que colgaba de «Telas» cuando todavía servía a las dos dimensiones
        // —al quedarse solo-avíos, ahí se escondía justo de quien la busca—. El KARDEX y el TRASPASO
        // de avíos siguen en las vistas de «materiales» bajo el padre «Telas» (sirven a las dos
        // dimensiones y `resolverEntradaRiel` solo admite hijos del MISMO padre); no hay pantalla de
        // "movimientos de avíos" — los movimientos de avío se capturan por ese ajuste y ese traspaso.
        tipo: 'padre',
        clave: 'avios',
        hijos: ['inventario-avios-existencias', 'catalogo-avios', 'inventario-materiales-ajustes'],
      },
      {
        // Compras es PADRE desplegable (pedido de Daniel, 11-ago-2026: «en Compras no hay un
        // submenú de Recepción de compras»): como hoja colapsada solo navegaba a las Órdenes de
        // compra y las otras tres pantallas se quedaban sin ENTRADA EN EL MENÚ y sin enlace
        // estable — solo ⌘K/URL (la Recepción tenía además el deep-link CONDICIONAL del botón
        // «Registrar» de Mis pendientes de RC, `ruta-critica/piezas.tsx` → `recepcionTela`, que
        // solo aparece si la orden trae ese proceso; el semáforo y la explosión, nada). Hijos
        // CURADOS para no saturar: las órdenes de compra (principal), la recepción —la puerta
        // diaria del material, junto con la entrada de telas por factura—, el semáforo «qué tengo
        // / qué falta» y la explosión; el resto (autorización, compras por orden) sigue por ⌘K.
        tipo: 'padre',
        clave: 'compras',
        hijos: [
          'ordenes-compra',
          'recepcion-compras',
          'estatus-materiales',
          'explosion-materiales',
        ],
      },
    ],
  },
  {
    grupo: 'comercial',
    entradas: [
      {
        tipo: 'padre',
        clave: 'clientes',
        hijos: ['clientes-catalogo', 'clientes-listas-precios', 'ventas'],
      },
      { tipo: 'hoja', clave: 'proveedores' },
    ],
  },
  {
    grupo: 'finanzas',
    entradas: [
      { tipo: 'hoja', clave: 'cxc' },
      { tipo: 'hoja', clave: 'cxp' },
      { tipo: 'hoja', clave: 'reportes-fiscales' },
      // Desviación interina (viva hasta F9): EsMa como hoja directa a su portada-hub, que
      // auto-filtra por permiso. NUNCA un desplegable con sus 10 sub-vistas (esas van por ⌘K).
      {
        tipo: 'colapsar',
        clave: 'esma',
        ruta: '/esma',
        permisos: ['esma.ver-pagos', 'esma.cargo-validar', 'esma.modificar'],
      },
    ],
  },
  {
    // 4 hojas planas (Daniel): «Análisis RC» tal cual; Costos/EDR/Indicadores a su hub.
    // El «Concentrado planeado vs real» sale del riel (se llega por ⌘K/URL).
    grupo: 'analisis',
    entradas: [
      { tipo: 'hoja', clave: 'analisis-rc' },
      {
        tipo: 'colapsar',
        clave: 'costos',
        ruta: '/costos',
        permisos: ['costos.ver', 'precostos.consultar'],
      },
      { tipo: 'colapsar', clave: 'edr', ruta: '/edr', permisos: ['edr.ver', 'edr.capturar'] },
      {
        tipo: 'colapsar',
        clave: 'indicadores',
        ruta: '/indicadores',
        permisos: [
          'indicadores.ver',
          'indicadores.ip-productividad',
          'indicadores.almacen-productividad',
          'indicadores.ip-confiabilidad',
          'indicadores.ip-muestrarios',
          'indicadores.ciclicos-alta',
          'indicadores.ciclicos-conteo',
          'indicadores.ciclicos-consulta',
        ],
      },
    ],
  },
  {
    grupo: 'sistema',
    entradas: [
      {
        tipo: 'padre',
        clave: 'catalogos',
        hijos: ['colores', 'tallas', 'temporadas', 'tipos-proceso', 'almacenes'],
      },
      // Hojas directas (Daniel): su configuración interna vive DENTRO de la pantalla.
      {
        tipo: 'colapsar',
        clave: 'g-rc-config',
        ruta: '/ruta-critica/procesos-responsables',
        permisos: ['rc.catalogo-ver'],
      },
      {
        // El destino /administracion es un HUB que auto-filtra (AdministracionPagina): incluye una
        // tarjeta «Bitácora» gateada SOLO por `admin.ver-bitacora`. El gate = UNIÓN de permisos de
        // TODAS las tarjetas hijas (como en Costos/EDR/Indicadores/EsMa) — así los roles que el seed
        // deja con `admin.ver-bitacora` pero sin los `*.administrar` (Directivo, Gerencial…) siguen
        // viendo la entrada y aterrizan en el hub, que les muestra solo la tarjeta Bitácora.
        tipo: 'colapsar',
        clave: 'administracion',
        ruta: '/administracion',
        permisos: [
          'usuarios.administrar',
          'roles.administrar',
          'empresas.administrar',
          'almacenes.administrar',
          'admin.ver-bitacora',
        ],
      },
    ],
  },
];

const GRUPO_POR_CLAVE = new Map(GRUPOS_MENU.map((grupo) => [grupo.clave, grupo]));
const HOJA_POR_CLAVE = new Map(MODULOS_MENU.map((modulo) => [modulo.clave, modulo]));
const PADRE_POR_CLAVE = new Map(PADRES_MENU.map((padre) => [padre.clave, padre]));

/** Resuelve una entrada del riel contra el catálogo (falla en build si una clave no existe). */
function resolverEntradaRiel(espec: EspecRiel): EntradaMenu {
  if (espec.tipo === 'hoja') {
    const hoja = HOJA_POR_CLAVE.get(espec.clave);
    if (hoja === undefined) {
      throw new Error(`Riel: hoja desconocida «${espec.clave}»`);
    }
    return hoja;
  }
  const padre = PADRE_POR_CLAVE.get(espec.clave);
  if (padre === undefined) {
    throw new Error(`Riel: padre desconocido «${espec.clave}»`);
  }
  if (espec.tipo === 'colapsar') {
    // Padre → hoja directa: hereda título/icono/descr. del padre; ruta y gate curados.
    return {
      clave: padre.clave,
      titulo: padre.titulo,
      descripcion: padre.descripcion,
      ruta: espec.ruta,
      icono: padre.icono,
      permisos: espec.permisos,
      ...(padre.destacado === true ? { destacado: true as const } : {}),
    };
  }
  // Padre podado: SOLO los hijos aprobados, en el orden pedido.
  const hijos = espec.hijos.map((clave) => {
    const hijo = padre.hijos.find((h) => h.clave === clave);
    if (hijo === undefined) {
      throw new Error(`Riel: «${espec.clave}» no tiene hijo «${clave}»`);
    }
    return hijo;
  });
  return { ...padre, hijos };
}

/**
 * EL RIEL ya resuelto (estructura de Daniel §3.1). Lo consumen el sidebar y el
 * inicio (vía `filtrarGruposVisibles`); exportado para los tests.
 */
export const RIEL_GRUPOS: readonly GrupoMenu[] = ESPEC_RIEL.map((especGrupo) => {
  const grupo = GRUPO_POR_CLAVE.get(especGrupo.grupo);
  if (grupo === undefined) {
    throw new Error(`Riel: grupo desconocido «${especGrupo.grupo}»`);
  }
  return {
    clave: grupo.clave,
    titulo: grupo.titulo,
    entradas: especGrupo.entradas.map(resolverEntradaRiel),
  };
});

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
 * Filtra las HOJAS visibles del CATÁLOGO COMPLETO para un conjunto de permisos
 * (aplanadas). Función pura: la usan el inicio y los tests.
 */
export function filtrarModulosVisibles(permisos: ReadonlySet<ClavePermiso>): readonly ModuloMenu[] {
  return MODULOS_MENU.filter((modulo) => esModuloVisible(modulo, permisos));
}

/**
 * Filtra un menú AGRUPADO por permisos: descarta hojas sin permiso, poda los
 * hijos de cada padre y elimina padres/grupos que quedaron vacíos. Se aplica
 * tanto al riel (`filtrarGruposVisibles`) como al catálogo completo
 * (`filtrarCatalogoVisible`).
 */
function filtrarGruposPorPermiso(
  grupos: readonly GrupoMenu[],
  permisos: ReadonlySet<ClavePermiso>,
): readonly GrupoMenu[] {
  return grupos
    .map((grupo) => {
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
    })
    .filter((grupo) => grupo.entradas.length > 0);
}

/**
 * El RIEL filtrado por permisos, para el menú lateral y la portada. Muestra
 * SOLO la estructura aprobada por Daniel (no las sub-vistas legadas).
 */
export function filtrarGruposVisibles(permisos: ReadonlySet<ClavePermiso>): readonly GrupoMenu[] {
  return filtrarGruposPorPermiso(RIEL_GRUPOS, permisos);
}

/**
 * El CATÁLOGO COMPLETO filtrado por permisos, para la paleta ⌘K: encuentra
 * TODAS las pantallas (también las que no están en el riel) respetando el gate.
 */
export function filtrarCatalogoVisible(permisos: ReadonlySet<ClavePermiso>): readonly GrupoMenu[] {
  return filtrarGruposPorPermiso(GRUPOS_MENU, permisos);
}

/**
 * Busca una entrada por su clave en el CATÁLOGO COMPLETO: primero las hojas,
 * luego los padres. Los padres entran porque la ruta legada `/compras` (sin
 * pantalla propia) sigue cayendo en la página comodín, que la presenta.
 * (`/produccion` ya NO: tiene su portada-hub `ProduccionPagina` desde V1-E3a.)
 */
export function buscarModuloPorClave(clave: string): EntradaMenu | undefined {
  return (
    MODULOS_MENU.find((modulo) => modulo.clave === clave) ??
    PADRES_MENU.find((padre) => padre.clave === clave)
  );
}

/**
 * PORTADAS-HUB (y rutas comodín) que NO son hoja del catálogo — sus TARJETAS
 * son las hojas —, con el título que el breadcrumb muestra al estar parado en
 * ellas. Sin esto la topbar decía solo «Control v2» en `/costos`, `/edr`, etc.
 * Los títulos son los que cada portada pinta en su `<h1>`. Fallback de
 * `tituloPorRuta`: una hoja (más específica) siempre le gana.
 */
const TITULO_PORTADAS: readonly (readonly [ruta: `/${string}`, titulo: string])[] = [
  ['/inventarios', 'Inventarios'],
  ['/calidad', 'Calidad'],
  ['/costos', 'Costos'],
  ['/edr', 'Estado de Resultados'],
  ['/indicadores', 'Indicadores'],
  ['/esma', 'EsMa'],
  ['/catalogos', 'Catálogos'],
  // `/administracion` NO va aquí: SÍ tiene hoja propia en el catálogo
  // ('administracion-panel' → "Panel de administración"), que siempre gana.
  // `/produccion` SÍ tiene portada-hub desde V1-E3a (`ProduccionPagina`): antes caía en el
  // comodín y anunciaba "Próximamente" un módulo terminado.
  ['/produccion', 'Producción'],
  // Ruta legada sin pantalla propia: cae en la página comodín, que presenta al PADRE del
  // catálogo — el breadcrumb usa ese mismo nombre.
  ['/compras', 'Compras / MRP'],
];

/**
 * Título de la pantalla actual para el BREADCRUMB de la topbar (proto `.crumbs`:
 * «Control v2 › {vista}»). Gana la hoja con la ruta MÁS específica que sea
 * prefijo del pathname (así `/produccion/notas-salida/consulta` dice "Consulta
 * de notas" y no "Notas de salida"); las rutas de detalle (`/modelos/123`)
 * heredan el título de su lista. Si ninguna hoja coincide, se intenta el mapa
 * de PORTADAS-HUB (`/costos`, `/inventarios`…, que no son hoja porque sus
 * tarjetas lo son). `undefined` si tampoco es una portada.
 */
export function tituloPorRuta(pathname: string): string | undefined {
  let mejor: ModuloMenu | undefined;
  for (const modulo of MODULOS_MENU) {
    if (modulo.ruta === '/') {
      if (pathname === '/') {
        return modulo.titulo;
      }
      continue;
    }
    if (pathname === modulo.ruta || pathname.startsWith(`${modulo.ruta}/`)) {
      if (mejor === undefined || modulo.ruta.length > mejor.ruta.length) {
        mejor = modulo;
      }
    }
  }
  if (mejor !== undefined) {
    return mejor.titulo;
  }
  const portada = TITULO_PORTADAS.find(
    ([ruta]) => pathname === ruta || pathname.startsWith(`${ruta}/`),
  );
  return portada?.[1];
}
