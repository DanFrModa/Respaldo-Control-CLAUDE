/**
 * CONTRATO del **COTEJO DE LA FACTURA CONTRA LO QUE EMITIMOS** (fila 0.117) — §Post-F9.232.
 *
 * Daniel revisaba a mano la factura de cada maquilero contra lo que le había mandado. El sistema
 * tenía las dos mitades sin unir: importa los CFDI (F9-E3) y emite el documento con el que el
 * proveedor debe facturar (fila 0.118). Esto es la unión, con sus cuatro decisiones:
 *
 *  (a) **contra el documento que FR Moda emite**, no contra los recibos sueltos;
 *  (b) tolerancia de **UN PESO FIJO, sin porcentaje** (`dominio/pagos/cotejo-tolerancia.ts`);
 *  (c) la que no cuadra **entra marcada y en ROJO** y no se puede pagar hasta que alguien la
 *      **atienda** — no se rechaza;
 *  (d) **«como venga»**: una factura puede cubrir varios documentos y varias facturas uno solo, por
 *      eso lo que viaja es una LISTA de aplicaciones y no un único id.
 *
 * UNA sola definición para servidor y UI (alimenta el OpenAPI). Permisos: leer con `cxp.ver`,
 * aplicar/atender con `cxp.administrar` (SIN permiso nuevo, §Post-F9.190).
 */
import { z } from 'zod';

// ── El veredicto ────────────────────────────────────────────────────────────────────────────────

/** Veredicto MECÁNICO del cotejo de una factura. */
export const ESTADOS_COTEJO = ['cuadra', 'descuadre'] as const;
/** Clave de un veredicto. */
export type EstadoCotejoClave = (typeof ESTADOS_COTEJO)[number];

/** Cómo se llama cada veredicto en la pantalla. */
export const ETIQUETAS_ESTADO_COTEJO: Record<EstadoCotejoClave, string> = {
  cuadra: 'Cuadra',
  descuadre: 'No cuadra',
};

/** Qué facturas pide la bandeja. */
export const FILTROS_COTEJO = ['pendientes', 'todas'] as const;
/** Clave de un filtro. */
export type FiltroCotejoClave = (typeof FILTROS_COTEJO)[number];

// ── Un documento emitido, como candidato a cubrir ───────────────────────────────────────────────

/**
 * Un DOCUMENTO que FR Moda le emitió a este proveedor: lo que se le mandó a facturar. `disponible`
 * es lo que todavía no cubre ninguna factura (`total − Σ aplicado`), y es lo que la pantalla ofrece.
 */
export const esquemaDocumentoEmitido = z
  .object({
    idRenglon: z.number().int().describe('Id del renglón de corrida (el documento).'),
    folioDocumento: z.number().int().describe('Folio propio del documento.'),
    folioCorrida: z.number().int().describe('Folio de la corrida de la que salió.'),
    semana: z.string().describe('Lunes de la semana pagada (YYYY-MM-DD).'),
    concepto: z.string().describe('Qué se le pagó (la explicación del renglón).'),
    total: z
      .number()
      .nullable()
      .describe('Total CON IVA del documento. `null` sin `consultas.ver-importes`.'),
    aplicado: z
      .number()
      .nullable()
      .describe('Lo que ya cubren facturas (de ésta y de otras). `null` sin ver importes.'),
    disponible: z
      .number()
      .nullable()
      .describe('Lo que queda por cubrir (`total − aplicado`). `null` sin ver importes.'),
  })
  .describe('Un documento para facturar emitido a este proveedor.');

/** Un documento emitido. */
export type DocumentoEmitido = z.infer<typeof esquemaDocumentoEmitido>;

/** La lista de documentos emitidos a un proveedor. */
export const esquemaDocumentosEmitidosSalida = z
  .object({ documentos: z.array(esquemaDocumentoEmitido) })
  .describe('Documentos emitidos a un proveedor, con lo que les falta por cubrir.');

/** Salida de la lista de documentos emitidos. */
export type DocumentosEmitidosSalida = z.infer<typeof esquemaDocumentosEmitidosSalida>;

// ── Una factura en la bandeja del cotejo ────────────────────────────────────────────────────────

/** Lo que una factura cubre de UN documento, ya guardado. */
export const esquemaAplicacionCotejo = z
  .object({
    idRenglon: z.number().int().describe('Documento cubierto.'),
    folioDocumento: z.number().int().nullable().describe('Folio del documento cubierto.'),
    semana: z.string().describe('Semana del documento (YYYY-MM-DD).'),
    importe: z
      .number()
      .nullable()
      .describe('Lo que esta factura cubre de él. `null` sin importes.'),
  })
  .describe('Una aplicación de la factura a un documento emitido.');

/** Una aplicación guardada. */
export type AplicacionCotejo = z.infer<typeof esquemaAplicacionCotejo>;

