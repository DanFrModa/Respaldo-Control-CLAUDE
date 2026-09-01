import { z } from 'zod';

/**
 * Esquemas Zod de los HITOS de una orden (cierre del hueco de emisores, post-F9). Un hito es un acto
 * puntual que se captura en el detalle de la orden (revisión de la OP, autorización de fit/tono/avíos,
 * empaque, autorización de arte) y que auto-completa el proceso RC ligado vía el auto-avance. Una sola
 * definición de reglas para UI y servidor (alimenta el OpenAPI). Operaciones: LISTAR los hitos vivos
 * de la orden, REGISTRAR un hito y CANCELAR uno (suave, con motivo).
 */

const idParamPositivo = z.coerce
  .number({ error: 'El id debe ser un número' })
  .int({ error: 'El id debe ser entero' })
  .positive({ error: 'El id debe ser positivo' });

/** Tipos de hito de orden (mapean a un `TipoEventoProceso` en el dominio). */
export const TIPOS_HITO_ORDEN = [
  'revisionOp',
  'fit',
  'tonoTela',
  'avios',
  'empaque',
  'arte',
] as const;
/** Clave de tipo de hito. */
export type TipoHitoOrdenClave = (typeof TIPOS_HITO_ORDEN)[number];

/** Parámetro de ruta `:id` (la ORDEN) + `:idHito` (para cancelar). */
export const esquemaParamOrdenHito = z.object({
  id: idParamPositivo.describe('Id de la orden de producción.'),
  idHito: idParamPositivo.describe('Id del hito a cancelar.'),
});

// ── Cuerpos de entrada ────────────────────────────────────────────────────────

/** Cuerpo para REGISTRAR un hito de la orden (fecha opcional; por defecto hoy). */
export const esquemaRegistrarHitoCuerpo = z
  .object({
    tipo: z.enum(TIPOS_HITO_ORDEN).describe('Tipo de hito a registrar.'),
    fecha: z.iso
      .date({ error: 'La fecha del hito debe ser YYYY-MM-DD' })
      .optional()
      .describe('Fecha física del hito (YYYY-MM-DD); por defecto hoy.'),
  })
  .describe('Datos para registrar un hito de la orden.');
/** Datos validados de registro de hito. */
export type DatosRegistrarHito = z.infer<typeof esquemaRegistrarHitoCuerpo>;

/** Cuerpo para CANCELAR un hito (motivo OBLIGATORIO, cancelación suave). */
export const esquemaCancelarHitoCuerpo = z
  .object({
    motivo: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(1, { error: 'El motivo es obligatorio' })
      .max(500, { error: 'El motivo no puede superar 500 caracteres' })
      .describe('Motivo de la cancelación del hito.'),
  })
  .describe('Datos para cancelar un hito de la orden.');
/** Datos validados de cancelación de hito. */
export type DatosCancelarHito = z.infer<typeof esquemaCancelarHitoCuerpo>;

// ── Salida ────────────────────────────────────────────────────────────────────

/** Un hito VIVO de la orden (los listados/mutaciones sólo devuelven los no cancelados). */
export const esquemaHitoOrdenSalida = z
  .object({
    id: z.number().int().describe('Id del hito.'),
    idOrden: z.number().int().describe('Orden a la que pertenece.'),
    tipo: z.enum(TIPOS_HITO_ORDEN).describe('Tipo de hito.'),
    registradoPorId: z.string().nullable().describe('Usuario que registró el hito (o null).'),
    nombreRegistradoPor: z
      .string()
      .nullable()
      .describe(
        'Nombre de quien lo registró; null si el id no resuelve (el hito se sigue viendo).',
      ),
    fecha: z.iso.date().describe('Fecha física del hito (YYYY-MM-DD).'),
    creadoEn: z.iso.datetime().describe('Sello de creación.'),
  })
  .describe('Hito vivo de una orden.');
/** Un hito de orden. */
export type HitoOrdenSalida = z.infer<typeof esquemaHitoOrdenSalida>;

/** Lista de hitos VIVOS de una orden (respuesta del GET y de las mutaciones). */
export const esquemaHitosOrdenSalida = z
  .array(esquemaHitoOrdenSalida)
  .describe('Hitos vivos de la orden.');
/** Lista de hitos de orden. */
export type HitosOrdenSalida = z.infer<typeof esquemaHitosOrdenSalida>;
