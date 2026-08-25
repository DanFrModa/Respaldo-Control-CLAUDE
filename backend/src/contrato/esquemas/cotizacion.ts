import { z } from 'zod';

/**
 * Contrato Zod de la COTIZACIÓN (V1-E7c, §Post-F9.109) — **el documento que se le manda al cliente**,
 * el papel que sale de la mesa de negociación (la LISTA de precios).
 *
 * Forma dictada por Daniel: UNA cotización con **VARIOS modelos** (*"es un documento con las 5
 * cotizaciones… o sea una cotización con los 5 modelos"*), colgada de la LISTA (cliente +
 * departamento). Por eso el alta pide **sólo `idLista`**: no hay selección de renglones, porque su
 * regla es que **la cotización nueva lleva TODOS los modelos de la lista** aunque en esta vuelta sólo
 * hayan cambiado algunos — el cliente la lee sola, sin la anterior al lado.
 *
 * La cotización es **INMUTABLE**: nace emitida y no se edita jamás (otra vuelta = otra cotización).
 * Lo único posterior es **cancelarla con motivo** (D3). Toda la lógica vive en el dominio
 * (`dominio/desarrollo/cotizaciones.ts`, A1); aquí sólo las FORMAS.
 *
 * Los IMPORTES (`precioUnit`, `total`) se OCULTAN (null) sin `consultas.ver-importes`, igual que en la
 * lista de precios; el resto (folio, modelos, fechas, estado) siempre se ve.
 */

// ── Entradas ──────────────────────────────────────────────────────────────────────

/** Notas de la cotización (texto libre que se imprime en el papel). */
const notasCotizacion = z
  .string()
  .trim()
  .max(1000, { error: 'Las notas no pueden tener más de 1000 caracteres' });

/**
 * EMITIR una cotización desde una lista. Sólo la lista (+ fecha y notas opcionales): los renglones NO
 * se eligen, van TODOS los de la lista (regla de Daniel). El dominio rechaza si algún renglón no
 * tiene precio APROBADO, nombrando cuáles.
 */
export const esquemaCotizacionEmitir = z.object({
  idLista: z
    .number({ error: 'La lista de precios es obligatoria' })
    .int({ error: 'El id de la lista debe ser entero' })
    .positive({ error: 'El id de la lista debe ser positivo' })
    .describe('Lista de precios de la que se emite la cotización (van TODOS sus renglones).'),
  fecha: z.iso
    .date({ error: 'La fecha debe tener formato YYYY-MM-DD' })
    .optional()
    .describe('Fecha de la cotización (YYYY-MM-DD); default = hoy.'),
  notas: notasCotizacion
    .nullable()
    .optional()
    .describe('Notas que se imprimen en el documento (opcional).'),
});

/** Datos validados de la emisión. */
export type DatosCotizacionEmitir = z.infer<typeof esquemaCotizacionEmitir>;

/**
 * CANCELAR una cotización: el motivo es OBLIGATORIO. Una cotización jamás se borra ni se edita (D3);
 * cancelarla es ponerle un sello con quién, cuándo y por qué.
 */
export const esquemaCotizacionCancelar = z.object({
  motivo: z
    .string({ error: 'El motivo de la cancelación es obligatorio' })
    .trim()
    .min(3, { error: 'Explica el motivo de la cancelación (al menos 3 caracteres)' })
    .max(500, { error: 'El motivo no puede tener más de 500 caracteres' })
    .describe('Por qué se cancela (queda sellado en el documento y en la bitácora).'),
});

/** Datos validados de la cancelación. */
export type DatosCotizacionCancelar = z.infer<typeof esquemaCotizacionCancelar>;

// ── Salida ──────────────────────────────────────────────────────────────────────

/**
 * Un renglón de la cotización — un MODELO ofrecido, con sus valores **CONGELADOS** al momento de
 * emitir. NO se releen de la lista: la lista sigue moviéndose y el papel debe seguir diciendo lo que
 * dijo (si no, reimprimir la cotización de marzo enseñaría los precios de mayo).
 */
export const esquemaCotizacionLineaSalida = z
  .object({
    id: z.number().int().describe('Id del renglón de la cotización.'),
    idListaLinea: z.number().int().describe('Renglón de lista del que salió (procedencia).'),
    idPrecosto: z.number().int().describe('Versión congelada de la receta con la que se cotizó.'),
    versionPrecosto: z.number().int().describe('Nº de versión del precosto (congelado).'),
    codigoModelo: z.string().describe('Código del modelo (congelado).'),
    descripcionModelo: z
      .string()
      .nullable()
      .describe('Descripción del modelo (congelada), o null.'),
    numeroCliente: z
      .string()
      .nullable()
      .describe('Número del modelo en el catálogo del cliente (congelado), o null.'),
    precioUnit: z
      .number()
      .nullable()
      .describe('Precio unitario OFRECIDO (congelado), o null sin ver-importes.'),
  })
  .describe('Renglón de una cotización (valores congelados al emitir).');

