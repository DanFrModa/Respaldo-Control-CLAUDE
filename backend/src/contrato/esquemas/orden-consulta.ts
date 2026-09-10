import { z } from 'zod';

import { esquemaEstadoOrden } from './orden.js';

/**
 * Contrato Zod de las CONSULTAS/TABLEROS/BÚSQUEDA de Órdenes (F2-E4 — doc
 * `Documentacion_MJD/03-Produccion.md`). Estas vistas son la OPERACIÓN DIARIA sobre las órdenes que
 * la captura (F2-E2/E3) ya creó: listar/consultar liviano, ver las incompletas con semáforo de
 * antigüedad, agregar el tablero "pedidos por mes" y un buscador global para el layout.
 *
 * Diferencia clave con `esquemaListarOrdenes` (la del listado de captura): aquí la proyección es
 * LIGERA (no embebe matriz/referencias/comentarios por fila), pensada para tablas y selecciones
 * masivas. El `totalPiezas` sale de un agregado (Σ de `OrdenLineaTalla.cantidad`), no de traer
 * toda la matriz. Todas las consultas son `ordenes.ver`, filtran por la empresa activa (A9) y
 * derivan en el servidor cualquier valor (semáforo, agregados): el front no decide nada (A1).
 */

// ── Item ligero del listado de consulta ─────────────────────────────────────────────

/**
 * Renglón LIGERO de una orden para tablas de consulta. Trae lo justo para listar, filtrar e
 * imprimir: encabezado mínimo + nombres para la UI + el total derivado. NO trae la matriz ni las
 * referencias ni los comentarios (eso vive en el detalle de captura, `GET /api/ordenes/{id}`).
 */
