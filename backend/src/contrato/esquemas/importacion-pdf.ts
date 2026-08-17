import { z } from 'zod';

import { esquemaPorcentajeAdicional } from './importacion-pedido.js';

/**
 * Contrato Zod del IMPORTADOR de OC del cliente por PDF (petición Daniel — plantilla C&A). El flujo que
 * definió Daniel: el usuario sube VARIOS PDFs de órdenes de compra de C&A a la vez → el sistema los
 * parsea (extractor en código, por anclas de etiqueta) y muestra una VISTA PREVIA (un renglón por PDF)
 * → al confirmar nace UN pedido interno donde cada PDF = 1 renglón + 1 OP (con su matriz color×talla) y
 * cada PDF queda ADJUNTO a SU orden. El "Modelo ID" de C&A NO es nuestro modelo: se liga a mano la
 * primera vez y el sistema APRENDE la liga (`ClienteModeloLiga`). Toda la lógica vive en el dominio
 * (A1); aquí sólo las FORMAS. Cada PDF viaja como base64 en JSON (son chicos: ~200 KB).
 *
 * SIN permisos nuevos: analizar/confirmar → `pedidos.administrar` (+ `ordenes.administrar` en el confirm,
 * el mismo gate que Generar OP). Los importes (costo/monto) van gated por `pedidos.importes`.
 */

// ── Archivo del cliente (base64) ─────────────────────────────────────────────

/** Un PDF del cliente (nombre + contenido base64). El tope real (10 MB decodificados) lo valida el dominio. */
export const esquemaArchivoPdf = z
  .object({
    nombreArchivo: z
      .string({ error: 'El nombre del archivo es obligatorio' })
      .trim()
      .min(1, { error: 'El nombre del archivo es obligatorio' })
      .max(255)
      .describe('Nombre del PDF del cliente (para mostrar y adjuntar).'),
    archivoBase64: z
      .string({ error: 'El contenido del archivo es obligatorio' })
      .min(1, { error: 'El contenido del archivo es obligatorio' })
      .max(14 * 1024 * 1024, { error: 'El PDF es demasiado grande (máx. 10 MB)' })
      .describe('Contenido del PDF en base64 (acepta prefijo data: URL).'),
  })
  .describe('Un PDF de orden de compra del cliente.');

/** Un PDF validado. */
export type ArchivoPdf = z.infer<typeof esquemaArchivoPdf>;

/** Un ajuste MANUAL de la matriz de una talla en la vista previa (el total EDITADO por el usuario). */
export const esquemaAjusteTallaPdf = z
  .object({
    talla: z.string().trim().min(1).describe('Etiqueta de la talla ajustada.'),
    cantidad: z
      .number()
      .int()
      .min(0, { error: 'La cantidad no puede ser negativa' })
      .describe('Total EDITADO a fabricar de esa talla (reemplaza la propuesta).'),
  })
  .describe('Ajuste manual del total a fabricar de una talla.');

/**
 * Un RENGLÓN-PACK de la matriz de la OP: su letra (A/B/C…, la del PDF) y su corrida editada. Las OCs de
 * C&A traen UN renglón POR PACK (convención `{color} {letra}`); por eso la matriz es una lista de packs,
 * no un total sumado. `letra` null/vacía = un solo pack (color SIN sufijo, como los pedidos históricos de
 * un solo pack). Un renglón cuyas tallas queden todas en 0 no genera línea (así se "integra" un pack en
 * otro: el usuario mueve los números entre renglones).
 */
export const esquemaRenglonMatrizPdf = z
  .object({
    letra: z
      .string()
      .trim()
      .max(8)
      .nullable()
      .describe(
        'Letra del pack que sufija el color (A/B/C…); null/vacía = un solo pack sin sufijo.',
      ),
    tallas: z
      .array(esquemaAjusteTallaPdf)
      .describe('Corrida EDITADA de ese pack (total por talla).'),
  })
  .describe('Un renglón-pack de la matriz de la OP (su letra + su corrida).');

/** Forma de un renglón-pack de la matriz. */
export type RenglonMatrizPdf = z.infer<typeof esquemaRenglonMatrizPdf>;

/**
 * Un PDF al CONFIRMAR: el PDF + (opcional) la matriz EDITADA en la vista previa y el pantone. Si `matriz`
 * viene, la OP se fabrica con ESOS renglones-pack (Daniel: el sistema propone el sobre-pedido por packs,
 * el usuario decide celda por celda y renglón por renglón); si se omite, se usa la propuesta calculada.
 * `pantone` PREFILLEA/edita el pantone del color de la OP (vacío = sin pantone).
 */
