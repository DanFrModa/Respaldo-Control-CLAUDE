import { z } from 'zod';

import { esquemaEstadoDesarrollo } from './desarrollo.js';
import { esquemaNegociacionEventoSalida } from './negociacion.js';
import { esquemaConteosDesarrollo } from './proyecto.js';

/**
 * Contrato Zod del "enganche" Desarrollo ↔ Producción (F8-E6, D13/R16). Es la capa que amarra el
 * expediente de Desarrollo (proyecto → precosto congelado → lista/precio negociado) a la ORDEN de
 * producción que dispara el MRP/OC. Cuatro formas:
 *
 *  • LIGAR / QUITAR liga: una orden liga a lo más UN desarrollo (`DesarrolloOrden.idOrden @unique`);
 *    un desarrollo puede tener N órdenes (resurtidos). El estado del desarrollo pasa a
 *    `ligado-produccion` (derivado, se activa solo al existir la liga).
 *  • SUGERENCIA de liga: dado un `idOrden`, el desarrollo CANDIDATO (mismo modelo+cliente+empresa, no
 *    apagado, aún no ligado) + un `precioSugeridoPedido` PROPUESTO (renglón de lista más reciente:
 *    `precioAprobado ?? precioCalculado`). Es un default EDITABLE para la UI; NO escribe el pedido.
 *  • VISTA 360 (expediente): desde la orden ligada, el proyecto/desarrollo, el precosto vigente
 *    (última versión CONGELADA + costo), el renglón de lista/precio y los acuerdos de negociación.
 *  • TABLERO: conteos de desarrollos por ESTADO derivado, filtrable por cliente/departamento/temporada.
 *
 * Los IMPORTES (`precioSugeridoPedido`, `costoTotal`, `precio`, precios de eventos) se OCULTAN (null)
 * sin `consultas.ver-importes` (ocultación server-side, igual que el resto del módulo). Toda la lógica
 * vive en el dominio (A1); aquí sólo las FORMAS.
 */

// ── Ligar / quitar liga ──────────────────────────────────────────────────────────────

/** Cuerpo de "ligar orden a desarrollo": el desarrollo a amarrar (la orden viaja en la URL). */
export const esquemaLigarOrdenCuerpo = z
  .object({
    idDesarrollo: z
      .number({ error: 'El desarrollo es obligatorio' })
      .int({ error: 'El id del desarrollo debe ser entero' })
      .positive({ error: 'El id del desarrollo debe ser positivo' })
      .describe('Desarrollo a ligar a la orden (mismo modelo y cliente).'),
  })
  .describe('Selección del desarrollo a ligar a una orden de producción.');

/** Datos validados de ligar orden. */
export type DatosLigarOrden = z.infer<typeof esquemaLigarOrdenCuerpo>;

/** Detalle de una liga desarrollo↔orden (confirmación al crearla). */
export const esquemaLigaOrdenSalida = z
  .object({
    id: z.number().int().describe('Id de la liga (DesarrolloOrden).'),
    idOrden: z.number().int().describe('Orden de producción ligada.'),
    folioOrden: z.number().int().describe('Folio de la orden (para la UI).'),
    idDesarrollo: z.number().int().describe('Desarrollo ligado.'),
    codigoModelo: z.string().describe('Código del modelo del desarrollo/orden.'),
    numeroCliente: z.string().nullable().describe('Número del cliente para el modelo, o null.'),
    estadoDesarrollo: esquemaEstadoDesarrollo,
    creadoEn: z.iso.datetime().describe('Cuándo se ligó (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Quién ligó, o null.'),
  })
  .describe('Liga desarrollo↔orden.');

/** Forma de la liga en la API. */
export type LigaOrdenSalida = z.infer<typeof esquemaLigaOrdenSalida>;

/** Estado de la liga de una orden tras quitarla (confirmación). */
export const esquemaLigaEstadoSalida = z
  .object({
    idOrden: z.number().int().describe('Orden de producción.'),
    ligado: z.boolean().describe('¿La orden quedó ligada a algún desarrollo?'),
  })
  .describe('Estado de la liga desarrollo↔orden de una orden.');

/** Forma del estado de liga en la API. */
export type LigaEstadoSalida = z.infer<typeof esquemaLigaEstadoSalida>;

// ── Sugerencia de liga + precio propuesto ──────────────────────────────────────────────

