import { z } from 'zod';

import { esquemaLoteComponenteEntrada } from './inventario-material.js';

/**
 * Esquemas Zod de la RECEPCIÓN de compras (F4-E3 — doc `Documentacion_MJD/03-Produccion.md` §OC;
 * R7). UNA sola definición de reglas para UI y servidor (alimenta el OpenAPI). La recepción recibe
 * (parcial o total) el material de una OC AUTORIZADA, crea el lote de la tela (D5) y registra la
 * ENTRADA al kardex con cantidad/costo YA convertidos a unidad de consumo (R1, motor
 * `comun/conversion.ts`). DECISIÓN (b): SOLO se recibe contra una OC `autorizada`/`recibida_parcial`
 * (lo refuerza el dominio, server-side, A4).
 *
 * Captura por LÍNEA DE OC: cada renglón de recepción referencia un `idOrdenCompraLinea` y la
 * `cantidadRecibida` en la PRESENTACIÓN de compra (la misma unidad de la OC). El dominio:
 *  • Convierte cantidad/costo a unidad de consumo con el factor del avío/proveedor (R1).
 *  • Para TELAS, exige el `lote` (clave + 1..N componentes mismo color, D5) que crea en la misma tx.
 *  • Para AVÍOS, no hay lote (el lote del avío es opcional y no entra en la dimensión, R4).
 *  • Para líneas LIBRES (la OC no tiene tela/avío), registra la cantidad pero NO mueve kardex.
 */

const idPositivo = (campo: string) =>
  z
    .number({ error: `El id de ${campo} es obligatorio` })
    .int({ error: `El id de ${campo} debe ser entero` })
    .positive({ error: `El id de ${campo} debe ser positivo` });

// ── Lote de la recepción (para líneas de TELA) ───────────────────────────────────────────────────

/**
 * Lote a CREAR en la recepción de una línea de TELA (D5). Define el color (teñido) y trae 1..N
 * componentes del mismo lote/color. La clave se autogenera en el dominio si no se manda. El
 * `idProveedor`/`factura`/`fecha` los puede heredar el dominio de la OC/recepción si no vienen.
 */
export const esquemaRecepcionLoteEntrada = z
  .object({
    clave: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe('Clave del lote (autogenerada si falta).'),
    idColor: idPositivo('el color'),
    idProveedor: idPositivo('el proveedor').optional(),
    factura: z.string().trim().max(100).optional(),
    fecha: z.iso.date({ error: 'La fecha del lote debe ser YYYY-MM-DD' }).optional(),
    observaciones: z.string().trim().max(1000).optional(),
    componentes: z
      .array(esquemaLoteComponenteEntrada)
      .min(1, { error: 'El lote necesita al menos un componente (tela)' }),
  })
  .describe('Lote de tela a crear en la recepción con sus componentes (D5).');

/** Datos de un lote a crear en la recepción. */
export type DatosRecepcionLoteEntrada = z.infer<typeof esquemaRecepcionLoteEntrada>;

// ── Renglón de la recepción ──────────────────────────────────────────────────────────────────────

/**
 * Un renglón de recepción: cuánto se recibe contra un renglón de OC. `cantidad` va en la
 * PRESENTACIÓN de compra (misma unidad de la OC); el dominio la convierte a unidad de consumo (R1).
 * `lote` es obligatorio para líneas de TELA (lo valida el dominio según el renglón de OC); en
 * avío/libre va ausente.
 */
export const esquemaRecepcionLineaEntrada = z
  .object({
    idOrdenCompraLinea: idPositivo('el renglón de la orden de compra'),
    cantidad: z
      .number({ error: 'La cantidad recibida es obligatoria' })
      .positive({ error: 'La cantidad recibida debe ser mayor que 0' })
      .describe('Cantidad recibida en la PRESENTACIÓN de compra (se convierte a consumo, R1).'),
    lote: esquemaRecepcionLoteEntrada
      .optional()
      .describe('Lote a crear (OBLIGATORIO en líneas de tela, D5).'),
  })
  .describe('Renglón de recepción: cuánto se recibe contra un renglón de OC.');

/** Datos validados de un renglón de recepción. */
export type DatosRecepcionLineaEntrada = z.infer<typeof esquemaRecepcionLineaEntrada>;

// ── Alta de una recepción ────────────────────────────────────────────────────────────────────────

/**
 * Alta de una recepción contra una OC (F4-E3). `idOrdenCompra` obligatorio (recepciones v2 siempre
 * ligadas a OC). `idAlmacen` = destino del material. `lineas` = qué renglones de OC se reciben y
 * cuánto (parcial o total). La empresa la toma el dominio de la sesión activa (A9). El estatus de la
 * OC lo recalcula el dominio (parcial/total).
 */