export const esquemaArchivoPdfConfirmar = esquemaArchivoPdf
  .extend({
    matriz: z
      .array(esquemaRenglonMatrizPdf)
      .optional()
      .describe(
        'Matriz EDITADA como renglones-pack ({letra, corrida por talla}) que reemplaza la propuesta; si se omite, se propone por packs.',
      ),
    pantone: z
      .string()
      .trim()
      .max(60)
      .optional()
      .describe('Código PANTONE del color de la OP (editado/prefilleado); vacío = sin pantone.'),
  })
  .describe('Un PDF con su ajuste manual opcional al confirmar.');

/** Forma de un PDF de confirmación. */
export type ArchivoPdfConfirmar = z.infer<typeof esquemaArchivoPdfConfirmar>;

/** Cuántos PDFs se aceptan por importación (un pedido con muchas OCs; bound de memoria/parseo). */
export const MAX_ARCHIVOS_PDF = 40;

/** Lista de PDFs (al menos uno, tope `MAX_ARCHIVOS_PDF`) para ANALIZAR. */
const campoArchivosPdf = z
  .array(esquemaArchivoPdf)
  .min(1, { error: 'Sube al menos un PDF del cliente' })
  .max(MAX_ARCHIVOS_PDF, {
    error: `No se pueden importar más de ${MAX_ARCHIVOS_PDF} PDFs a la vez`,
  })
  .describe('PDFs de las órdenes de compra del cliente.');

/** Lista de PDFs para CONFIRMAR (cada uno con su ajuste manual opcional). */
const campoArchivosPdfConfirmar = z
  .array(esquemaArchivoPdfConfirmar)
  .min(1, { error: 'Sube al menos un PDF del cliente' })
  .max(MAX_ARCHIVOS_PDF, {
    error: `No se pueden importar más de ${MAX_ARCHIVOS_PDF} PDFs a la vez`,
  })
  .describe('PDFs de las órdenes de compra del cliente (con ajuste manual opcional).');

// ── Analizar / vista previa ──────────────────────────────────────────────────

/** Cuerpo de `POST /pedidos/importacion-pdf/analizar`: el cliente + los PDFs. Solo LEE (no escribe). */
export const esquemaAnalizarPdfCyaCuerpo = z
  .object({
    idCliente: z
      .number({ error: 'El cliente es obligatorio' })
      .int()
      .positive()
      .describe('Cliente del pedido.'),
    archivos: campoArchivosPdf,
    porcentajeAdicional: esquemaPorcentajeAdicional
      .optional()
      .describe(
        '% adicional para la vista previa; si se omite, se usa el de la plantilla del cliente.',
      ),
  })
  .describe('Analiza los PDFs de C&A y arma la vista previa (un renglón por PDF).');

/** Datos validados de analizar. */
export type DatosAnalizarPdfCya = z.infer<typeof esquemaAnalizarPdfCyaCuerpo>;

/** Una talla del PDF: lo que pidió el cliente y la PROPUESTA a fabricar (sobre-pedido por packs). */
export const esquemaTallaPdfCya = z
  .object({
    talla: z.string().describe('Etiqueta de la talla del PDF (5-6, 6-7, …).'),
    piezas: z.number().int().describe('Piezas que pidió el cliente para esa talla.'),
    piezasFabricar: z
      .number()
      .int()
      .describe('Propuesta a fabricar de esa talla (suma de la propuesta de todos los packs/SKU).'),
  })
  .describe(
    'Talla del PDF: pedidas por el cliente y propuestas a fabricar (sobre-pedido por packs).',
  );

/** Forma de una talla del PDF. */
export type TallaPdfCya = z.infer<typeof esquemaTallaPdfCya>;

/** Una celda del desglose de un grupo de packs: lo original y lo propuesto de esa talla. */
export const esquemaCeldaSobrepedido = z
  .object({
    talla: z.string().describe('Etiqueta de la talla.'),
    original: z.number().int().describe('Piezas de esa talla en el grupo (original del cliente).'),
    propuesta: z.number().int().describe('Piezas propuestas a fabricar de esa talla en el grupo.'),
  })
  .describe('Celda del desglose de un grupo de packs.');