/** Desarrollo CANDIDATO a ligar con una orden (+ el precio de pedido propuesto, editable). */
export const esquemaCandidatoLigaSalida = z
  .object({
    idDesarrollo: z.number().int().describe('Desarrollo candidato.'),
    idProyecto: z.number().int().describe('Proyecto del desarrollo.'),
    folioProyecto: z.number().int().describe('Folio del proyecto (para la UI).'),
    nombreProyecto: z.string().describe('Nombre/tema del proyecto.'),
    codigoModelo: z.string().describe('Código del modelo.'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    numeroCliente: z.string().nullable().describe('Número del cliente para el modelo, o null.'),
    estado: esquemaEstadoDesarrollo,
    idListaLinea: z
      .number()
      .int()
      .nullable()
      .describe('Renglón de lista de precios de donde salió el precio propuesto, o null.'),
    folioLista: z.number().int().nullable().describe('Folio de esa lista de precios, o null.'),
    precioSugeridoPedido: z
      .number()
      .nullable()
      .describe(
        'Precio PROPUESTO para el pedido (precioAprobado ?? precioCalculado del renglón de lista más ' +
          'reciente). Default EDITABLE; null si no hay lista o sin permiso de importes.',
      ),
  })
  .describe('Desarrollo candidato a ligar + precio de pedido propuesto.');

/** Forma del candidato de liga en la API. */
export type CandidatoLigaSalida = z.infer<typeof esquemaCandidatoLigaSalida>;

/** Sugerencia de liga de una orden: el candidato (o null si no hay). */
export const esquemaSugerenciaLigaSalida = z
  .object({
    idOrden: z.number().int().describe('Orden de producción.'),
    folioOrden: z.number().int().describe('Folio de la orden (para la UI).'),
    yaLigada: z.boolean().describe('¿La orden ya está ligada a un desarrollo?'),
    candidato: esquemaCandidatoLigaSalida
      .nullable()
      .describe('Desarrollo candidato a ligar, o null si no hay uno coherente.'),
  })
  .describe('Sugerencia de liga desarrollo↔orden para una orden (propuesta editable).');

/** Forma de la sugerencia en la API. */
export type SugerenciaLigaSalida = z.infer<typeof esquemaSugerenciaLigaSalida>;

// ── Vista 360 (expediente desde la orden) ───────────────────────────────────────────────

/** Precosto vigente de un desarrollo en el expediente (última versión CONGELADA + su costo). */
export const esquemaExpedientePrecosto = z
  .object({
    idPrecosto: z.number().int().describe('Id del precosto congelado vigente.'),
    version: z.number().int().describe('Número de versión.'),
    costoTotal: z.number().nullable().describe('Costo total congelado (o null sin importes).'),
    congeladoEn: z.iso.datetime().nullable().describe('Cuándo se congeló, o null.'),
  })
  .describe('Precosto congelado vigente del desarrollo.');

/** Renglón de lista/precio del desarrollo en el expediente. */
export const esquemaExpedienteLista = z
  .object({
    idLista: z.number().int().describe('Lista de precios.'),
    folioLista: z.number().int().describe('Folio de la lista.'),
    codigoEstadoLista: z.string().describe('Código del estado de la lista.'),
    nombreEstadoLista: z.string().describe('Nombre del estado de la lista.'),
    idListaLinea: z.number().int().describe('Renglón de la lista para este desarrollo.'),
    precio: z
      .number()
      .nullable()
      .describe('Precio del renglón (precioAprobado ?? precioCalculado; null sin importes).'),
    aprobado: z.boolean().describe('¿El renglón ya tiene precio aprobado por el dueño?'),
  })
  .describe('Renglón de lista de precios del desarrollo.');

/** Expediente 360 de una orden ligada a Desarrollo. */
export const esquemaExpedienteOrdenSalida = z
  .object({
    idOrden: z.number().int().describe('Orden de producción.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    idModelo: z.number().int().describe('Modelo de la orden/desarrollo.'),
    codigoModelo: z.string().describe('Código del modelo.'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    idDesarrollo: z.number().int().describe('Desarrollo ligado a la orden.'),
    numeroCliente: z.string().nullable().describe('Número del cliente para el modelo, o null.'),
    estadoDesarrollo: esquemaEstadoDesarrollo,
    idProyecto: z.number().int().describe('Proyecto del desarrollo.'),
    folioProyecto: z.number().int().describe('Folio del proyecto.'),
    nombreProyecto: z.string().describe('Nombre/tema del proyecto.'),
    idCliente: z.number().int().describe('Cliente del proyecto.'),
    nombreCliente: z.string().describe('Nombre del cliente.'),
    idClienteDepartamento: z.number().int().describe('Departamento del cliente.'),
    nombreDepartamento: z.string().describe('Nombre del departamento.'),
    temporada: z.string().nullable().describe('Temporada del proyecto, o null.'),
    precostoVigente: esquemaExpedientePrecosto
      .nullable()
      .describe('Última versión CONGELADA del precosto, o null si aún no hay congelado.'),
    lista: esquemaExpedienteLista
      .nullable()
      .describe('Renglón de lista/precio del desarrollo, o null si no está en lista.'),
    acuerdos: z
      .array(esquemaNegociacionEventoSalida)
      .describe('Acuerdos/rondas de negociación del renglón (solo lectura, cronológico).'),
  })
  .describe('Expediente 360 de una orden ligada a Desarrollo.');

/** Forma del expediente 360 en la API. */
export type ExpedienteOrdenSalida = z.infer<typeof esquemaExpedienteOrdenSalida>;

// ── Tablero de desarrollos por estado ───────────────────────────────────────────────────

/** Filtros del tablero de desarrollos (todos opcionales; empresa la toma la sesión, A9). */
export const esquemaTableroDesarrollosQuery = z
  .object({
    idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
    idClienteDepartamento: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por departamento del cliente.'),
    idTemporada: z.coerce.number().int().positive().optional().describe('Filtra por temporada.'),
  })
  .describe('Filtros del tablero de desarrollos por estado.');

/** Filtros validados del tablero. */
export type TableroDesarrollosQuery = z.infer<typeof esquemaTableroDesarrollosQuery>;

/** Salida del tablero: los conteos de desarrollos por estado derivado (agregados en el servidor). */
export const esquemaTableroDesarrollosSalida = esquemaConteosDesarrollo.describe(
  'Conteos de desarrollos por estado derivado (agregados en el servidor).',
);

/** Forma del tablero en la API. */
export type TableroDesarrollosSalida = z.infer<typeof esquemaTableroDesarrollosSalida>;
