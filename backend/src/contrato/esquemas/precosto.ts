import { z } from 'zod';

/**
 * Contrato Zod del PRECOSTO PERSISTIDO por desarrollo (F8-E3, D13/R17/R18/R19 — Desarrollo y
 * Cotización). Es el corazón de la fase: el precosteo "al vuelo" de F7 se materializa aquí en filas
 * `Precosto`/`PrecostoLinea`, versionable por CONGELADO INMUTABLE.
 *
 * Un `Precosto` tiene un `estado`: `borrador` (editable) → `congelado` (INMUTABLE, base de la lista y
 * de la negociación). A lo más UN borrador por desarrollo. Sus renglones (`PrecostoLinea`) salen del
 * BOM del modelo (tela/avío/arte, con los PRECIOS AMARRADOS de E1 y el promedio de las medidas por
 * talla, R18) o son MANUALES (maquila, estampado, otros procesos…), agrupables por CONCEPTO de costo.
 *
 * Los IMPORTES/precios (precioUnit, importe, costoTotal) se OCULTAN (null) sin `consultas.ver-importes`
 * (mismo criterio que F7/EsMa); el CONSUMO (cantidad) siempre se ve. Toda la lógica vive en el dominio
 * (`dominio/desarrollo/precostos.ts`, A1); aquí solo las FORMAS.
 */

// ── Estado + origen ────────────────────────────────────────────────────────────────

/** Estado de un precosto: `borrador` (editable) → `congelado` (inmutable). */
export const esquemaEstadoPrecosto = z
  .enum(['borrador', 'congelado'])
  .describe('Estado del precosto (borrador editable / congelado inmutable).');

/** Clave del estado de un precosto. */
export type EstadoPrecostoClave = z.infer<typeof esquemaEstadoPrecosto>;

/**
 * Origen de un renglón: del BOM (tela/avío/arte — se regeneran al recalcular) o `manual` (maquila
 * y conceptos abiertos — sobreviven al recalcular). Coincide con el enum `OrigenPrecostoLinea` de la
 * BD.
 */
export const esquemaOrigenPrecostoLinea = z
  .enum(['bom_tela', 'bom_avio', 'bom_arte', 'manual'])
  .describe('Origen del renglón (BOM tela/avío/arte, o manual).');

/** Clave del origen de un renglón de precosto. */
export type OrigenPrecostoLineaClave = z.infer<typeof esquemaOrigenPrecostoLinea>;

// ── Entradas: renglones manuales ─────────────────────────────────────────────────────

/** Descripción de un renglón manual (texto libre; por default el nombre del concepto). */
const descripcionLinea = z
  .string()
  .trim()
  .min(1, { error: 'La descripción es obligatoria' })
  .max(200, { error: 'La descripción no puede tener más de 200 caracteres' });

/** Notas de un renglón (texto libre). */
const notasLinea = z
  .string()
  .trim()
  .max(1000, { error: 'Las notas no pueden tener más de 1000 caracteres' });

/**
 * Alta de un renglón MANUAL (estampado, otros procesos, otros…): contra un `ConceptoCosto` existente
 * y activo. El importe lo arma el dominio: `consumo × precioUnit` si hay consumo, o `precioUnit` a
 * secas (monto directo).
 *
 * El insumo se puede ELEGIR DEL CATÁLOGO DE AVÍOS (`idAvio`, petición de Daniel ago-2026: los
 * avíos del precosteo no se podían elegir): con `idAvio` el DOMINIO resuelve descripción y PRECIO
 * con la MISMA cascada amarrada del BOM (`resolverPrecioAvio` / promedio de medidas) y deja el
 * renglón LIGADO al avío (traza `idAvio`/`idAvioProveedor`). El texto libre se conserva como opción
 * (hay conceptos que no son avíos: maquila extra, fletes, muestras…).
 *
 * Por eso `precioUnit` es OPCIONAL **sólo** cuando viene `idAvio` (el catálogo lo resuelve y el
 * usuario lo puede editar después); sin avío el precio se teclea y es OBLIGATORIO. Si viene el
 * precio, MANDA sobre el del catálogo (queda editable de entrada).
 */