/** Forma de una celda de desglose. */
export type CeldaSobrepedido = z.infer<typeof esquemaCeldaSobrepedido>;

/**
 * La propuesta de sobre-pedido de UN grupo de la sección "Detalles PACK / SKU": los packs originales y
 * los propuestos (round(totalPacks × (1+%/100)) en los PACK) y su desglose por talla. Informativo para
 * la vista previa (el usuario ve de dónde sale la propuesta: "Pack A ×127", "Pack B ×61", "SKU +7%").
 */
export const esquemaGrupoSobrepedido = z
  .object({
    grupo: z.string().describe('Letra del grupo (A, B, C…).'),
    tipo: z.string().describe('"PACK" (proporción por pack) o "SKU" (piezas sueltas).'),
    packsOriginales: z.number().int().describe('Total de packs del grupo en la OC.'),
    packsPropuestos: z
      .number()
      .int()
      .describe('Packs propuestos = round(packsOriginales × (1+%/100)) en los PACK.'),
    desglose: z.array(esquemaCeldaSobrepedido).describe('Desglose por talla del grupo.'),
    advertencia: z
      .string()
      .nullable()
      .describe(
        'Aviso si la proporción del pack no era entera (cayó a redondeo por talla), o null.',
      ),
  })
  .describe('Propuesta de sobre-pedido de un grupo de packs.');

/** Forma de un grupo de sobre-pedido. */
export type GrupoSobrepedido = z.infer<typeof esquemaGrupoSobrepedido>;

/** Una advertencia de validación de un renglón (NO bloquea; el usuario decide). */
export const esquemaAdvertenciaPdf = z
  .object({
    tipo: z
      .enum([
        'suma-tallas',
        'suma-monto',
        'sin-tallas',
        'parseo',
        'liga-inactiva',
        'sobrepedido',
        'duplicado',
      ])
      .describe(
        'Qué validación falló (incluye "liga-inactiva", "sobrepedido": packs que no cuadran / proporción no entera, y "duplicado": esa OC del cliente ya se importó).',
      ),
    mensaje: z.string().describe('Mensaje legible para la vista previa.'),
  })
  .describe('Advertencia de validación de un renglón (no bloquea).');

/** Forma de una advertencia. */
export type AdvertenciaPdf = z.infer<typeof esquemaAdvertenciaPdf>;

/**
 * La OP que YA nació de esta MISMA OC del cliente (V1-E4 punto 1). Importar dos veces el mismo PDF
 * duplicaba EN SILENCIO pedido + OP + nº de producción + RC + MRP, y se descubría semanas después
 * cortando doble: la vista previa ahora lo señala y el confirm lo omite.
 */
export const esquemaOcYaImportada = z
  .object({
    idOrden: z
      .number()
      .int()
      .describe('Id de la OP que ya existe con ese nº de orden del cliente.'),
    folioOrden: z.number().int().describe('Folio de esa OP (para que el usuario la ubique).'),
  })
  .describe('OP existente con la misma OC del cliente.');

/** Forma de la OP duplicada. */
export type OcYaImportada = z.infer<typeof esquemaOcYaImportada>;

