import { z } from 'zod';

/**
 * Esquemas Zod de la ENTRADA DE TELA por FACTURA/REMISIÓN, SIN orden de compra (etapa B1 — Daniel
 * `DECISIONES.md` §Post-F9.9 punto 7: *"permitir las dos vías (con orden de compra y por
 * factura/remisión sin OC), con una cabecera por documento y N partidas (cada una con su color y
 * sus telas al tono)"*; §Post-F9.11 para la reestructura por color). UNA definición de reglas para
 * UI y servidor (alimenta el OpenAPI). Toda la lógica vive en el dominio (A1); aquí sólo las FORMAS.
 *
 * Modelo del documento:
 *  • CABECERA: tipo (factura|remisión) + número del documento del proveedor + proveedor + fecha +
 *    almacén destino + observaciones. Folio propio consecutivo por empresa (A3) que pone el dominio.
 *  • N RENGLONES = N PARTIDAS: cada uno con su color de tela (`idTelaColor`), la cantidad de CUERPO
 *    (admite 0 = compra de solo complemento) y la de COMPLEMENTO (sólo si la tela lo lleva), su
 *    lote del proveedor (texto opcional) y sus PRECIOS. El MISMO tela+color puede repetirse: una
 *    factura con dos lotes del mismo color son DOS renglones = DOS partidas (A2/§Post-F9.11 p.4).
 *  • CICLO: se captura en `borrador` (no toca inventario, se puede editar y adjuntarle el PDF) →
 *    `confirmada` (crea las partidas + el movimiento de kardex, D3) → `cancelada` (si estaba
 *    confirmada, con su movimiento INVERSO auditado; nunca se edita ni se borra).
 *
 * PRECIOS (D1): `precioUnit` (cuerpo) es el que viaja al kardex como `costoUnit`;
 * `precioUnitComplemento` se captura aparte (*"el cardigan es otro precio que la tela"*) y vive en
 * el documento — el renglón de kardex sólo tiene UNA columna de costo y valúa `costoUnit × cuerpo`.
 */

const idPositivo = (campo: string) =>
  z
    .number({ error: `El id de ${campo} es obligatorio` })
    .int({ error: `El id de ${campo} debe ser entero` })
    .positive({ error: `El id de ${campo} debe ser positivo` });

const idPositivoOpcionalCoerce = z.coerce.number().int().positive().optional();

/** Tipo del documento del proveedor que ampara la entrada. */
export const esquemaTipoDocumentoEntradaTela = z
  .enum(['factura', 'remision'])
  .describe('Documento del proveedor: factura o remisión.');

/** Tipo de documento de una entrada de tela. */
export type TipoDocumentoEntradaTela = z.infer<typeof esquemaTipoDocumentoEntradaTela>;

/** Estado del documento de entrada de tela. */
export const esquemaEstatusEntradaTela = z
  .enum(['borrador', 'confirmada', 'cancelada'])
  .describe('Estado del documento: borrador (no toca inventario), confirmada o cancelada.');

/** Estado de una entrada de tela. */
export type EstatusEntradaTela = z.infer<typeof esquemaEstatusEntradaTela>;

// ── Captura ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Un RENGLÓN (= una PARTIDA) del documento: color + ambas cantidades juntas + lote del proveedor +
 * precios. Al menos una de las dos cantidades debe ser mayor que 0 (cuerpo y complemento viajan
 * JUNTOS: comprar sólo cardigan = cuerpo en 0). El dominio rechaza cantidad de complemento en una
 * tela que no lo lleva.
 */
export const esquemaEntradaTelaLineaEntrada = z
  .object({
    idTelaColor: idPositivo('el color de tela'),
    cantidad: z
      .number({ error: 'La cantidad de cuerpo es obligatoria (puede ser 0)' })
      .nonnegative({ error: 'La cantidad de cuerpo no puede ser negativa' })
      .describe('Cantidad del CUERPO (admite 0 si el renglón es de solo complemento).'),
    cantidadComplemento: z
      .number()
      .nonnegative({ error: 'La cantidad de complemento no puede ser negativa' })
      .optional()
      .describe('Cantidad del COMPLEMENTO (sólo telas que lo llevan).'),
    precioUnit: z
      .number()
      .nonnegative({ error: 'El precio no puede ser negativo' })
      .optional()
      .describe('Precio por unidad del CUERPO (viaja al kardex como costo, D1).'),
    precioUnitComplemento: z
      .number()
      .nonnegative({ error: 'El precio del complemento no puede ser negativo' })
      .optional()
      .describe('Precio por unidad del COMPLEMENTO (vive en el documento).'),
    loteProveedor: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Número de lote del proveedor de esta partida (opcional).'),
    /**
     * Renglón de ORDEN DE COMPRA que surte este renglón (§Post-F9.14). Omitirlo o mandarlo `null` =
     * tela SIN orden de compra, que sigue siendo válido. Al confirmar el documento, los renglones
     * con OC generan la recepción de esa orden y la marcan como recibida.
     */
    idOrdenCompraLinea: z
      .number({ error: 'El renglón de la orden de compra debe ser un número' })
      .int({ error: 'El renglón de la orden de compra debe ser un id entero' })
      .positive({ error: 'El renglón de la orden de compra debe ser un id positivo' })
      .nullable()
      .optional()
      .describe('Renglón de OC que surte este renglón, o null si la tela no viene de una OC.'),
  })
  .refine((l) => l.cantidad > 0 || (l.cantidadComplemento ?? 0) > 0, {
    error: 'Captura cantidad de cuerpo o de complemento (al menos una mayor que 0)',
  })
  .describe('Renglón (= partida) de una entrada de tela por factura/remisión.');