export const esquemaPrecostoLineaManualCrear = z
  .object({
    idConceptoCosto: z
      .number({ error: 'El concepto de costo es obligatorio' })
      .int({ error: 'El id del concepto debe ser entero' })
      .positive({ error: 'El id del concepto debe ser positivo' })
      .describe('Concepto de costo (ConceptoCosto.id) del renglón manual.'),
    idAvio: z
      .number({ error: 'El id del avío debe ser un número' })
      .int({ error: 'El id del avío debe ser entero' })
      .positive({ error: 'El id del avío debe ser positivo' })
      .optional()
      .describe(
        'Avío del catálogo (Avio.id) al que se liga el renglón. Con él, el dominio resuelve descripción y precio.',
      ),
    descripcion: descripcionLinea
      .optional()
      .describe('Descripción del renglón (por default el avío elegido, o el nombre del concepto).'),
    consumo: z
      .number({ error: 'El consumo debe ser un número' })
      .nonnegative({ error: 'El consumo no puede ser negativo' })
      .nullable()
      .optional()
      .describe(
        'Consumo (cantidad). Si viene, importe = consumo × precioUnit; si no, importe = precioUnit.',
      ),
    precioUnit: z
      .number({ error: 'El precio debe ser un número' })
      .nonnegative({ error: 'El precio no puede ser negativo' })
      .optional()
      .describe(
        'Precio unitario (o monto directo si no hay consumo). Obligatorio salvo que venga `idAvio`.',
      ),
    notas: notasLinea.nullable().optional().describe('Notas del renglón (opcional).'),
  })
  .refine((datos) => datos.precioUnit !== undefined || datos.idAvio !== undefined, {
    error: 'El precio es obligatorio (o elige un avío del catálogo para tomar el suyo)',
    path: ['precioUnit'],
  });

/** Datos validados de alta de un renglón manual. */
export type DatosPrecostoLineaManualCrear = z.infer<typeof esquemaPrecostoLineaManualCrear>;

/**
 * Edición de un renglón (maquila o manual): PATCH parcial. Omitir = no tocar; `null` en consumo/notas
 * = vaciarlo. Los renglones de ORIGEN BOM no se editan (se recalculan desde el BOM). El importe lo
 * recompone el dominio.
 */
export const esquemaPrecostoLineaEditar = z.object({
  descripcion: descripcionLinea.optional().describe('Nueva descripción (omitir = no tocar).'),
  consumo: z
    .number({ error: 'El consumo debe ser un número' })
    .nonnegative({ error: 'El consumo no puede ser negativo' })
    .nullable()
    .optional()
    .describe('Nuevo consumo (null para vaciarlo; omitir para no tocar).'),
  precioUnit: z
    .number({ error: 'El precio debe ser un número' })
    .nonnegative({ error: 'El precio no puede ser negativo' })
    .optional()
    .describe('Nuevo precio unitario (omitir = no tocar).'),
  notas: notasLinea
    .nullable()
    .optional()
    .describe('Notas (null para vaciarlas; omitir para no tocar).'),
});

/** Datos validados de edición de un renglón. */
export type DatosPrecostoLineaEditar = z.infer<typeof esquemaPrecostoLineaEditar>;

// ── Salida ───────────────────────────────────────────────────────────────────────

