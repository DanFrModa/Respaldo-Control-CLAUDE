import { z } from 'zod';

/**
 * Contrato Zod de la NEGOCIACIÓN por versiones de la lista de precios (F8-E5, D13/R20b — Desarrollo y
 * Cotización). La negociación es re-costeo por RONDAS + acuerdos por renglón + estados de la lista:
 *
 *  • RONDA: se ajusta el desarrollo (BOM/conceptos) → se congela una nueva versión del precosto (E3) →
 *    el renglón se RE-APUNTA a esa versión (recalcula `precioCalculado`, RESETEA `precioAprobado`), y
 *    queda un `NegociacionEvento` INMUTABLE (la versión y el precio anteriores nunca se pierden).
 *  • ACUERDO sin re-costeo: sólo registra un `NegociacionEvento` (precio acordado + nota); no toca el
 *    precosto ni el precio aprobado del renglón.
 *  • ESTADO de la lista: `EstadoLista` configurable; los de CIERRE bloquean rondas/acuerdos/ediciones
 *    de renglón. Reabrir una lista cerrada = cambiar su estado (auditado por la bitácora).
 *
 * Los IMPORTES de los eventos (precioAnterior/precioNuevo) se OCULTAN (null) sin `consultas.ver-importes`
 * (lo aplica el dominio, A1); las versiones (número de precosto) siempre se ven. Aquí sólo las FORMAS.
 */

// ── Entradas ──────────────────────────────────────────────────────────────────────

/** Texto del acuerdo (qué se cambió/pactó). Obligatorio, no vacío, tope de longitud. */
const acuerdoTexto = z
  .string({ error: 'El acuerdo es obligatorio' })
  .trim()
  .min(1, { error: 'Escribe qué se cambió o acordó' })
  .max(2000, { error: 'El acuerdo no puede tener más de 2000 caracteres' })
  .describe('Qué se cambió/acordó en esta ronda o acuerdo (texto).');

/** Precio acordado opcional (> 0 si viene). Va SÓLO al evento; la ronda NO fija el precio aprobado. */
const precioAcordado = z
  .number({ error: 'El precio acordado debe ser un número' })
  .positive({ error: 'El precio acordado debe ser mayor a cero' })
  .nullable()
  .optional()
  .describe(
    'Precio acordado (opcional). Sólo se registra en el evento, no fija el precio aprobado.',
  );

/**
 * REGISTRAR RONDA sobre un renglón: re-apunta a un precosto CONGELADO NUEVO (del mismo desarrollo) y
 * bitacorea el evento. La ronda recalcula `precioCalculado` con los factores de la lista y RESETEA el
 * `precioAprobado` (el precio nuevo se re-aprueba después con `listas.aprobar`).
 */
export const esquemaRondaRegistrar = z.object({
  idPrecostoNuevo: z
    .number({ error: 'El precosto nuevo es obligatorio' })
    .int({ error: 'El id del precosto debe ser entero' })
    .positive({ error: 'El id del precosto debe ser positivo' })
    .describe(
      'Versión CONGELADA nueva del precosto (del mismo desarrollo, distinta de la actual).',
    ),
  acuerdo: acuerdoTexto,
  precioAcordado,
});

/** Datos validados de una ronda. */
export type DatosRondaRegistrar = z.infer<typeof esquemaRondaRegistrar>;

/** REGISTRAR ACUERDO sin re-costeo: sólo el evento (precio acordado opcional + nota). */
export const esquemaAcuerdoRegistrar = z.object({
  acuerdo: acuerdoTexto,
  precioAcordado,
});

/** Datos validados de un acuerdo. */
export type DatosAcuerdoRegistrar = z.infer<typeof esquemaAcuerdoRegistrar>;

/** CAMBIAR ESTADO de la lista (a cualquier `EstadoLista` activo, incluida la reapertura). */
export const esquemaCambiarEstadoLista = z.object({
  idEstadoLista: z
    .number({ error: 'El estado es obligatorio' })
    .int({ error: 'El id del estado debe ser entero' })
    .positive({ error: 'El id del estado debe ser positivo' })
    .describe('Estado destino de la lista (debe estar activo).'),
});

/** Datos validados del cambio de estado. */
export type DatosCambiarEstadoLista = z.infer<typeof esquemaCambiarEstadoLista>;

// ── Salida ──────────────────────────────────────────────────────────────────────

/** Un evento de negociación de un renglón (bitácora inmutable; importes ocultos sin permiso). */
export const esquemaNegociacionEventoSalida = z
  .object({
    id: z.number().int().describe('Id del evento.'),
    idListaLinea: z.number().int().describe('Renglón de lista al que pertenece.'),
    idPrecostoAnterior: z
      .number()
      .int()
      .nullable()
      .describe('Precosto anterior (null en un acuerdo sin re-costeo).'),
    idPrecostoNuevo: z
      .number()
      .int()
      .nullable()
      .describe('Precosto nuevo (null en un acuerdo sin re-costeo).'),
    versionAnterior: z
      .number()
      .int()
      .nullable()
      .describe('Nº de versión del precosto anterior, o null.'),
    versionNueva: z.number().int().nullable().describe('Nº de versión del precosto nuevo, o null.'),
    precioAnterior: z
      .number()
      .nullable()
      .describe('Precio antes de la ronda/acuerdo (o null sin importes / sin dato).'),
    precioNuevo: z
      .number()
      .nullable()
      .describe('Precio nuevo/acordado (o null sin importes / sin dato).'),
    acuerdo: z.string().describe('Qué se cambió/acordó (texto).'),
    registradoPorId: z.string().nullable().describe('Quién registró el evento, o null.'),
    registradoEn: z.iso.datetime().describe('Cuándo se registró (ISO 8601).'),
  })
  .describe('Evento de negociación de un renglón (ronda o acuerdo).');

/** Forma de un evento de negociación. */
export type NegociacionEventoSalida = z.infer<typeof esquemaNegociacionEventoSalida>;

/** Respuesta del historial de eventos de un renglón (orden cronológico). */
export const esquemaNegociacionEventos = z
  .object({
    datos: z
      .array(esquemaNegociacionEventoSalida)
      .describe('Eventos de negociación del renglón (más antiguo primero).'),
  })
  .describe('Historial de negociación de un renglón de lista (D13/R20b).');

/** Forma del historial de eventos. */
export type NegociacionEventos = z.infer<typeof esquemaNegociacionEventos>;