/** Datos validados de un renglón de entrada de tela. */
export type DatosEntradaTelaLineaEntrada = z.infer<typeof esquemaEntradaTelaLineaEntrada>;

/** Campos de la CABECERA del documento (compartidos por el alta y la edición del borrador). */
const camposCabeceraEntradaTela = {
  tipoDocumento: esquemaTipoDocumentoEntradaTela,
  numeroDocumento: z
    .string({ error: 'El número del documento es obligatorio' })
    .trim()
    .min(1, { error: 'Captura el número de la factura o remisión' })
    .max(100)
    .describe('Número del documento tal como lo trae el proveedor.'),
  idProveedor: idPositivo('el proveedor'),
  fecha: z.iso.date({ error: 'La fecha del documento es obligatoria (YYYY-MM-DD)' }),
  idAlmacen: idPositivo('el almacén destino'),
  observaciones: z.string().trim().max(2000).optional(),
} as const;

/**
 * Alta de un documento de ENTRADA de tela (nace en `borrador`: NO toca el inventario hasta que se
 * confirma). El folio lo asigna el dominio por secuencia atómica (A3) y la empresa sale de la
 * sesión (A9).
 */
export const esquemaEntradaTelaCrear = z
  .object({
    ...camposCabeceraEntradaTela,
    lineas: z
      .array(esquemaEntradaTelaLineaEntrada)
      .min(1, { error: 'Captura al menos un renglón de tela y color' }),
  })
  .describe('Alta de una entrada de tela por factura/remisión (sin orden de compra).');

/** Datos validados de alta de entrada de tela. */
export type DatosEntradaTelaCrear = z.infer<typeof esquemaEntradaTelaCrear>;

/**
 * Edición de un documento de entrada de tela EN BORRADOR (una confirmada ya no se edita, D3): el
 * cuerpo REEMPLAZA cabecera y renglones completos.
 */
export const esquemaEntradaTelaActualizar = esquemaEntradaTelaCrear.describe(
  'Edición de una entrada de tela en borrador (reemplaza cabecera y renglones).',
);

/** Datos validados de edición de entrada de tela. */
export type DatosEntradaTelaActualizar = z.infer<typeof esquemaEntradaTelaActualizar>;

/** Cuerpo de la CANCELACIÓN de una entrada de tela: el motivo es obligatorio (A7). */
export const esquemaEntradaTelaCancelarCuerpo = z
  .object({
    motivo: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(3, { error: 'Explica el motivo (mínimo 3 caracteres)' })
      .max(500),
  })
  .describe('Motivo de la cancelación de la entrada de tela.');

/** Datos validados de la cancelación. */
export type DatosEntradaTelaCancelar = z.infer<typeof esquemaEntradaTelaCancelarCuerpo>;

// ── Salida ───────────────────────────────────────────────────────────────────────────────────────