/** Un renglón de precosto (con la traza del amarre y las banderas de edición para la UI). */
export const esquemaPrecostoLineaSalida = z
  .object({
    id: z.number().int().describe('Id del renglón.'),
    idConceptoCosto: z.number().int().describe('Concepto de costo del renglón.'),
    conceptoCodigo: z.string().describe('Código del concepto (para agrupar).'),
    conceptoNombre: z.string().describe('Nombre del concepto.'),
    conceptoOrden: z.number().int().describe('Orden de despliegue del concepto.'),
    conceptoFijo: z.boolean().describe('¿El concepto es fijo (tela/avíos/maquila)?'),
    origen: esquemaOrigenPrecostoLinea,
    descripcion: z.string().describe('Descripción del renglón (nombre del insumo o del concepto).'),
    consumo: z.number().nullable().describe('Consumo/cantidad (o null si no aplica).'),
    precioUnit: z.number().nullable().describe('Precio unitario (o null sin importes).'),
    importe: z.number().nullable().describe('Importe del renglón (o null sin importes).'),
    notas: z.string().nullable().describe('Notas del renglón, o null.'),
    idTela: z.number().int().nullable().describe('Traza: tela del amarre, o null.'),
    idTelaProveedor: z
      .number()
      .int()
      .nullable()
      .describe('Traza: proveedor-tela amarrado, o null.'),
    idAvio: z.number().int().nullable().describe('Traza: avío del amarre, o null.'),
    idAvioProveedor: z
      .number()
      .int()
      .nullable()
      .describe('Traza: proveedor del avío usado, o null.'),
    idModeloArte: z.number().int().nullable().describe('Traza: arte del modelo, o null.'),
    editable: z
      .boolean()
      .describe('¿La UI puede editar este renglón en un borrador? (cualquiera; R5/B12).'),
    eliminable: z
      .boolean()
      .describe(
        '¿La UI puede quitarlo? (cualquiera salvo los anclas maquila/corte/empaque; R5/B12 + V1-E8w).',
      ),
    ajustado: z
      .boolean()
      .describe(
        '¿Renglón de origen BOM ajustado a mano en la negociación? (recalcular no lo pisa).',
      ),
  })
  .describe('Renglón de precosto.');

/** Forma de un renglón de precosto. */
export type PrecostoLineaSalida = z.infer<typeof esquemaPrecostoLineaSalida>;

/** Un precosto COMPLETO con sus renglones (para el editor del detalle del desarrollo). */
export const esquemaPrecostoSalida = z
  .object({
    id: z.number().int().describe('Id del precosto.'),
    idDesarrollo: z.number().int().describe('Desarrollo al que pertenece.'),
    version: z.number().int().describe('Número de versión (consecutivo por desarrollo).'),
    estado: esquemaEstadoPrecosto,
    congelado: z.boolean().describe('Conveniencia: estado === "congelado" (inmutable).'),
    congeladoEn: z.iso.datetime().nullable().describe('Cuándo se congeló (ISO 8601), o null.'),
    congeladoPorId: z.string().nullable().describe('Quién lo congeló, o null.'),
    costoTotal: z
      .number()
      .nullable()
      .describe('Σ importes de los renglones (o null sin importes).'),
    lineas: z.array(esquemaPrecostoLineaSalida).describe('Renglones (agrupables por concepto).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Precosto persistido de un desarrollo, con sus renglones.');

/** Forma de un precosto completo. */
export type PrecostoSalida = z.infer<typeof esquemaPrecostoSalida>;

/** Un precosto en el HISTORIAL de versiones (resumen, sin renglones). */
export const esquemaPrecostoResumen = z
  .object({
    id: z.number().int().describe('Id del precosto.'),
    version: z.number().int().describe('Número de versión.'),
    estado: esquemaEstadoPrecosto,
    congelado: z.boolean().describe('¿Congelado (inmutable)?'),
    costoTotal: z.number().nullable().describe('Costo total (o null sin importes).'),
    congeladoEn: z.iso.datetime().nullable().describe('Cuándo se congeló, o null.'),
    congeladoPorId: z.string().nullable().describe('Quién lo congeló, o null.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
  })
  .describe('Resumen de una versión de precosto (para el historial).');

/** Forma del resumen de un precosto. */
export type PrecostoResumen = z.infer<typeof esquemaPrecostoResumen>;

/** Respuesta del historial de precostos de un desarrollo (más nuevo primero). */
export const esquemaPrecostosDesarrolloLista = z
  .array(esquemaPrecostoResumen)
  .describe('Versiones de precosto de un desarrollo (más nuevo primero).');

/** Forma del historial de precostos. */
export type PrecostosDesarrolloLista = z.infer<typeof esquemaPrecostosDesarrolloLista>;