export const esquemaRecepcionCrear = z
  .object({
    idOrdenCompra: idPositivo('la orden de compra'),
    idAlmacen: idPositivo('el almacén destino'),
    factura: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .optional()
      .describe('Factura del proveedor de esta recepción.'),
    fecha: z.iso.date({ error: 'La fecha de la recepción es obligatoria (YYYY-MM-DD)' }),
    observaciones: z.string().trim().max(2000).nullable().optional(),
    lineas: z
      .array(esquemaRecepcionLineaEntrada)
      .min(1, { error: 'Recibe al menos un renglón' })
      .describe('Renglones de OC que se reciben (parcial o total).'),
  })
  .describe('Recepción de material contra una OC autorizada (decisión b).');

/** Datos validados de alta de recepción. */
export type DatosRecepcionCrear = z.infer<typeof esquemaRecepcionCrear>;

// ── Reverso ──────────────────────────────────────────────────────────────────────────────────────

/** Cuerpo del reverso de una recepción (reverso SUAVE, D3): el motivo es OBLIGATORIO. */
export const esquemaRecepcionReversarCuerpo = z.object({
  motivo: z
    .string({ error: 'El motivo del reverso es obligatorio' })
    .trim()
    .min(1, { error: 'El motivo del reverso es obligatorio' })
    .max(2000, { error: 'El motivo no puede tener más de 2000 caracteres' })
    .describe('Motivo del reverso (obligatorio).'),
});

/** Datos validados del cuerpo de reversar. */
export type DatosRecepcionReversar = z.infer<typeof esquemaRecepcionReversarCuerpo>;

// ── Salidas ──────────────────────────────────────────────────────────────────────────────────────

/** Renglón de una recepción en la salida (con nombres y la traza al renglón de OC). */
export const esquemaRecepcionLineaSalida = z
  .object({
    id: z.number().int().describe('Id del renglón de recepción.'),
    idOrdenCompraLinea: z.number().int().describe('Renglón de OC que se recibió.'),
    tipo: z.enum(['tela', 'avio', 'libre']).describe('Tipo del material recibido.'),
    idTela: z.number().int().nullable().describe('Tela del catálogo, o null.'),
    tela: z.string().nullable().describe('Nombre de la tela, o null.'),
    idAvio: z.number().int().nullable().describe('Avío del catálogo, o null.'),
    avio: z.string().nullable().describe('Clave/descripción del avío, o null.'),
    descripcionLibre: z.string().nullable().describe('Descripción libre (líneas libres), o null.'),
    cantidadRecibida: z
      .number()
      .describe('Cantidad recibida en unidad de consumo (ya convertida, R1).'),
    costoUnit: z
      .number()
      .nullable()
      .describe('Costo por unidad de consumo (precio ÷ factor), o null.'),
    idLote: z.number().int().nullable().describe('Lote creado (telas), o null.'),
    loteClave: z.string().nullable().describe('Clave del lote, o null.'),
    idMovimiento: z.number().int().nullable().describe('Movimiento de kardex generado, o null.'),
    folioMovimiento: z
      .number()
      .int()
      .nullable()
      .describe('Folio del movimiento de kardex, o null.'),
  })
  .describe('Renglón de una recepción de compra.');

/** Forma de un renglón de recepción en la API. */
export type RecepcionLineaSalida = z.infer<typeof esquemaRecepcionLineaSalida>;

/** Salida de una recepción (encabezado + renglones). */
export const esquemaRecepcionSalida = z
  .object({
    id: z.number().int().describe('Id interno de la recepción.'),
    folio: z.number().int().describe('Folio consecutivo por empresa.'),
    idEmpresa: z.number().int().describe('Empresa dueña (A9).'),
    idOrdenCompra: z.number().int().describe('OC contra la que se recibió.'),
    numCompra: z.number().int().describe('Folio de la OC (para la UI).'),
    idAlmacen: z.number().int().describe('Almacén destino.'),
    almacen: z.string().describe('Nombre del almacén destino.'),
    factura: z.string().nullable().describe('Factura del proveedor, o null.'),
    fecha: z.iso.date().describe('Fecha de la recepción (YYYY-MM-DD).'),
    observaciones: z.string().nullable().describe('Observaciones, o null.'),
    reversada: z.boolean().describe('¿La recepción fue reversada (D3)?'),
    reversadaEn: z.iso.datetime().nullable().describe('Fecha del reverso (ISO), o null.'),
    reversadaPorId: z.string().nullable().describe('Usuario que reversó, o null.'),
    motivoReverso: z.string().nullable().describe('Motivo del reverso, o null.'),
    lineas: z.array(esquemaRecepcionLineaSalida).describe('Renglones recibidos.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
  })
  .describe('Recepción de compra (encabezado + renglones).');

/** Forma de una recepción en la API. */
export type RecepcionSalida = z.infer<typeof esquemaRecepcionSalida>;

/** Lista de recepciones de una OC (no paginada: son pocas por OC). */
export const esquemaRecepcionesLista = z
  .object({
    recepciones: z
      .array(esquemaRecepcionSalida)
      .describe('Recepciones de la OC (orden cronológico).'),
  })
  .describe('Recepciones de una orden de compra.');

/** Forma de la lista de recepciones de una OC. */
export type RecepcionesLista = z.infer<typeof esquemaRecepcionesLista>;