/** Un renglón del documento tal como lo devuelve la API (con nombres y la traza a su partida). */
export const esquemaEntradaTelaLineaSalida = z
  .object({
    id: z.number().int(),
    idTela: z.number().int(),
    tela: z.string().describe('Nombre de la tela.'),
    idTelaColor: z.number().int(),
    telaColor: z.string().describe('Nombre del color de la tela.'),
    pantone: z.string().nullable(),
    unidadMedida: z.enum(['KG', 'M']).describe('Unidad de compra/consumo de la tela.'),
    nombreCuerpo: z.string().nullable().describe('Nombre del componente cuerpo o null.'),
    nombreComplemento: z
      .string()
      .nullable()
      .describe('Nombre del complemento; null = la tela NO lleva complemento.'),
    cantidad: z.number().describe('Cantidad del CUERPO.'),
    cantidadComplemento: z.number().nullable().describe('Cantidad del COMPLEMENTO o null.'),
    precioUnit: z.number().nullable().describe('Precio por unidad del cuerpo o null.'),
    precioUnitComplemento: z.number().nullable().describe('Precio del complemento o null.'),
    importe: z
      .number()
      .nullable()
      .describe('Importe del renglón (cuerpo × precio + complemento × precio) o null.'),
    loteProveedor: z.string().nullable(),
    idPartida: z.number().int().nullable().describe('Partida creada al confirmar, o null.'),
    partidaFolio: z.number().int().nullable().describe('Folio de la partida, o null.'),
    idOrdenCompraLinea: z
      .number()
      .int()
      .nullable()
      .describe('Renglón de OC que surte este renglón (§Post-F9.14), o null si es tela suelta.'),
    numCompra: z
      .number()
      .int()
      .nullable()
      .describe('Folio de la orden de compra surtida (para pintarlo sin otra consulta), o null.'),
  })
  .describe('Renglón (partida) de una entrada de tela.');

/** Forma de un renglón de entrada de tela en la API. */
export type EntradaTelaLineaSalida = z.infer<typeof esquemaEntradaTelaLineaSalida>;

/** Un documento de entrada de tela (encabezado + renglones) tal como lo devuelve la API. */
export const esquemaEntradaTelaSalida = z
  .object({
    id: z.number().int(),
    folio: z.number().int().describe('Folio consecutivo por empresa (A3).'),
    idEmpresa: z.number().int(),
    tipoDocumento: esquemaTipoDocumentoEntradaTela,
    numeroDocumento: z.string(),
    idProveedor: z.number().int(),
    proveedor: z.string().describe('Nombre del proveedor.'),
    fecha: z.string().describe('Fecha del documento (YYYY-MM-DD).'),
    idAlmacen: z.number().int(),
    almacen: z.string(),
    observaciones: z.string().nullable(),
    estatus: esquemaEstatusEntradaTela,
    idMovimiento: z.number().int().nullable().describe('Movimiento de kardex generado, o null.'),
    folioMovimiento: z.number().int().nullable().describe('Folio del movimiento, o null.'),
    confirmadaEn: z.iso.datetime().nullable(),
    confirmadaPorId: z.string().nullable(),
    canceladaEn: z.iso.datetime().nullable(),
    canceladaPorId: z.string().nullable(),
    motivoCancelacion: z.string().nullable(),
    lineas: z.array(esquemaEntradaTelaLineaSalida),
    totalCuerpo: z.number().describe('Σ de las cantidades de cuerpo (derivada).'),
    totalComplemento: z.number().describe('Σ de las cantidades de complemento (derivada).'),
    totalImporte: z.number().nullable().describe('Σ de los importes de los renglones, o null.'),
    numeroAdjuntos: z.number().int().describe('Cuántos archivos trae adjuntos el documento.'),
    avisos: z
      .array(z.string())
      .describe(
        'Avisos SUAVES para revisión (no bloquean): hoy, que ya exista otro documento vivo del ' +
          'MISMO proveedor con el MISMO número (posible factura capturada dos veces).',
      ),
    creadoEn: z.iso.datetime(),
    creadoPorId: z.string().nullable(),
  })
  .describe('Documento de entrada de tela por factura/remisión con sus partidas.');

/** Forma de una entrada de tela en la API. */
export type EntradaTelaSalida = z.infer<typeof esquemaEntradaTelaSalida>;

// ── Listado ──────────────────────────────────────────────────────────────────────────────────────

/** Filtros, orden y paginación del listado de entradas de tela (querystring). */
export const esquemaEntradasTelaQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página.'),
    busqueda: z
      .string()
      .trim()
      .max(150)
      .optional()
      .describe('Busca por folio, número de documento o nombre del proveedor.'),
    estatus: esquemaEstatusEntradaTela.optional().describe('Filtra por estado del documento.'),
    tipoDocumento: esquemaTipoDocumentoEntradaTela
      .optional()
      .describe('Filtra por factura/remisión.'),
    idProveedor: idPositivoOpcionalCoerce.describe('Filtra por proveedor.'),
    idAlmacen: idPositivoOpcionalCoerce.describe('Filtra por almacén destino.'),
    fechaDesde: z.iso.date().optional().describe('Filtra por fecha ≥ (YYYY-MM-DD).'),
    fechaHasta: z.iso.date().optional().describe('Filtra por fecha ≤ (YYYY-MM-DD).'),
    ordenarPor: z
      .enum(['folio', 'fecha', 'creadoEn'])
      .default('folio')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('desc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de entradas de tela.');