/** Un renglón de la vista previa = un PDF parseado, con su liga sugerida y sus advertencias. */
export const esquemaRenglonPdfPreview = z
  .object({
    nombreArchivo: z.string().describe('Nombre del PDF (para identificar la fila).'),
    /** null si el PDF no se pudo parsear (no es C&A/corrupto); el resto de campos van vacíos y trae `error`. */
    error: z.string().nullable().describe('Mensaje de error si el PDF no se pudo parsear, o null.'),
    numeroOrden: z.string().describe('Nº de orden de compra del cliente (C&A "Numero de Orden").'),
    modeloCliente: z.string().describe('Modelo ID del cliente (C&A "Modelo ID").'),
    descripcionArticulo: z.string().describe('Descripción del artículo del PDF.'),
    division: z.string().describe('División del PDF (→ departamento del cliente).'),
    subDivision: z.string().describe('Sub División del PDF (campo variable; puede venir vacía).'),
    idColorCliente: z.string().describe('ID Color del cliente.'),
    colorGenerico: z.string().describe('Color genérico del PDF (color de la OP).'),
    pantone: z
      .string()
      .describe('Código PANTONE de la OC (vacío si el papel no lo trae; editable).'),
    codigoUnico: z.string().describe('Código único del PDF.'),
    semanaCliente: z.string().describe('Semana C&A del PDF.'),
    costoUnitario: z
      .number()
      .nullable()
      .describe('Costo unitario (FOB) — null sin `pedidos.importes`.'),
    piezasTotales: z.number().int().describe('Piezas totales que pidió el cliente (del PDF).'),
    piezasFabricar: z
      .number()
      .int()
      .describe(
        'Piezas totales PROPUESTAS a fabricar (Σ del sobre-pedido por packs con el % adicional).',
      ),
    montoTotal: z
      .number()
      .nullable()
      .describe('Monto total de la OC — null sin `pedidos.importes`.'),
    fechaEntrega: z
      .string()
      .nullable()
      .describe('Inicio de la ventana "Entrega en DC" (YYYY-MM-DD).'),
    tallas: z
      .array(esquemaTallaPdfCya)
      .describe(
        'Matriz de tallas del PDF (color único × tallas): pedidas y propuestas a fabricar.',
      ),
    grupos: z
      .array(esquemaGrupoSobrepedido)
      .describe(
        'Grupos de la sección "Detalles PACK / SKU" con su propuesta de sobre-pedido (de dónde sale la matriz propuesta). Vacío si el PDF no trae packs.',
      ),
    idModeloSugerido: z
      .number()
      .int()
      .nullable()
      .describe('Modelo NUESTRO sugerido por la liga aprendida (o null si es la primera vez).'),
    codigoModeloSugerido: z.string().nullable().describe('Código del modelo sugerido, o null.'),
    descripcionModeloSugerido: z
      .string()
      .nullable()
      .describe('Descripción del modelo sugerido, o null.'),
    colorNuevo: z
      .boolean()
      .describe('true si el color no existe en el catálogo (se creará al confirmar).'),
    tallasNuevas: z
      .array(z.string())
      .describe('Tallas del PDF que no existen en el catálogo (se crearán al confirmar).'),
    advertencias: z
      .array(esquemaAdvertenciaPdf)
      .describe('Advertencias de validación (no bloquean).'),
    yaImportado: esquemaOcYaImportada
      .nullable()
      .describe(
        'La OP que YA nació de esta MISMA OC del cliente (nº de orden), o null si es la primera vez. Cuando viene, el PDF NO se importa al confirmar: se devuelve en `noReconocidos` (defensa V1-E4 contra la doble importación).',
      ),
  })
  .describe('Un PDF parseado en la vista previa.');

/** Forma de un renglón de la vista previa. */
export type RenglonPdfPreview = z.infer<typeof esquemaRenglonPdfPreview>;

/** Respuesta de analizar: la plantilla vigente + un renglón por PDF + totales. */
export const esquemaAnalizarPdfCyaSalida = z
  .object({
    renglones: z.array(esquemaRenglonPdfPreview).describe('Un renglón por PDF subido.'),
    totalPiezas: z.number().int().describe('Suma de piezas PEDIDAS por el cliente (PDFs válidos).'),
    totalPiezasFabricar: z
      .number()
      .int()
      .describe(
        'Suma de piezas PROPUESTAS a fabricar (sobre-pedido por packs) de todos los PDFs válidos.',
      ),
    porcentajeAdicional: z
      .number()
      .describe('% adicional aplicado a la vista previa (de la plantilla o del override).'),
    totalReconocidos: z
      .number()
      .int()
      .describe('Cuántos PDFs tienen una liga de modelo sugerida (aprendida).'),
  })
  .describe('Vista previa de la importación por PDF.');

/** Forma de la respuesta de analizar. */
export type AnalizarPdfCyaSalida = z.infer<typeof esquemaAnalizarPdfCyaSalida>;

// ── Confirmar la importación ──────────────────────────────────────────────────

/** Liga RESUELTA de un modelo del cliente a NUESTRO modelo (aprendida o elegida a mano en la preview). */
export const esquemaLigaModeloPdf = z
  .object({
    modeloCliente: z
      .string({ error: 'El modelo del cliente es obligatorio' })
      .trim()
      .min(1)
      .describe('Modelo ID del cliente tal como viene en el PDF.'),
    idModelo: z
      .number({ error: 'El modelo es obligatorio' })
      .int()
      .positive()
      .describe('Modelo NUESTRO al que se liga.'),
  })
  .describe('Liga modelo-del-cliente → nuestro modelo.');

