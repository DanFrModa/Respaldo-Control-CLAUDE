import { z } from 'zod';

import { esquemaEstadoSemaforo } from './ruta-critica-programacion.js';

/**
 * Esquemas Zod del CONCENTRADO "planeado vs real" de la RUTA CRÍTICA (Módulo 8, F5-E7; doc
 * `08-Ruta-Critica.md` §2.4 — reemplaza la vista `RC_ConcentradoDif`, la pantalla más pesada del
 * sistema viejo). Una sola definición de reglas para UI y servidor (alimenta el OpenAPI).
 *
 * Es una CONSULTA gerencial de SOLO LECTURA: todas las órdenes con la RC viva × sus procesos, con el
 * SEMÁFORO y los DÍAS DE ATRASO de cada uno, AGREGADOS EN EL SERVIDOR (SQL crudo, jamás pivoteando en
 * el cliente — ese fue el pecado del viejo). Paginada (tope 100), filtrable por cliente / proceso /
 * responsable y ordenable por retraso / cliente / fecha. El export a Excel usa el MISMO resultado.
 */

// ── Filtros + orden de la URL (querystring) ───────────────────────────────────────────────────────

/** Campos por los que se puede ordenar el concentrado. */
export const ORDENES_CONCENTRADO = ['retraso', 'cliente', 'fecha'] as const;
/** Clave del campo de ordenamiento del concentrado. */
export type OrdenConcentradoClave = (typeof ORDENES_CONCENTRADO)[number];

/**
 * Filtros del concentrado en la URL (querystring). Filtros opcionales por cliente (texto),
 * proceso (ProcesoDef) y responsable (Rol), el criterio de orden y la paginación estándar (tope 100).
 * El `orden` ordena por GRAVEDAD (retraso = el peor proceso primero), por cliente o por fecha de
 * entrega de la RC; `descendente` invierte el sentido (por defecto: más urgente primero).
 */
export const esquemaConcentradoQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Órdenes por página (tope 100).'),
    busquedaCliente: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('Texto a buscar en el nombre del cliente.'),
    idProcesoDef: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Solo órdenes que tienen ese tipo de proceso (ProcesoDef) en su ruta.'),
    idRolResponsable: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Solo órdenes con algún proceso cuyo rol responsable es ese (Rol).'),
    orden: z
      .enum(ORDENES_CONCENTRADO)
      .default('retraso')
      .describe(
        'Criterio de orden: por retraso (peor proceso), por cliente o por fecha de entrega.',
      ),
    descendente: z
      .stringbool()
      .default(false)
      .describe('Invierte el sentido del orden (por defecto: más urgente / más reciente primero).'),
  })
  .describe('Filtros, orden y paginación del concentrado "planeado vs real" de la Ruta Crítica.');

/** Parámetros del concentrado ya coaccionados desde la URL. */
export type ConcentradoQuery = z.infer<typeof esquemaConcentradoQuery>;

// ── Salida: una celda (proceso) y una fila (orden) del concentrado ─────────────────────────────────

/** Un proceso de la ruta de la orden, ya proyectado para el concentrado (su semáforo + atraso). */
export const esquemaConcentradoProceso = z
  .object({
    idProcesoDef: z.number().int().describe('Tipo de proceso (ProcesoDef).'),
    codigoProceso: z.string().describe('Código del proceso (kebab-case).'),
    nombreProceso: z.string().describe('Nombre del proceso (para la UI).'),
    secuencia: z.number().int().describe('Posición del proceso en la ruta de la orden.'),
    critico: z.boolean().describe('¿Es un proceso crítico de la ruta?'),
    fechaPlaneadaVigente: z.iso
      .datetime()
      .nullable()
      .describe('Fecha planeada vigente del proceso (CPM), o null si aún no se ha fechado.'),
    fechaReal: z.iso.datetime().nullable().describe('Fecha real de cumplimiento, o null.'),
    estado: z
      .enum(['pendiente', 'activo', 'completado'])
      .describe('Estado del proceso en la ruta (avance simple).'),
    diasAtraso: z
      .number()
      .int()
      .describe('Días NATURALES vencidos respecto a la planeada vigente (>0 si vencida; 0 si no).'),
    semaforo: esquemaEstadoSemaforo.describe(
      'Semáforo de cumplimiento del proceso (HOY vs planeada vigente).',
    ),
  })
  .describe('Un proceso (celda) de la ruta de una orden en el concentrado.');

/** Forma de una celda (proceso) del concentrado. */
export type ConcentradoProceso = z.infer<typeof esquemaConcentradoProceso>;

/**
 * Una FILA del concentrado = una orden con RC viva, con su encabezado, su SEMÁFORO global (el peor de
 * sus procesos), su máximo retraso y sus procesos (las celdas planeado-vs-real).
 */
export const esquemaConcentradoFila = z
  .object({
    idOrden: z.number().int().describe('Id de la orden.'),
    folioOrden: z.number().int().describe('Folio consecutivo de la orden (por empresa).'),
    cliente: z.string().describe('Nombre del cliente de la orden.'),
    idModelo: z.number().int().describe('Modelo a producir.'),
    codigoModelo: z.string().describe('Código del modelo.'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    fechaEntregaRC: z.iso
      .datetime()
      .nullable()
      .describe('Fecha de entrega comprometida de la RC, o null.'),
    fechaInicioRC: z.iso.datetime().nullable().describe('Fecha de inicio de la RC, o null.'),
    esResurtido: z.boolean().describe('¿La orden se programó como resurtido?'),
    semaforo: esquemaEstadoSemaforo.describe(
      'Semáforo de la orden (el PEOR de sus procesos sin cumplir).',
    ),
    maxDiasAtraso: z
      .number()
      .int()
      .describe('Mayor atraso (en días) entre los procesos pendientes de la orden (0 si ninguno).'),
    procesosPendientes: z
      .number()
      .int()
      .describe('Cuántos procesos de la orden siguen sin cumplir.'),
    procesos: z
      .array(esquemaConcentradoProceso)
      .describe('Procesos de la ruta de la orden (en orden de secuencia).'),
  })
  .describe('Una orden (fila) del concentrado "planeado vs real" de la Ruta Crítica.');

/** Forma de una fila (orden) del concentrado. */
export type ConcentradoFila = z.infer<typeof esquemaConcentradoFila>;

/** Respuesta paginada del concentrado (forma estándar `Pagina<T>` + un resumen de semáforos). */
export const esquemaConcentradoPagina = z
  .object({
    datos: z.array(esquemaConcentradoFila).describe('Órdenes de la página.'),
    total: z.number().int().describe('Total de órdenes que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Órdenes por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
    resumen: z
      .object({
        atrasadas: z.number().int().describe('Órdenes (del filtro) cuyo semáforo es atrasado.'),
        enRiesgo: z.number().int().describe('Órdenes (del filtro) cuyo semáforo es en riesgo.'),
        aTiempo: z.number().int().describe('Órdenes (del filtro) cuyo semáforo es a tiempo.'),
      })
      .describe('Conteo de órdenes por semáforo SOBRE TODO el filtro (no solo la página).'),
  })
  .describe('Página del concentrado "planeado vs real" de la Ruta Crítica.');

/** Forma de la respuesta paginada del concentrado. */
export type ConcentradoPagina = z.infer<typeof esquemaConcentradoPagina>;