/** Parámetros del listado ya coaccionados desde la URL. */
export type EntradasTelaQuery = z.infer<typeof esquemaEntradasTelaQuery>;

/** Respuesta paginada del listado de entradas de tela (forma estándar `Pagina<T>`). */
export const esquemaEntradasTelaPagina = z
  .object({
    datos: z.array(esquemaEntradaTelaSalida).describe('Entradas de la página.'),
    total: z.number().int().describe('Total de entradas que cumplen el filtro.'),
    pagina: z.number().int(),
    porPagina: z.number().int(),
    totalPaginas: z.number().int(),
  })
  .describe('Página de entradas de tela por factura/remisión.');

/** Forma de la respuesta paginada de entradas de tela. */
export type EntradasTelaPagina = z.infer<typeof esquemaEntradasTelaPagina>;

/** Parámetro de ruta `:id` del documento de entrada de tela. */
export const esquemaParamIdEntradaTela = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int()
    .positive()
    .describe('Id del documento de entrada de tela.'),
});

// ── Adjuntos (el PDF de la factura/remisión) ─────────────────────────────────────────────────────

/**
 * Solicitud de subida de un adjunto de la entrada (el PDF de la factura): el navegador manda los
 * metadatos y el backend devuelve la URL PUT prefirmada (flujo presigned de F0). Espejo del adjunto
 * de orden/pedido.
 */
export const esquemaEntradaTelaAdjuntoCrear = z
  .object({
    nombreOriginal: z
      .string({ error: 'El nombre del archivo es obligatorio' })
      .trim()
      .min(1, { error: 'El nombre del archivo es obligatorio' })
      .max(255)
      .describe('Nombre del archivo tal como lo llama el usuario.'),
    tipoMime: z
      .string({ error: 'El tipo de archivo es obligatorio' })
      .trim()
      .regex(/^[\w.+-]+\/[\w.+-]+$/, { error: 'Tipo de archivo (MIME) inválido' })
      .describe('Tipo MIME del archivo (ej. application/pdf).'),
    tamanoBytes: z
      .number({ error: 'El tamaño es obligatorio' })
      .int({ error: 'El tamaño debe ser un entero de bytes' })
      .positive({ error: 'El archivo está vacío' })
      .describe('Tamaño exacto en bytes (la URL prefirmada sólo acepta este tamaño).'),
  })
  .describe('Datos para preparar la subida de un adjunto de una entrada de tela.');

/** Datos validados de alta de adjunto de entrada de tela. */
export type DatosEntradaTelaAdjuntoCrear = z.infer<typeof esquemaEntradaTelaAdjuntoCrear>;

/** Salida tras solicitar la subida: registro + URL PUT prefirmada para R2. */
export const esquemaEntradaTelaAdjuntoSubida = z
  .object({
    idArchivo: z.string().describe('Id del registro Archivo creado.'),
    nombreOriginal: z.string(),
    urlSubida: z.string().describe('URL PUT prefirmada: el navegador sube directo a R2.'),
    expiraEnSegundos: z.number().int().describe('Vigencia de la URL de subida (segundos).'),
  })
  .describe('Resultado de preparar la subida de un adjunto de entrada de tela.');

/** Forma de la respuesta al preparar la subida. */
export type EntradaTelaAdjuntoSubida = z.infer<typeof esquemaEntradaTelaAdjuntoSubida>;

/** Un adjunto ya registrado, con su URL GET prefirmada. */
export const esquemaEntradaTelaAdjuntoSalida = z
  .object({
    idArchivo: z.string(),
    nombreOriginal: z.string(),
    tipoMime: z.string(),
    tamanoBytes: z.number().int(),
    urlDescarga: z.string().describe('URL GET prefirmada para ver/descargar el archivo.'),
    subidoPorId: z.string().nullable(),
    creadoEn: z.iso.datetime(),
  })
  .describe('Adjunto de una entrada de tela con su URL de descarga.');

/** Forma de un adjunto de entrada de tela en la API. */
export type EntradaTelaAdjuntoSalida = z.infer<typeof esquemaEntradaTelaAdjuntoSalida>;

/** Lista de adjuntos de una entrada de tela. */
export const esquemaEntradaTelaAdjuntosLista = z
  .object({ datos: z.array(esquemaEntradaTelaAdjuntoSalida) })
  .describe('Adjuntos de una entrada de tela.');

/** Forma de la lista de adjuntos. */
export type EntradaTelaAdjuntosLista = z.infer<typeof esquemaEntradaTelaAdjuntosLista>;