/** Datos validados de una liga. */
export type DatosLigaModeloPdf = z.infer<typeof esquemaLigaModeloPdf>;

/**
 * Cuerpo de `POST /pedidos/importacion-pdf/confirmar`: el cliente + los PDFs + las ligas resueltas
 * (modelo del cliente → nuestro modelo). Crea el pedido interno + una OP por PDF (con su matriz + su RC
 * + su adjunto) + aprende las ligas, en UNA transacción. Los PDFs cuyo modelo del cliente NO se resolvió
 * (ni aprendido ni en `ligas`) se OMITEN y se devuelven en `noReconocidos`.
 */
export const esquemaConfirmarPdfCyaCuerpo = z
  .object({
    idCliente: z
      .number({ error: 'El cliente es obligatorio' })
      .int()
      .positive()
      .describe('Cliente del pedido (empresa activa de la sesión, A9).'),
    referenciaGeneral: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .optional()
      .describe('Referencia general del pedido (opcional; cada OP guarda su propio nº de orden).'),
    archivos: campoArchivosPdfConfirmar,
    ligas: z
      .array(esquemaLigaModeloPdf)
      .default([])
      .describe('Ligas modelo-del-cliente → nuestro modelo (aprendidas o elegidas a mano).'),
    porcentajeAdicional: esquemaPorcentajeAdicional
      .optional()
      .describe(
        '% adicional de producción a aplicar en la matriz; si se omite, se usa el de la plantilla del cliente. Se RECUERDA en la plantilla.',
      ),
  })
  .describe('Confirma la importación por PDF: crea pedido interno + OPs + RC + adjuntos.');

/** Datos validados de confirmar. */
export type DatosConfirmarPdfCya = z.infer<typeof esquemaConfirmarPdfCyaCuerpo>;

/** Una OP nacida de un PDF. */
export const esquemaOrdenPdfImportada = z
  .object({
    idOrden: z.number().int().describe('Id de la OP creada.'),
    folio: z.number().int().describe('Folio de la OP (por empresa).'),
    numeroProduccion: z.number().int().describe('Nº interno de producción minteado/reusado.'),
    codigoModelo: z.string().describe('Nº de desarrollo de NUESTRO modelo.'),
    modeloCliente: z.string().describe('Modelo ID del cliente (del PDF).'),
    numeroOrden: z.string().describe('Nº de orden de compra del cliente (del PDF).'),
    nombreArchivo: z.string().describe('Nombre del PDF de origen (adjunto a esta OP).'),
    totalPiezas: z.number().int().describe('Piezas de la OP (Σ de la matriz).'),
    adjuntado: z.boolean().describe('true si el PDF se adjuntó a la OP.'),
  })
  .describe('Una OP creada por la importación de un PDF.');

/** Forma de una OP importada. */
export type OrdenPdfImportada = z.infer<typeof esquemaOrdenPdfImportada>;

/** Un PDF que quedó FUERA (su modelo del cliente no se ligó). */
export const esquemaPdfNoReconocido = z
  .object({
    nombreArchivo: z.string().describe('Nombre del PDF que no se importó.'),
    modeloCliente: z.string().describe('Modelo ID del cliente sin ligar.'),
    motivo: z.string().describe('Por qué quedó fuera (sin liga / error de parseo).'),
  })
  .describe('Un PDF que no se importó.');

/** Forma de un PDF no reconocido. */
export type PdfNoReconocido = z.infer<typeof esquemaPdfNoReconocido>;

/** Respuesta de confirmar: el pedido nacido + las OPs + los PDFs que quedaron fuera. */
export const esquemaConfirmarPdfCyaSalida = z
  .object({
    idPedido: z.number().int().describe('Id del pedido interno creado.'),
    folioPedido: z.number().int().describe('Folio del pedido (por empresa).'),
    ordenes: z.array(esquemaOrdenPdfImportada).describe('OPs creadas (una por PDF ligado).'),
    noReconocidos: z.array(esquemaPdfNoReconocido).describe('PDFs que quedaron sin importar.'),
    ligasAprendidas: z
      .number()
      .int()
      .describe('Cuántas ligas modelo-del-cliente se aprendieron/actualizaron.'),
  })
  .describe('Resultado de la importación por PDF (pedido + OPs + no reconocidos).');

/** Forma de la respuesta de confirmar. */
export type ConfirmarPdfCyaSalida = z.infer<typeof esquemaConfirmarPdfCyaSalida>;