/** Una factura sujeta a cotejo, con su veredicto y sus ligas. */
export const esquemaFacturaCotejo = z
  .object({
    idMovimiento: z.number().int().describe('Id del movimiento de CxP (la factura).'),
    folio: z.number().int().describe('Folio del movimiento (por empresa).'),
    fecha: z.string().describe('Fecha de la factura (YYYY-MM-DD).'),
    idProveedor: z.number().int().describe('Proveedor que factura.'),
    proveedor: z.string().describe('Nombre del proveedor.'),
    uuidCfdi: z.string().nullable().describe('UUID del CFDI, si lo trae.'),
    total: z
      .number()
      .nullable()
      .describe('Total CON IVA de la factura (positivo). `null` sin `consultas.ver-importes`.'),
    aplicado: z
      .number()
      .nullable()
      .describe('Suma de lo aplicado a documentos. `null` sin importes.'),
    diferencia: z
      .number()
      .nullable()
      .describe('|total − aplicado|, ya redondeada. `null` sin importes.'),
    estado: z.enum(ESTADOS_COTEJO).describe('Veredicto mecánico.'),
    atendida: z.boolean().describe('¿Alguien ya se hizo cargo del descuadre?'),
    atendidaEn: z.string().nullable().describe('Cuándo se atendió (ISO) o null.'),
    atendidaPor: z.string().nullable().describe('Quién la atendió, o null.'),
    nota: z.string().nullable().describe('La explicación con la que se atendió, o null.'),
    frenaElPago: z
      .boolean()
      .describe('En rojo y sin atender: mientras esté así, a ese proveedor no se le ejecuta.'),
    aplicaciones: z.array(esquemaAplicacionCotejo).describe('Los documentos que dice cubrir.'),
  })
  .describe('Una factura de proveedor cotejada contra los documentos emitidos.');

/** Una factura de la bandeja. */
export type FacturaCotejo = z.infer<typeof esquemaFacturaCotejo>;

/** La bandeja del cotejo. */
export const esquemaBandejaCotejoSalida = z
  .object({
    facturas: z.array(esquemaFacturaCotejo),
    enRojo: z.number().int().describe('Cuántas frenan un pago ahora mismo (conteo, no importe).'),
    toleranciaPesos: z
      .number()
      .describe(
        'La tolerancia vigente, en pesos. Viaja para que la pantalla la explique sin copiarla.',
      ),
  })
  .describe('Bandeja del cotejo de facturas contra documentos emitidos.');

/** Salida de la bandeja. */
export type BandejaCotejoSalida = z.infer<typeof esquemaBandejaCotejoSalida>;

/** Filtro de la bandeja. */
export const esquemaBandejaCotejoQuery = z
  .object({
    filtro: z
      .enum(FILTROS_COTEJO)
      .default('pendientes')
      .describe(
        '`pendientes` = sólo las que frenan un pago · `todas` = todas las sujetas a cotejo.',
      ),
  })
  .describe('Filtro de la bandeja del cotejo.');

/** Query validada de la bandeja. */
export type BandejaCotejoQuery = z.infer<typeof esquemaBandejaCotejoQuery>;

// ── Aplicar y atender ───────────────────────────────────────────────────────────────────────────

/**
 * Las ligas de una factura, COMPLETAS: lo que llega REEMPLAZA a lo que había (no es un «agregar»).
 * Mandar la lista vacía deja la factura sin ninguna liga, que es un estado legítimo —y rojo—.
 */
export const esquemaAplicarCotejoEntrada = z
  .object({
    aplicaciones: z
      .array(
        z.object({
          idRenglon: z.coerce
            .number({ error: 'El documento es obligatorio' })
            .int()
            .positive()
            .describe('Documento emitido a cubrir.'),
          importe: z.coerce
            .number({ error: 'El importe es obligatorio' })
            .positive({ error: 'El importe aplicado debe ser mayor que cero' })
            .describe('Lo que esta factura cubre de ese documento (con IVA).'),
        }),
      )
      .max(200, { error: 'Demasiados documentos en una sola factura (máx 200).' })
      .describe('La lista COMPLETA de documentos que cubre esta factura.'),
  })
  .describe('Reemplaza las ligas de una factura con los documentos que cubre.');

/** Datos validados de la aplicación. */
export type DatosAplicarCotejo = z.infer<typeof esquemaAplicarCotejoEntrada>;

/** Atender un descuadre: la explicación es OBLIGATORIA (si no, «atendida» no dice nada). */
export const esquemaAtenderCotejoEntrada = z
  .object({
    nota: z
      .string({ error: 'Hay que decir por qué se atiende' })
      .trim()
      .min(3, { error: 'Explica en una línea por qué queda atendida' })
      .max(1000)
      .describe('Por qué esta factura deja de frenar el pago.'),
  })
  .describe('Atiende el descuadre de una factura.');

/** Datos validados de atender. */
export type DatosAtenderCotejo = z.infer<typeof esquemaAtenderCotejoEntrada>;