/** Forma de un renglón de cotización. */
export type CotizacionLineaSalida = z.infer<typeof esquemaCotizacionLineaSalida>;

/** Una cotización COMPLETA con sus renglones (para el detalle y el impreso). */
export const esquemaCotizacionDetalle = z
  .object({
    id: z.number().int().describe('Id de la cotización.'),
    folio: z.number().int().describe('Folio consecutivo por empresa (secuencia atómica).'),
    idLista: z.number().int().describe('Lista de precios de la que se emitió.'),
    folioLista: z.number().int().describe('Folio de esa lista.'),
    idCliente: z.number().int().describe('Cliente al que se le cotizó.'),
    nombreCliente: z.string().describe('Nombre del cliente.'),
    idClienteDepartamento: z.number().int().describe('Departamento del cliente.'),
    nombreDepartamento: z.string().describe('Nombre del departamento.'),
    fecha: z.iso.date().describe('Fecha de la cotización (YYYY-MM-DD).'),
    estado: z.string().describe('`emitida` o `cancelada`.'),
    notas: z.string().nullable().describe('Notas impresas en el documento, o null.'),
    motivoCancelacion: z.string().nullable().describe('Por qué se canceló, o null.'),
    canceladaPorId: z.string().nullable().describe('Quién la canceló, o null.'),
    canceladaEn: z.iso.datetime().nullable().describe('Cuándo se canceló (ISO 8601), o null.'),
    lineas: z.array(esquemaCotizacionLineaSalida).describe('Los modelos ofrecidos (van todos).'),
    total: z
      .number()
      .nullable()
      .describe('Suma de los precios unitarios ofrecidos, o null sin ver-importes.'),
    creadoEn: z.iso.datetime().describe('Cuándo se emitió (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Quién la emitió.'),
  })
  .describe('Cotización (documento inmutable) con sus renglones congelados.');

/** Forma de una cotización completa. */
export type CotizacionDetalle = z.infer<typeof esquemaCotizacionDetalle>;

/** Una cotización en el LISTADO (resumen, sin renglones). */
export const esquemaCotizacionResumen = z
  .object({
    id: z.number().int().describe('Id de la cotización.'),
    folio: z.number().int().describe('Folio consecutivo por empresa.'),
    idLista: z.number().int().describe('Lista de precios de la que se emitió.'),
    folioLista: z.number().int().describe('Folio de esa lista.'),
    idCliente: z.number().int().describe('Cliente.'),
    nombreCliente: z.string().describe('Nombre del cliente.'),
    nombreDepartamento: z.string().describe('Nombre del departamento.'),
    fecha: z.iso.date().describe('Fecha de la cotización (YYYY-MM-DD).'),
    estado: z.string().describe('`emitida` o `cancelada`.'),
    totalRenglones: z.number().int().describe('Cuántos modelos lleva el documento.'),
    total: z
      .number()
      .nullable()
      .describe('Suma de los precios ofrecidos, o null sin ver-importes.'),
    creadoEn: z.iso.datetime().describe('Cuándo se emitió (ISO 8601).'),
  })
  .describe('Resumen de una cotización (para el listado).');

/** Forma del resumen de una cotización. */
export type CotizacionResumen = z.infer<typeof esquemaCotizacionResumen>;

/** Respuesta del listado de cotizaciones. */
export const esquemaCotizacionesLista = z
  .object({
    datos: z.array(esquemaCotizacionResumen).describe('Cotizaciones (más nueva primero).'),
  })
  .describe('Cotizaciones emitidas (V1-E7c).');

/** Forma del listado de cotizaciones. */
export type CotizacionesLista = z.infer<typeof esquemaCotizacionesLista>;

/** Querystring del listado (todos los filtros opcionales). */
export const esquemaCotizacionesQuery = z.object({
  idLista: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Sólo las cotizaciones emitidas de esta lista.'),
  idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
  estado: z
    .enum(['emitida', 'cancelada'], { error: 'El estado debe ser "emitida" o "cancelada"' })
    .optional()
    .describe('Filtra por estado del documento.'),
  desde: z.iso.date().optional().describe('Fecha mínima (YYYY-MM-DD).'),
  hasta: z.iso.date().optional().describe('Fecha máxima (YYYY-MM-DD).'),
});

/** Parámetros del listado (los reutiliza la ruta REST). */
export type CotizacionesQuery = z.infer<typeof esquemaCotizacionesQuery>;
