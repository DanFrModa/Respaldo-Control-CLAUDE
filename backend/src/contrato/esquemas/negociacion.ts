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

/**
 * Query de la CALCULADORA de negociación (rediseño R5, §4.8): un precio OBJETIVO propuesto y, opcional,
 * la versión congelada cuyo costo simular (para previsualizar una ronda antes de guardarla). Sin
 * `idPrecosto` usa el costo VIGENTE del renglón.
 */
export const esquemaSimularNegociacionQuery = z.object({
  precioObjetivo: z.coerce
    .number({ error: 'El precio objetivo debe ser un número' })
    .nonnegative({ error: 'El precio objetivo no puede ser negativo' })
    .describe('Precio de venta propuesto para simular su margen.'),
  idPrecosto: z.coerce
    .number({ error: 'El id del precosto debe ser un número' })
    .int({ error: 'El id del precosto debe ser entero' })
    .positive({ error: 'El id del precosto debe ser positivo' })
    .optional()
    .describe('Versión congelada cuyo costo simular (opcional; por defecto el costo vigente).'),
});

/** Datos validados de la calculadora. */
export type DatosSimularNegociacion = z.infer<typeof esquemaSimularNegociacionQuery>;

// ── Salida ──────────────────────────────────────────────────────────────────────

/**
 * Resultado de la CALCULADORA de negociación en vivo (rediseño R5, §4.8): el costo, el precio neto y
 * el margen bruto que deja un precio objetivo, coloreado contra el margen objetivo del cliente. La
 * ruta exige `consultas.ver-importes`.
 *
 * 🔴 **V1-E8b (§Post-F9.125(b)): los cuatro campos derivados de los FACTORES salen en `null` sin
 * `listas.aprobar`.** No es prudencia: `margenObjetivoPct` ES el factor `margenPct` servido tal cual,
 * `precioNeto` entrega la suma de los otros tres al dividirlo entre el objetivo, `margenBrutoPct`
 * arrastra esa misma fuga y `cumpleObjetivo` es un oráculo que reconstruye el margen a fuerza de
 * preguntar. `costo` y `precioObjetivo` NO se ocultan: el primero ya se ve en el desglose del renglón,
 * el segundo lo escribió quien pregunta.
 */
export const esquemaSimulacionNegociacion = z
  .object({
    costo: z.number().describe('Costo unitario simulado (del precosto vigente o el indicado).'),
    precioObjetivo: z.number().describe('Precio objetivo capturado (eco de la entrada).'),
    precioNeto: z
      .number()
      .nullable()
      .describe(
        'Precio neto = objetivo − (descuentos + regalías + costo de ventas) sobre la venta. ' +
          'Null sin `listas.aprobar` (delataría la suma de los tres factores).',
      ),
    margenBrutoPct: z
      .number()
      .nullable()
      .describe('% de margen bruto real: (neto − costo) ÷ neto × 100. Null sin `listas.aprobar`.'),
    margenObjetivoPct: z
      .number()
      .nullable()
      .describe(
        '% de margen objetivo del cliente (meta a cumplir) — ES el factor `margenPct` del ' +
          'snapshot. Null sin `listas.aprobar`.',
      ),
    cumpleObjetivo: z
      .boolean()
      .nullable()
      .describe(
        '¿El margen bruto alcanza el objetivo? (verde/rojo). Null sin `listas.aprobar`: expuesto ' +
          'sería un oráculo del margen.',
      ),
  })
  .describe('Simulación de margen de un precio objetivo (calculadora de negociación §4.8).');

/** Forma del resultado de la calculadora. */
export type SimulacionNegociacion = z.infer<typeof esquemaSimulacionNegociacion>;

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
    /**
     * ⭐ V1-E8q (§Post-F9.141) — el NOMBRE de quien lo escribió, resuelto en el servidor. El hilo
     * ya guardaba el `registradoPorId`, pero un id crudo no es un autor para nadie: Daniel pidió el
     * hilo "con autor y fecha" y lo que se pintaba era sólo la fecha. Se resuelve aquí (no en el
     * cliente) porque `NegociacionEvento` NO tiene FK física al usuario —es un log inmutable, igual
     * que `OrdenComentario`— y el frontend no tiene de dónde sacar el nombre.
     * Null si el evento no trae autor, o si el usuario ya no existe (el hilo NO se rompe por eso:
     * un renglón viejo se sigue leyendo aunque su autor se haya dado de baja).
     */
    nombreRegistradoPor: z
      .string()
      .nullable()
      .describe('Nombre de quien registró el evento (resuelto en el servidor), o null.'),
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
