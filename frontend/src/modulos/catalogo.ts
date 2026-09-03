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
            // ⭐ V1-E8f (§Post-F9.128) — se llama «Listas de precios», como en Clientes.
            // Se llamaba «Cotizaciones» (el título largo "Cotizaciones / Listas de
            // precios" se TRUNCABA feo en el riel, queja de Gabriel 9-jul-2026), y
            // eso le costó a Daniel dos de los cuatro muros: entró a «Pre-costeos»
            // creyendo que ahí estaban las listas (*"yo estaba viendo los precosteos
            // en lugar de lista de precios"*) y luego reportó que *"no está la opción
            // de listas de precios en desarrollo"*. La MISMA pantalla se llamaba
            // distinto en Desarrollo («Cotizaciones») y en Clientes («Listas de
            // precios»): ahora se llama igual en las dos, con el nombre que él buscó.
            // «Cotizaciones» no se pierde — encabeza la descripción (⌘K la indexa),
            // sigue en el H1 de la pantalla y es el nombre del documento que emite.
            titulo: 'Listas de precios',
            descripcion:
              'Cotizaciones: listas de precios por cliente y departamento, con factores, aprobación del dueño y emisión al cliente (PDF/Excel)',
            ruta: '/listas-precios',
            icono: 'archivo',
            permisos: ['listas.ver'],
            subVista: true,
          },
          // ⭐⭐ V1-E8r (§Post-F9.140) — LA OTRA BANDEJA, la de la RECETA NEGOCIADA. Daniel:
          // *"despues de una negociacion, tiene que haber una validadcion de la receta original…
          // de alguna manera deberia de pasar un filtro"*. La firma existía desde V1-E7d pero
          // nadie podía LISTAR lo que esperaba revisión — y desde que V1-E9c disolvió el muro que
          // había detrás (§Post-F9.169), esta lista es lo ÚNICO que hace que la revisión se
          // levante. Entra al RIEL (no sólo a ⌘K) por la misma razón que su
          // hermana: una bandeja que hay que buscar no se abre. Gate `modelos.ver` — el mismo que
          // abre la ficha a la que lleva; firmar exige `modelos.aprobar-receta` y no se hace aquí.
          {
            clave: 'recetas-por-revisar',
            titulo: 'Recetas por revisar',
            descripcion:
              'Versiones negociadas cuya receta todavía no se revisa — y cuáles ya tienen un pedido esperando',
            ruta: '/modelos/recetas-por-revisar',
            icono: 'lista-tareas',
            permisos: ['modelos.ver'],
          },
          // ⭐⭐ V1-E9p (§Post-F9.144(b)) — LA OTRA MITAD de la pregunta. La bandeja de arriba
          // contesta *"¿ya lo cuadraste?"* y se VACÍA al firmar; ésta contesta *"¿se logró lo que se
          // prometió?"* y se QUEDA, porque un margen que se perdió no deja de haberse perdido
          // porque alguien firme. Daniel: *"todo eso se intentará hacer así, pero no es seguro que
          // se consiga"*. Le importa AL DUEÑO, que ya le dio ese precio al cliente.
          //
          // ⚠️ **El gate es `consultas.ver-importes` A SECAS, y NO la pareja con `modelos.ver`,
          // aunque el endpoint exija las dos.** `esModuloVisible` filtra con `.some()` (basta UNO),
          // así que listar las dos se la enseñaría a todo el que tiene `modelos.ver` —Ventas,
          // Logística, Asistente…— y al entrar recibirían un 403: un ENLACE MUERTO, justo lo que el
          // criterio de §Post-F9.68 evita. Con la restrictiva sola el conjunto es EXACTO:
          // `consultas.ver-importes` lo tienen Administrador, AdministracionDireccion, Directivo y
          // Gerencial —y nadie más, `prisma/seed.ts`—, y los cuatro tienen `modelos.ver`.
          // Sin permisos nuevos.
          {
            clave: 'promesas-incumplidas',
            titulo: 'Promesas incumplidas',
            descripcion:
              'Lo que se vendió con un costo estimado en la negociación y al final no se consiguió, con la brecha y el margen comprometido',
            ruta: '/modelos/promesas-incumplidas',
            icono: 'lista-tareas',
            permisos: ['consultas.ver-importes'],
          },
          // ⭐ V1-E3h (§Post-F9.72) — LA BANDEJA de Desarrollo. Daniel: *"está buenísima"*. Sin
          // ella, para saber qué le falta firmar habría que abrir orden por orden: nadie lo hace,
          // así que solo se libera lo que alguien viene a reclamar — y lo que no se reclama se
          // detiene solo (le pasó con los avíos). Gate `desarrollo.ver`: verla es de Desarrollo;
          // liberar desde ahí exige además `desarrollo.administrar`, que valida el backend.
          {
            clave: 'recetas-por-liberar',
            titulo: 'Recetas por liberar',
            descripcion:
              'Órdenes con receta pendiente de firma, por fecha de entrega — y cuáles ya están frenando compras',
            ruta: '/desarrollo/recetas-por-liberar',
            icono: 'lista-tareas',
            permisos: ['desarrollo.ver'],
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
            descripcion:
              'Órdenes a las que les falta un requisito (tallas, receta liberada o arte), con ' +
              'semáforo de antigüedad',
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
              'Factura o remisión del proveedor contra su orden de compra, con N partidas y su PDF',
            ruta: '/inventarios/telas/entradas',
            icono: 'paquete',
            permisos: ['inventario-telas.ver'],
            subVista: true,
          },
          {
            clave: 'inventario-telas-ajuste',
            titulo: 'Ajuste de telas por color',
            descripcion:
              'Conteo físico / arranque desde cero por color: se captura lo contado y el sistema aplica la diferencia',
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
          // La ÚNICA vista de "materiales" que sigue colgando de «Telas»: el KARDEX. Sirve a las
          // DOS dimensiones y su pata de tela SÍ SIGUE VIVA — es la única ventana que queda a los
          // movimientos del flujo LEGADO por lote (el histórico migrado y lo que capture «Salida a
          // orden por lote (legado)»), porque el kardex del inventario vigente va por COLOR y vive
          // DENTRO de «Inventario de telas». Por eso NO se muda a «Avíos» como sus dos hermanas:
          // esconderla de aquí sería quitarle la pantalla justo a quien la busca. Lo que sí se
          // arregló (fila 0.098) es que MINTIERA: la pestaña dice «Telas (lote · legado)», explica
          // de qué flujo habla y a dónde ir por el vigente, y el vacío ya no es mudo.
          //
          // Sus hermanas ya se fueron a «Avíos» al quedarse solo-avíos: el AJUSTE el 13-ago-2026 y
          // el TRASPASO en la fila 0.098 (mismo criterio, mismo defecto).
          {
            clave: 'inventario-materiales-kardex',
            titulo: 'Kardex de materiales',
            descripcion:
              'Saldo corrido por avío, y el histórico LEGADO de telas por lote (el kardex vigente de una tela va por color)',
            ruta: '/inventarios/materiales/kardex',
            icono: 'almacen',
            permisos: ['inventario-telas.ver', 'inventario-avios.ver'],
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
          {
            // AQUÍ, bajo Avíos, desde la fila 0.098 — MISMO caso y MISMO criterio que «Ajuste de
            // avíos» en agosto. Vivía bajo «Telas» como «Traspaso de materiales» porque servía a
            // las dos dimensiones, pero su pestaña de TELAS estaba atada al motor LEGADO por lote
            // —y la pantalla ARRANCABA en ella—, así que lo traspasado ahí no movía «Inventario de
            // telas» (la vista `existencia_tela_color` excluye los renglones con
            // `id_tela_color = NULL`). El traspaso de TELA se hace por color en «Traspaso de telas
            // por color», hijo de «Telas», y así lo dictó Daniel (§Post-F9.32). Al quedarse SOLO
            // con avíos, dejarlo colgando de «Telas» escondía la pantalla justo de quien la busca.
            // Su gate se estrechó al permiso que de verdad usa (A4).
            clave: 'inventario-materiales-traspasos',
            titulo: 'Traspaso de avíos',
            descripcion: 'Mueve avío entre almacenes en una sola operación (salida + entrada)',
            ruta: '/inventarios/materiales/traspasos',
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
            // Misma pantalla que la de Desarrollo ⇒ mismo nombre y misma descripción (V1-E8f).
            descripcion:
              'Cotizaciones: listas de precios por cliente y departamento, con factores, aprobación del dueño y emisión al cliente (PDF/Excel)',
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
      {
        tipo: 'padre',
        clave: 'g-desarrollo',
        // «Recetas por liberar» entra al RIEL (no solo a ⌘K): es trabajo DIARIO de Desarrollo, y
        // una bandeja que hay que buscar no se abre. Va después de Modelos, junto a lo demás suyo.
        hijos: [
          'modelos',
          'recetas-por-revisar',
          'promesas-incumplidas',
          'recetas-por-liberar',
          'desarrollo',
          'listas-precios',
        ],
      },
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
        // usuario al flujo que YA NO OPERA. (Decía «al flujo muerto»: se precisó en la fila 0.098,
        // porque esa misma dimensión legada es la que el KARDEX de aquí abajo sigue sirviendo — no
        // está muerta, está jubilada para ESCRIBIR.)
        //
        // + la ÚNICA vista de «materiales» que sigue aquí (12-ago-2026), AL FINAL porque es la de
        // lote/avíos: el KARDEX (su gate es `inventario-telas.ver | inventario-avios.ver`). Cuelga
        // del padre «Telas» en el catálogo y `resolverEntradaRiel` solo admite hijos del MISMO
        // padre, así que no se puede colgar de Avíos. Hasta el 12-ago-2026 no tenía ENTRADA EN EL
        // MENÚ ni enlace estable: solo ⌘K/URL o el hub `/inventarios` (`InventariosPagina`), que
        // tampoco es entrada del riel. Se QUEDA aquí a propósito (fila 0.098): su pata de tela
        // sigue VIVA —es la única ventana a los movimientos del flujo legado por lote— y moverla a
        // «Avíos» se la escondería a quien la busca; lo que se arregló es que la pantalla dijera de
        // qué flujo habla y a dónde ir por el kardex vigente (que va por COLOR, dentro de
        // «Inventario de telas»).
        //
        // Las otras dos vistas de «materiales» ya se fueron al padre «Avíos» al quedarse solo-avíos:
        // el AJUSTE el 13-ago-2026 y el TRASPASO en la fila 0.098. El criterio NO es «su pata de
        // tela está muerta» —opera la MISMA dimensión legada que este kardex—, sino que aquéllas
        // TIENEN REEMPLAZO VIGENTE dictado por Daniel (§Post-F9.32: el traspaso y el ajuste de tela
        // se hacen POR COLOR) y este kardex no tiene ninguno: es la única ventana al histórico.
        // OJO al leer el menú: para TELAS el traspaso vigente es el de COLOR — así lo fijó
        // `DECISIONES.md §Post-F9.32`.
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
        ],
      },
      {
        // Avíos es PADRE desplegable (Daniel, 12-ago-2026): como hoja colapsada solo navegaba a
        // Existencias y el «Catálogo de avíos» se quedaba sin ENTRADA EN EL MENÚ —igual que le pasó
        // al de telas en A2—; su único enlace era la tarjeta del hub `/catalogos`, que tampoco es
        // entrada del riel. Van sus CUATRO hijos, que son todos los que tiene el padre: +«Ajuste de
        // avíos» el 13-ago-2026 y +«Traspaso de avíos» en la fila 0.098 — las dos colgaban de
        // «Telas» cuando todavía servían a las dos dimensiones y, al quedarse solo-avíos, ahí se
        // escondían justo de quien las busca. El KARDEX sigue en la vista de «materiales» bajo el
        // padre «Telas» (sirve a las dos dimensiones —su pata de tela legada sigue viva— y
        // `resolverEntradaRiel` solo admite hijos del MISMO padre); no hay pantalla de "movimientos
        // de avíos" — los movimientos de avío se capturan por ese ajuste y ese traspaso.
        tipo: 'padre',
        clave: 'avios',
        hijos: [
          'inventario-avios-existencias',
          'catalogo-avios',
          'inventario-materiales-ajustes',
          'inventario-materiales-traspasos',
        ],
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

/* ────────────────────────────────────────────────────────────────────────────
 * LA CAPA DE RUTA (V1-E6b · `DECISIONES.md §Post-F9.68`)
 *
 * Daniel pidió TRES capas: el MENÚ esconde la opción, la RUTA cierra la
 * pantalla y el BACKEND rechaza la operación. La de en medio faltaba:
 * `RutaProtegida` solo exigía sesión, así que quien tecleara la URL de una
 * pantalla que no le toca entraba, veía encabezados y botones, y la pantalla
 * fallaba al cargar datos.
 *
 * ⚠️ El permiso de cada ruta se TOMA DE ESTE CATÁLOGO — una sola fuente. Si se
 * declarara aparte, las dos listas se desalinearían con el tiempo. Solo las
 * rutas REALES que NO son hoja del menú (portadas-hub, redirecciones, pantallas
 * de detalle con `:param`, comodines) necesitan la tabla de abajo, porque de
 * ellas el catálogo no sabe nada.
 *
 * Esconder es de PRESENTACIÓN: el backend sigue devolviendo 401/403/404 y NADA
 * de la seguridad depende de esta capa (A4).
 * ──────────────────────────────────────────────────────────────────────────── */

/** Lo que una ruta exige: alguna de estas claves, o solo estar autenticado. */
export type ExigenciaRuta = readonly ClavePermiso[] | 'autenticado';

/**
 * Rutas REALES de `App.tsx` que NO son hoja del catálogo, con lo que exigen.
 * Los patrones aceptan segmentos `:param` (comodín de UN segmento).
 *
 * Son de cuatro clases, y NINGUNA duplica un permiso que el catálogo ya sepa:
 *  - PORTADAS-HUB (`/catalogos`, `/inventarios`, `/produccion`): sus TARJETAS
 *    son las hojas y ya se auto-filtran por permiso, así que el hub es de uso
 *    general; entrar sin nada que ver muestra un hub vacío, no una puerta.
 *  - REDIRECCIONES (`<Navigate>`): no pintan nada; el gate lo aplica el destino.
 *  - PANTALLAS DE DETALLE con `:param`, que nunca fueron entrada de menú.
 *  - COMODINES (`:modulo` → «Próximamente», `*` → «No encontrado»): ambas ya
 *    resuelven por su cuenta lo que el usuario puede ver.
 */
const RUTAS_HUB_EXTRA: readonly `/${string}`[] = ['/catalogos', '/inventarios', '/produccion'];

const EXIGENCIA_RUTA_EXTRA: readonly (readonly [ruta: `/${string}`, exige: ExigenciaRuta])[] = [
  // ── Portadas-hub (sus tarjetas se filtran solas) ──
  ...RUTAS_HUB_EXTRA.map((ruta) => [ruta, 'autenticado'] as const),
  // ── Redirecciones puras (el destino es el que gatea) ──
  ['/produccion/corte', 'autenticado'],
  ['/produccion/envios', 'autenticado'],
  ['/produccion/recibos', 'autenticado'],
  ['/ruta-critica', 'autenticado'],
  ['/ruta-critica/bandeja', 'autenticado'],
  // ── Pantallas que nunca fueron hoja del menú ──
  // Catálogo de direcciones de entrega de la OC: sin permisos propios, se
  // gobierna con los de compras (§Post-F9.18).
  ['/catalogos/direcciones-entrega', ['compras.ver']],
  // ⭐ V1-E3j — LA RECETA DE UNA ORDEN, en su pantalla propia. Va DECLARADA (y no heredada de
  // `/produccion/ordenes`, que es `ordenes.ver`) porque su permiso es OTRO: §Post-F9.72 sacó de en
  // medio el permiso sobre la OP entera —*"nadie va a tener permiso de modificar la OP más que
  // yo"*— y dejó la receta en manos de Desarrollo. Sin esta línea la pantalla se abriría con
  // `ordenes.ver` (de más para quien solo mira producción) y se CERRARÍA a un usuario de
  // Desarrollo puro (de menos para quien viene a firmar), que es justo al revés.
  ['/produccion/ordenes/:id/receta', ['desarrollo.ver']],
  // La RC de una orden: consultar es `rc.ruta-ver`; programarla, `rc.programar`.
  ['/ruta-critica/ordenes/:idOrden', ['rc.ruta-ver']],
  ['/ruta-critica/ordenes/:idOrden/programar', ['rc.programar']],
  // Importar un CFDI ES administrar la cuenta (así lo gatea el backend:
  // `cxp.administrar` / `cxc.administrar`). Son pantallas de PURA ESCRITURA a
  // las que solo se llega por su botón —ya oculto sin el permiso— o por un
  // enlace pegado, así que la ruta pide el permiso de escritura y no el de ver.
  ['/cxp/importar-cfdi', ['cxp.administrar']],
  ['/cxc/importar-cfdi', ['cxc.administrar']],
  // ── Las CINCO pantallas de Administración que no son hoja del catálogo ──
  //
  // ⚠️ SIN estas líneas heredaban de `/administracion`, cuyo gate es la UNIÓN de
  // los permisos de sus tarjetas (incluida `admin.ver-bitacora`): un usuario de
  // pura bitácora abría Usuarios, Roles y Empresas, veía encabezado y el botón
  // «Nuevo», y la consulta reventaba — el síntoma exacto que §Post-F9.68 manda
  // matar, en el módulo más sensible. La unión es correcta PARA EL HUB (ahí
  // aterriza con su única tarjeta) pero NO puede heredarse hacia abajo.
  //
  // El permiso de cada una es el de SU TARJETA en `AdministracionPagina`
  // (`SECCIONES_LISTAS`), la misma fuente que decide si la tarjeta se ve.
  ['/administracion/usuarios', ['usuarios.administrar']],
  ['/administracion/roles', ['roles.administrar']],
  ['/administracion/empresas', ['empresas.administrar']],
  ['/administracion/conceptos-costo', ['concepto-costo.administrar']],
  ['/administracion/estados-lista', ['estado-lista.administrar']],
];

/**
 * Las PORTADAS-HUB: rutas cuyo gate es la UNIÓN de los permisos de sus tarjetas
 * (o `autenticado`), porque el hub existe para mostrar las tarjetas que cada
 * quien puede abrir. Esa unión vale SOLO para el hub: heredarla hacia una
 * pantalla hija la abriría de más. La prueba `catalogo-rutas.test.ts` exige que
 * ninguna ruta hija resuelva contra su hub.
 */
export const RUTAS_HUB: readonly string[] = [
  ...ESPEC_RIEL.flatMap((grupo) =>
    grupo.entradas.flatMap((entrada) => (entrada.tipo === 'colapsar' ? [entrada.ruta] : [])),
  ),
  ...RUTAS_HUB_EXTRA,
];

/** Rutas comodín de `App.tsx` que resuelven por su cuenta lo que se puede ver. */
const RUTAS_COMODIN: readonly string[] = [':modulo', '*'];

/** Segmentos no vacíos de un pathname (`/a/b/` → `['a','b']`). */
function segmentosDe(ruta: string): readonly string[] {
  return ruta.split('/').filter((segmento) => segmento.length > 0);
}

/**
 * ¿El patrón es prefijo del pathname? Devuelve su ESPECIFICIDAD (número de
 * segmentos, menos una fracción por cada `:param`, para que un literal le gane
 * a un comodín del mismo largo), o `null` si no coincide.
 */
function especificidadPatron(patron: string, segmentos: readonly string[]): number | null {
  const segsPatron = segmentosDe(patron);
  if (segsPatron.length > segmentos.length) {
    return null;
  }
  let parametros = 0;
  for (const [i, segmento] of segsPatron.entries()) {
    if (segmento.startsWith(':')) {
      parametros += 1;
      continue;
    }
    if (segmento !== segmentos[i]) {
      return null;
    }
  }
  return segsPatron.length - parametros / (segsPatron.length + 1);
}

/** Une dos exigencias de la misma ruta (más permisiva, nunca más estricta). */
function unirExigencias(a: ExigenciaRuta, b: ExigenciaRuta): ExigenciaRuta {
  if (a === 'autenticado' || b === 'autenticado') {
    return 'autenticado';
  }
  return [...new Set([...a, ...b])];
}

/**
 * TODAS las declaraciones ruta → exigencia, de las TRES fuentes que ya existen
 * (ninguna nueva):
 *  1. las HOJAS del catálogo, con su permiso tal cual;
 *  2. las entradas `colapsar` del RIEL — las portadas-hub (`/costos`, `/edr`,
 *     `/indicadores`, `/esma`, `/calidad`, `/administracion`), cuyo gate es la
 *     UNIÓN de los permisos de sus tarjetas y es EXACTAMENTE a quien el menú le
 *     ofrece la entrada;
 *  3. las rutas reales que no son ninguna de las dos (`EXIGENCIA_RUTA_EXTRA`).
 */
const DECLARACIONES_RUTA: readonly (readonly [string, ExigenciaRuta])[] = [
  ...MODULOS_MENU.filter((modulo) => modulo.ruta !== '/').map(
    (modulo) => [modulo.ruta, modulo.permisos] as const,
  ),
  ...ESPEC_RIEL.flatMap((grupo) =>
    grupo.entradas.flatMap((entrada) =>
      entrada.tipo === 'colapsar' ? [[entrada.ruta, entrada.permisos] as const] : [],
    ),
  ),
  ...EXIGENCIA_RUTA_EXTRA,
];

/**
 * Lo que exige la ruta `pathname`, o `undefined` si NADA la declara.
 *
 * Gana la declaración MÁS ESPECÍFICA que sea prefijo del pathname, así una
 * sub-pantalla hereda el gate de su pantalla padre (`/inventarios/telas/
 * entradas/nueva` hereda de `/inventarios/telas/entradas`) sin declararse. La
 * portada `/` se compara EXACTA: si fuera prefijo de todo, cualquier ruta sin
 * declarar caería en ella y el gate se apagaría en silencio.
 */
export function exigenciaDeRuta(pathname: string): ExigenciaRuta | undefined {
  return declaracionDeRuta(pathname)?.exige;
}

/**
 * Igual que {@link exigenciaDeRuta} pero diciendo TAMBIÉN de QUÉ declaración
 * salió el permiso. La prueba de deriva lo necesita: sin saber el origen no se
 * puede distinguir una ruta con gate PROPIO de una que HEREDÓ el de su
 * portada-hub —que es la unión de las tarjetas y abre de más—; las dos se ven
 * igual de "gateadas" si solo se mira el permiso resultante.
 */
export function declaracionDeRuta(
  pathname: string,
): { ruta: string; exige: ExigenciaRuta } | undefined {
  if (pathname === '/') {
    return { ruta: '/', exige: 'autenticado' };
  }
  const segmentos = segmentosDe(pathname);
  if (segmentos.length === 0) {
    return { ruta: '/', exige: 'autenticado' };
  }
  let mejor: { ruta: string; exige: ExigenciaRuta; especificidad: number } | undefined;
  for (const [ruta, exige] of DECLARACIONES_RUTA) {
    const especificidad = especificidadPatron(ruta, segmentos);
    if (especificidad === null) {
      continue;
    }
    if (mejor === undefined || especificidad > mejor.especificidad) {
      mejor = { ruta, exige, especificidad };
    } else if (especificidad === mejor.especificidad) {
      // EMPATE (la MISMA ruta declarada dos veces): se toma la UNIÓN, nunca la
      // más estricta. El caso real es `/administracion`, hoja del catálogo con
      // los cuatro `*.administrar` y entrada del riel con esos MÁS
      // `admin.ver-bitacora` (quien solo tiene la bitácora ve la entrada en el
      // menú y aterriza en el hub con esa única tarjeta). La capa de ruta NUNCA
      // debe cerrar una pantalla que el menú sí ofrece. El empate solo se da
      // entre patrones idénticos, así que la ruta de origen es la misma.
      mejor = { ruta: mejor.ruta, exige: unirExigencias(mejor.exige, exige), especificidad };
    }
  }
  if (mejor === undefined) {
    return undefined;
  }
  return { ruta: mejor.ruta, exige: mejor.exige };
}

/**
 * ¿Esta sesión puede ver la pantalla de `pathname`? (Capa de RUTA, A4.)
 *
 * Una ruta SIN declaración no se cierra: esta capa es de presentación y su
 * trabajo es no enseñar puertas, no sustituir al backend (que sigue rechazando
 * la operación). La prueba `catalogo-rutas.test.ts` recorre `App.tsx` y truena
 * si alguna ruta se quedó sin declarar, para que ese caso no exista.
 */
export function rutaPermitida(pathname: string, permisos: ReadonlySet<ClavePermiso>): boolean {
  const exige = exigenciaDeRuta(pathname);
  if (exige === undefined || exige === 'autenticado') {
    return true;
  }
  return exige.some((clave) => permisos.has(clave));
}

/** Las rutas comodín de `App.tsx` (las usa la prueba de deriva). */
export function esRutaComodin(ruta: string): boolean {
  return RUTAS_COMODIN.includes(ruta);
}
