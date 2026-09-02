import { z } from 'zod';

import { esquemaFrenteAlGrupo } from './hermanas-op.js';
import { esquemaEstadoOrden } from './orden.js';

/**
 * Contrato Zod del CENTRO DE COMANDO de Órdenes (rediseño R2, §4.2 — brecha B2): la pantalla
 * principal de la operación. Una fila por orden con las 13 columnas del proto (empresa · OP ·
 * modelo · pedido del cliente D7 · ordenada · cortada · maquilero+n · estampador · pedido interno
 * `-F` · OC de tela · mes de entrega · cliente) + ids para navegar. TODO el agregado (Σ cortado,
 * maquileros distintos, OC de tela) lo DERIVA el servidor (A1 — jamás pivote en cliente, lección
 * F5-E7); filtros/orden/paginación EN SERVIDOR.
 */

// ── Fila del centro de comando ────────────────────────────────────────────────────────

/** Una orden en el centro de comando (las 13 columnas del proto + ids para navegar). */
export const esquemaOrdenCentroFila = z
  .object({
    id: z.number().int().describe('Id interno de la orden (para navegar al detalle).'),
    folio: z.number().int().describe('No. OP (folio consecutivo por empresa).'),
    estado: esquemaEstadoOrden,
    idEmpresa: z.number().int().describe('Empresa de la orden (A9).'),
    empresa: z.string().describe('Nombre de la empresa (FR Moda / Marilyn Fitness).'),
    idModelo: z.number().int().describe('Modelo a producir.'),
    codigoModelo: z.string().describe('Código del modelo.'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    pedidoCliente: z
      .string()
      .nullable()
      .describe('Referencia/pedido del CLIENTE (D7, primera referencia de la orden), o null.'),
    cantOrdenada: z.number().int().describe('Piezas pedidas (Σ de la matriz color×talla).'),
    cantCortada: z
      .number()
      .int()
      .describe('Piezas cortadas (Σ de cortes vivos de F3; 0 = sin cortar).'),
    idMaquilero: z.number().int().nullable().describe('Maquilero mostrado, o null.'),
    maquilero: z
      .string()
      .nullable()
      .describe(
        'Maquilero al que se mandó (primer envío de costura vivo; si no hay envíos, el asignado), o null.',
      ),
    numMaquileros: z
      .number()
      .int()
      .describe('Nº de maquileros DISTINTOS con envíos de costura vivos (badge ×2 si >1).'),
    idEstampador: z.number().int().nullable().describe('Estampador/bordador mostrado, o null.'),
    estampador: z
      .string()
      .nullable()
      .describe('Primer proveedor de APLICACIÓN (estampado/bordado) con envío vivo, o null.'),
    idPedido: z.number().int().nullable().describe('Id del pedido interno (para navegar), o null.'),
    folioPedido: z
      .number()
      .int()
      .nullable()
      .describe('Folio del pedido interno (el `-F`), o null.'),
    idOcTela: z
      .number()
      .int()
      .nullable()
      .describe('Id de la OC de TELA ligada a la orden (para navegar), o null si falta.'),
    ocTelaFolio: z
      .number()
      .int()
      .nullable()
      .describe('Folio de la OC de tela (indicador "¿ya compramos la tela?"), o null = falta.'),
    fechaEntrega: z.iso.date().nullable().describe('Fecha de entrega comprometida, o null.'),
    mesEntrega: z
      .number()
      .int()
      .min(1)
      .max(12)
      .nullable()
      .describe('Mes de entrega (1-12, del mes de fechaEntrega), o null sin fecha.'),
    idCliente: z.number().int().describe('Cliente de la orden.'),
    cliente: z.string().describe('Nombre del cliente.'),
    faltantes: z
      .array(z.enum(['tallas', 'receta', 'arte']))
      .describe(
        'Requisitos que le faltan a la orden para estar COMPLETA (vacío si ya lo está o si está cancelada). Transparencia del estado: la UI lo muestra como "Falta: …".',
      ),
    /*
     * ⭐⭐ fila 0.068 (a) — **EL AVISO EN LA FAMILIA.** Daniel pidió que la diferencia se vea *"en la
     * orden, y en la familia"*; ésta es la mitad de la familia: el Centro es la única pantalla que
     * enseña juntas todas las OP de un modelo, así que es donde se reconoce a la que se salió del
     * grupo sin abrirlas una por una.
     *
     * Lo AGREGA EL SERVIDOR por lote de la página (jamás un `await` por fila, ni un pivote en el
     * cliente — misma regla que Σ cortado y la OC de tela) y es exactamente el MISMO objeto que
     * publica la receta de la OP: una sola definición para las dos pantallas.
     */
    frenteAlGrupo: esquemaFrenteAlGrupo,
  })
  .describe(
    'Fila del centro de comando de órdenes (13 columnas del proto, agregadas en servidor).',
  );

/** Forma de una fila del centro de comando. */
export type OrdenCentroFila = z.infer<typeof esquemaOrdenCentroFila>;

/** Respuesta paginada del centro de comando (forma estándar `Pagina<T>`). */
export const esquemaOrdenesCentroPagina = z
  .object({
    datos: z.array(esquemaOrdenCentroFila).describe('Órdenes de la página.'),
    total: z.number().int().describe('Total de órdenes que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página del centro de comando de órdenes.');

/** Forma de la respuesta paginada. */
export type OrdenesCentroPagina = z.infer<typeof esquemaOrdenesCentroPagina>;

// ── Filtros (querystring) ────────────────────────────────────────────────────────────

/**
 * Filtros del centro de comando EN LA URL. `idEmpresa` se acepta por paridad con el proto, pero
 * A9 manda: el dominio SIEMPRE filtra por la empresa activa de la sesión (un idEmpresa distinto
 * devuelve página vacía). `ocTela` = con/sin OC de tela; `mesEntrega` = mes de la fecha de entrega.
 */
export const esquemaOrdenesCentroQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe('Renglones por página (máx 100).'),
    busqueda: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('Texto a buscar (folio OP, código de modelo o pedido del cliente D7).'),
    idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
    idMaquilero: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por maquilero (asignado o con envío de costura vivo).'),
    idEstampador: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por estampador/bordador (con envío de aplicación vivo).'),
    idEmpresa: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por empresa (A9: distinto de la activa → vacío).'),
    ocTela: z
      .enum(['con', 'sin'])
      .optional()
      .describe('Filtra por estado de la OC de tela (con = ya comprada, sin = falta).'),
    mesEntrega: z.coerce
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe('Filtra por mes de entrega (1-12, tabs del proto).'),
    incluirCanceladas: z.stringbool().default(false).describe('Incluye las órdenes canceladas.'),
    ordenarPor: z
      .enum(['folio', 'fecha', 'fechaEntrega', 'creadoEn'])
      .default('folio')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('desc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del centro de comando de órdenes.');

/** Parámetros del centro de comando ya coaccionados desde la URL. */
export type OrdenesCentroQuery = z.infer<typeof esquemaOrdenesCentroQuery>;
