import { z } from 'zod';

/**
 * Esquemas del ARCHIVO HISTÓRICO DE ÓRDENES del sistema viejo (§Post-F9.26).
 *
 * Daniel (10-ago-2026): *"me gustaría tenerlas también como archivo histórico de órdenes… para poder
 * buscar por cliente, número de modelo, tipo de prenda, fecha de producción, maquilero, etc."*
 *
 * Es SOLO LECTURA: aquí no hay esquema de alta, edición ni cancelación, y no los va a haber — el
 * archivo se llena UNA vez con el ETL y desde la aplicación solo se consulta. Por eso tampoco hay
 * permiso propio: se reusa `ordenes.ver` (quien puede ver órdenes puede ver las viejas).
 */

/** Etapas de producción que el viejo registraba, tal como quedaron en el archivo. */
export const PROCESOS_HISTORICOS = [
  'corte',
  'envio_maquila',
  'recibo_maquila',
  'envio_estampado',
  'recibo_estampado',
] as const;

/** Campos por los que se puede ordenar el listado. */
const ORDENABLES = ['fecha', 'numero', 'cliente', 'totalPiezas'] as const;

/**
 * Filtros del buscador. Son los que Daniel pidió textualmente: cliente, número de modelo, tipo de
 * prenda, fecha de producción y maquilero. `busqueda` es el atajo de una sola caja (número de orden,
 * modelo o cliente) para cuando ya se sabe qué se busca.
 */
export const esquemaHistoricoOrdenesQuery = z.object({
  pagina: z.coerce.number().int().positive().default(1),
  porPagina: z.coerce.number().int().positive().max(200).default(50),
  ordenarPor: z.enum(ORDENABLES).default('fecha'),
  direccion: z.enum(['asc', 'desc']).default('desc'),
  /**
   * Texto libre contra número de orden, código/descripción del modelo, cliente y la empresa del
   * sistema viejo (§Post-F9.29: así se pueden aislar las órdenes de una empresa que ya no existe).
   */
  busqueda: z.string().trim().max(120).optional(),
  cliente: z.string().trim().max(120).optional().describe('Coincidencia parcial del cliente.'),
  maquilero: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe(
      'Coincidencia parcial del taller: el de la cabecera, el de cualquiera de los campos abiertos (cortadores/maquileros/estampadores) o el de cualquiera de sus procesos.',
    ),
  idModelo: z.coerce.number().int().positive().optional(),
  idTipoProducto: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Tipo de prenda (vive en el modelo; el archivo filtra a través de él).'),
  idGenero: z.coerce.number().int().positive().optional(),
  desde: z.iso.date().optional().describe('Fecha de producción desde (YYYY-MM-DD).'),
  hasta: z.iso.date().optional().describe('Fecha de producción hasta (YYYY-MM-DD).'),
  incluirCanceladas: z
    .enum(['true', 'false'])
    .default('true')
    .describe(
      'Las canceladas se muestran por defecto: parte de la historia es saber qué NO se hizo.',
    ),
});

export type DatosHistoricoOrdenesQuery = z.infer<typeof esquemaHistoricoOrdenesQuery>;

/** Un renglón del listado. */
export const esquemaHistoricoOrdenResumen = z.object({
  id: z.number().int(),
  numero: z.string(),
  fecha: z.string().nullable(),
  fechaEntrega: z.string().nullable(),
  idModelo: z.number().int().nullable(),
  modelo: z.string().nullable().describe('Código del modelo (del catálogo, o el del viejo).'),
  descripcionModelo: z.string().nullable(),
  tipoProducto: z.string().nullable(),
  genero: z.string().nullable(),
  cliente: z.string().nullable(),
  maquilero: z.string().nullable().describe('Taller asignado en la cabecera (solo el primero).'),
  /**
   * TODOS los que la trabajaron (§Post-F9.27), en campo abierto separado por " · " y ligado a nada.
   * La cabecera solo guarda al primero, y una orden pasa por varios talleres.
   */
  cortadores: z.string().nullable(),
  maquileros: z.string().nullable(),
  estampadores: z.string().nullable(),
  etiquetaMarca: z.string().nullable(),
  totalPiezas: z.number().int(),
  cancelada: z.boolean(),
});

export const esquemaHistoricoOrdenesPagina = z.object({
  datos: z.array(esquemaHistoricoOrdenResumen),
  total: z.number().int(),
  pagina: z.number().int(),
  porPagina: z.number().int(),
});

/** Una celda color×talla del detalle. */
const esquemaHistoricoLinea = z.object({
  color: z.string(),
  talla: z.string(),
  cantidad: z.number().int(),
});

/** Un movimiento de producción del detalle (quién y cuánto). */
const esquemaHistoricoProceso = z.object({
  tipo: z.enum(PROCESOS_HISTORICOS),
  fecha: z.string().nullable(),
  tercero: z.string().nullable(),
  cantidad: z.number().int(),
  observaciones: z.string().nullable(),
});

/** La ficha completa de una orden histórica. */
export const esquemaHistoricoOrdenDetalle = esquemaHistoricoOrdenResumen.extend({
  /**
   * Empresa a la que la orden pertenecía en el sistema viejo (§Post-F9.29). Va en la FICHA y no en
   * el renglón del listado: solo importa al mirar una orden concreta —"¿de quién era esta?"—, y el
   * listado ya carga 8 columnas. Se puede buscar por ella desde la caja de búsqueda libre.
   */
  empresaV1: z.string().nullable(),
  tela: z.string().nullable(),
  composicion: z.string().nullable(),
  observaciones: z.string().nullable(),
  motivoCancelada: z.string().nullable(),
  idOrdenV1: z.string().describe('Id de la orden en el sistema viejo (para rastrearla allá).'),
  lineas: z.array(esquemaHistoricoLinea),
  procesos: z.array(esquemaHistoricoProceso),
});

export type HistoricoOrdenResumen = z.infer<typeof esquemaHistoricoOrdenResumen>;
export type HistoricoOrdenesPagina = z.infer<typeof esquemaHistoricoOrdenesPagina>;
export type HistoricoOrdenDetalle = z.infer<typeof esquemaHistoricoOrdenDetalle>;