export const esquemaOrdenLigeraSalida = z
  .object({
    id: z.number().int().describe('Id interno de la orden.'),
    folio: z.number().int().describe('Folio consecutivo por empresa.'),
    estado: esquemaEstadoOrden,
    fecha: z.iso.date().nullable().describe('Fecha de la orden (YYYY-MM-DD), o null.'),
    fechaEntrega: z.iso.date().nullable().describe('Fecha de entrega comprometida, o null.'),
    idModelo: z.number().int().describe('Modelo a producir.'),
    codigoModelo: z.string().describe('Código del modelo (para la UI).'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    idCliente: z.number().int().describe('Cliente de la orden.'),
    cliente: z.string().describe('Nombre del cliente (para la UI).'),
    idMaquilero: z.number().int().nullable().describe('Maquilero asignado (Proveedor), o null.'),
    maquilero: z.string().nullable().describe('Nombre del maquilero, o null.'),
    totalPiezas: z
      .number()
      .int()
      .describe('Total de prendas de la orden (Σ de todas las tallas), agregado en servidor.'),
  })
  .describe('Orden en proyección LIGERA (para tablas de consulta).');

/** Forma de una orden ligera en la API. */
export type OrdenLigeraSalida = z.infer<typeof esquemaOrdenLigeraSalida>;

/** Respuesta paginada del listado LIGERO de órdenes (forma estándar `Pagina<T>`). */
export const esquemaOrdenesLigerasPagina = z
  .object({
    datos: z.array(esquemaOrdenLigeraSalida).describe('Órdenes (ligeras) de la página.'),
    total: z.number().int().describe('Total de órdenes que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de órdenes (proyección ligera).');

/** Forma de la respuesta paginada ligera de órdenes. */
export type OrdenesLigerasPagina = z.infer<typeof esquemaOrdenesLigerasPagina>;

// ── Consulta (listado ligero con filtros de servidor) ───────────────────────────────

/**
 * Parámetros de la CONSULTA de órdenes EN LA URL (querystring). Mismos filtros que el listado de
 * captura pero con proyección ligera. Búsqueda combinada (folio, modelo, cliente, valor de
 * referencia D7) + filtros por cliente/año/modelo/estado, orden y paginación.
 */
export const esquemaConsultaOrdenes = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      // ⚠️ 100 es el tope REAL, el del dominio (`comun/paginacion.ts`: "nadie lee más y protege la
      // base"). El contrato decía 500 y era MENTIRA: el servicio re-valida con el esquema del
      // dominio, así que quien leía el OpenAPI y pedía 500 recibía un 400. No es un cambio de
      // conducta —hoy ya fallaba—: es dejar de prometer lo que nunca se cumplió. Que los dos lados
      // sigan de acuerdo lo vigila `paginacion-honesta.test.ts`.
      .max(100)
      .default(20)
      .describe('Renglones por página (máx 100).'),
    busqueda: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('Texto a buscar (folio, código de modelo, cliente o valor de referencia).'),
    idModelo: z.coerce.number().int().positive().optional().describe('Filtra por modelo.'),
    idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
    anio: z.coerce
      .number()
      .int()
      .min(2000)
      .max(2100)
      .optional()
      .describe('Filtra por año de la fecha.'),
    estado: esquemaEstadoOrden.optional().describe('Filtra por estado.'),
    incluirCanceladas: z
      .stringbool()
      .default(false)
      .describe('Incluye las órdenes canceladas (cancelación suave).'),
    ordenarPor: z
      .enum(['folio', 'fecha', 'fechaEntrega', 'creadoEn'])
      .default('folio')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('desc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación de la consulta ligera de órdenes.');

/** Parámetros de la consulta ya coaccionados desde la URL. */
export type ConsultaOrdenes = z.infer<typeof esquemaConsultaOrdenes>;

// ── Incompletas (con semáforo de antigüedad) ────────────────────────────────────────

/** Color del semáforo de antigüedad de una orden incompleta (lo DERIVA el servidor). */
export const esquemaSemaforoOrden = z
  .enum(['verde', 'amarillo', 'urgente'])
  .describe(
    'Semáforo de antigüedad (verde ≤3d, amarillo 4–7d, urgente >7d). Derivado en servidor.',
  );

/** Forma del semáforo en la API. */
export type SemaforoOrden = z.infer<typeof esquemaSemaforoOrden>;

/**
 * Orden INCOMPLETA (`estado='capturada'`: le falta al menos uno de los requisitos —tallas + receta
 * liberada, y arte si aplica—, ver `dominio/produccion/requisitos-orden.ts`) en proyección ligera +
 * su antigüedad en días + el semáforo derivado. `urgente` = > 7 días (regla `EsUrgente`).
 *
 * ⚠️ NO es "capturada sin matriz" ni la paridad con `FechaDet Is Null` del viejo (26-jul-2026): una
 * incompleta PUEDE tener su matriz —le puede faltar la receta o el arte— y hasta puede traer
 * `fechaCompletada` de cuando sí estuvo completa.
 */
export const esquemaOrdenIncompletaSalida = esquemaOrdenLigeraSalida
  .extend({
    diasAntiguedad: z
      .number()
      .int()
      .describe('Días desde el alta de la orden (creadoEn, o fecha como respaldo).'),
    semaforo: esquemaSemaforoOrden,
  })
  .describe(
    'Orden incompleta (`capturada`: le falta tallas, receta liberada o arte) con su antigüedad y ' +
      'semáforo. NO significa "sin matriz": una incompleta puede tenerla.',
  );

/** Forma de una orden incompleta en la API. */
export type OrdenIncompletaSalida = z.infer<typeof esquemaOrdenIncompletaSalida>;

/** Respuesta paginada de las órdenes incompletas. */
export const esquemaOrdenesIncompletasPagina = z
  .object({
    datos: z.array(esquemaOrdenIncompletaSalida).describe('Órdenes incompletas de la página.'),
    total: z.number().int().describe('Total de órdenes incompletas.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de órdenes incompletas.');

/** Forma de la respuesta paginada de incompletas. */
export type OrdenesIncompletasPagina = z.infer<typeof esquemaOrdenesIncompletasPagina>;

/** Parámetros de la consulta de incompletas (solo paginación + orden por antigüedad). */
export const esquemaIncompletasQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página.'),
    direccion: z
      .enum(['asc', 'desc'])
      .default('desc')
      .describe('Dirección por antigüedad (desc = las más viejas/urgentes primero).'),
  })
  .describe('Paginación y orden de las órdenes incompletas.');

/** Parámetros de incompletas ya coaccionados. */
export type IncompletasQuery = z.infer<typeof esquemaIncompletasQuery>;

// ── Tablero "pedidos por mes" ────────────────────────────────────────────────────────

/**
 * Una fila del tablero "pedidos por mes": el mes (clave + etiqueta) y sus métricas agregadas. La
 * forma se diseñó para CRECER (F3): hoy solo `numOrdenes`/`totalPiezas`; las columnas de avance
 * (corte/entregas/parcial) se sumarán como campos nuevos sin rehacer el endpoint ni romper el
 * contrato existente.
 */
export const esquemaTableroPedidosMesFila = z
  .object({
    anio: z.number().int().describe('Año del mes agrupado.'),
    mes: z.number().int().min(1).max(12).describe('Mes (1-12).'),
    clave: z.string().describe('Clave estable del mes (YYYY-MM), para saltos/links.'),
    etiqueta: z.string().describe('Etiqueta legible del mes (p. ej. "jun 2026").'),
    numOrdenes: z.number().int().describe('Número de órdenes con fecha en ese mes.'),
    totalPiezas: z.number().int().describe('Total de prendas (Σ de tallas) de ese mes.'),
  })
  .describe('Métricas agregadas de un mes en el tablero de pedidos.');

/** Forma de una fila del tablero. */
export type TableroPedidosMesFila = z.infer<typeof esquemaTableroPedidosMesFila>;

/**
 * Respuesta del tablero "pedidos por mes": la lista de filas (una por mes) + un total global. Forma
 * extensible: las métricas viven en cada fila, así que F3 agrega columnas sin cambiar esta envoltura.
 */
export const esquemaTableroPedidosMes = z
  .object({
    filas: z.array(esquemaTableroPedidosMesFila).describe('Una fila por mes (orden cronológico).'),
    totalOrdenes: z.number().int().describe('Total de órdenes en todo el rango.'),
    totalPiezas: z.number().int().describe('Total de prendas en todo el rango.'),
  })
  .describe('Tablero de pedidos por mes (agregado, extensible a avances en F3).');

/** Forma del tablero. */
export type TableroPedidosMes = z.infer<typeof esquemaTableroPedidosMes>;

/**
 * Filtros del tablero "pedidos por mes" (querystring). `entregadosTienda`/`noProducir` son banderas
 * de paridad con el viejo; el avance (`EntregadoParcial`) NO existe en F2 (no se inventa: documentado
 * en el dominio para F3).
 */
export const esquemaTableroPedidosMesQuery = z
  .object({
    anio: z.coerce
      .number()
      .int()
      .min(2000)
      .max(2100)
      .optional()
      .describe('Filtra por año (de la fecha de la orden).'),
    mes: z.coerce.number().int().min(1).max(12).optional().describe('Filtra por mes (1-12).'),
    idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
    incluirCanceladas: z
      .stringbool()
      .default(false)
      .describe('Incluye las órdenes canceladas en el agregado.'),
    entregadosTienda: z
      .stringbool()
      .optional()
      .describe('Bandera de paridad (viejo); sin efecto en F2 (no hay avance todavía).'),
    noProducir: z
      .stringbool()
      .optional()
      .describe('Bandera de paridad (viejo); sin efecto en F2 (no hay avance todavía).'),
  })
  .describe('Filtros del tablero de pedidos por mes.');

/** Parámetros del tablero ya coaccionados. */
export type TableroPedidosMesQuery = z.infer<typeof esquemaTableroPedidosMesQuery>;

// ── Buscador global del layout ────────────────────────────────────────────────────────

/** Un hit LIGERO del buscador global (folio + modelo + cliente, para mostrar y navegar). */
export const esquemaOrdenHitSalida = z
  .object({
    id: z.number().int().describe('Id interno de la orden (para navegar al detalle).'),
    folio: z.number().int().describe('Folio consecutivo por empresa.'),
    codigoModelo: z.string().describe('Código del modelo.'),
    cliente: z.string().describe('Nombre del cliente.'),
  })
  .describe('Hit ligero del buscador global de órdenes.');

/** Forma de un hit del buscador. */
export type OrdenHitSalida = z.infer<typeof esquemaOrdenHitSalida>;

/** Respuesta del buscador global: la lista de hits (limitada). */
export const esquemaOrdenesBuscarSalida = z
  .object({
    datos: z.array(esquemaOrdenHitSalida).describe('Hits de la búsqueda (limitados).'),
  })
  .describe('Resultados del buscador global de órdenes.');

/** Forma de la respuesta del buscador. */
export type OrdenesBuscarSalida = z.infer<typeof esquemaOrdenesBuscarSalida>;

/** Parámetros del buscador global (querystring): solo el texto `q`. */
export const esquemaOrdenesBuscarQuery = z
  .object({
    q: z
      .string()
      .trim()
      .min(1, { error: 'Escribe algo para buscar.' })
      .max(200)
      .describe('Texto a buscar (folio, código de modelo, cliente o valor de referencia D7).'),
  })
  .describe('Texto del buscador global de órdenes.');

/** Parámetros del buscador ya coaccionados. */
export type OrdenesBuscarQuery = z.infer<typeof esquemaOrdenesBuscarQuery>;
