/**
 * CONTRATO del **DOCUMENTO PARA FACTURAR** (fila 0.118) — §Post-F9.186(k).
 *
 * Daniel: *«Nadie me factura si no le mando yo un documento con los datos con los que me tiene que
 * facturar… **no al revés**. Y eso debe salir del sistema.»* Es exactamente lo que su cliente (C&A)
 * le hace a él: el que paga dicta qué se le factura.
 *
 * ⭐ **Es un IMPRESO, no un módulo.** No hay tabla, no hay folio, no hay estado: se arma al vuelo
 * desde un renglón de la corrida semanal, se imprime y se manda. Reimprimirlo mañana da lo mismo
 * porque todo lo que dice sale de datos que ya están guardados.
 *
 * ⭐ **El IVA va EXPLÍCITO.** No escondido dentro del total como en el Excel de producción: el
 * proveedor tiene que capturar subtotal, IVA y total, así que los tres van impresos y sumando.
 *
 * ⚠️ **Un documento POR PAGO, no por orden.** El renglón de la corrida no está amarrado a cargos
 * concretos (el pago de maquila nace «a cuenta»), así que no hay forma honesta de desglosar por
 * orden. Lo que se factura es lo que se transfiere, que es justo lo que Daniel pidió: *«lo ideal es
 * que facture lo que es en total»*.
 */
import { z } from 'zod';

// ── Por qué un renglón NO se puede facturar ─────────────────────────────────────────────────────

/**
 * Los motivos por los que un renglón NO produce documento. Se evalúan **en este orden** y gana el
 * primero que aplique: de lo que no va a ser facturable nunca (`sinFactura`, `concepto`) a lo que se
 * arregla capturando (`faltantes`). Uno solo, para que la pantalla diga UNA cosa y no una lista de
 * excusas.
 */
export const MOTIVOS_NO_FACTURABLE = [
  /** La corrida es la de **SIN** factura: ese segmento no lleva comprobante, por definición. */
  'sinFactura',
  /** El renglón es un CONCEPTO del catálogo (caja chica, nómina por fuera…): no hay quién facture. */
  'concepto',
  /**
   * El renglón SÍ es de un proveedor, pero sus datos no se pudieron leer del catálogo. No es lo
   * mismo que `concepto` y por eso tiene motivo propio: los dos acaban «sin emisor», pero decirle
   * a alguien que su pago a un taller «es un concepto del catálogo» es MENTIRLE, y manda a buscar
   * el arreglo al sitio equivocado.
   */
  'proveedorNoLegible',
  /** Sale en EFECTIVO. Daniel: *«las facturas son sólo transferencias»*. */
  'efectivo',
  /** El renglón está en CERO: no se le paga nada esta semana, así que no hay nada que facturar. */
  'sinMonto',
  /** La corrida sigue en BORRADOR: los montos todavía se mueven y el documento se emitiría viejo. */
  'estado',
  /** Falta algún dato fiscal (de un lado o del otro). Los detalles van en `faltantes`. */
  'faltantes',
] as const;

/** Clave del motivo por el que un renglón no se factura. */
export type MotivoNoFacturable = (typeof MOTIVOS_NO_FACTURABLE)[number];

// ── Qué dato fiscal falta, y de quién ───────────────────────────────────────────────────────────

/** De quién falta el dato: del proveedor que va a facturar, o de la empresa que va a recibir. */
export const QUIENES_DATO_FISCAL = ['proveedor', 'empresa'] as const;
/** Clave de a quién le falta el dato. */
export type QuienDatoFiscal = (typeof QUIENES_DATO_FISCAL)[number];

/**
 * Los datos fiscales que el documento necesita. Cuatro del EMISOR (el proveedor) y cuatro del
 * RECEPTOR (la empresa); dos claves son de un solo lado a propósito:
 *  • `codigoPostalExpedicion` es del EMISOR (el lugar donde expide el comprobante);
 *  • `codigoPostalFiscal` es del RECEPTOR (su domicilio fiscal).
 */
export const CAMPOS_FISCALES = [
  'razonSocial',
  'rfc',
  'regimenFiscalSat',
  'codigoPostalExpedicion',
  'codigoPostalFiscal',
  /**
   * ⚠️ HOY NO SE EMITE NUNCA como faltante, y es a propósito. El uso de CFDI no es un dato del
   * proveedor: es lo que **FR Moda declara** al recibir el comprobante, así que cuando el proveedor
   * no lo trae capturado el documento imprime «G03 Gastos en general» marcado como **sugerido** en
   * vez de negarse a salir. Está en el contrato porque es una decisión de Daniel que puede voltear:
   * el día que diga *«sin uso de CFDI no se emite»*, se agrega a la lista de faltantes y ya.
   */
  'usoCfdiHabitual',
] as const;

/** Clave de un dato fiscal. */
export type CampoFiscal = (typeof CAMPOS_FISCALES)[number];

/**
 * Un dato fiscal que falta, con el texto YA armado para la pantalla y el impreso.
 *
 * El `texto` viaja hecho (mismo patrón que los `bloqueos` de cerrar la corrida) para que el aviso
 * sea idéntico en el tooltip del botón, en el JSON y en la hoja de «no se emitieron»: si cada lado
 * lo redactara, tres redacciones distintas dirían lo mismo de tres maneras.
 */
export const esquemaFaltanteFiscal = z
  .object({
    quien: z.enum(QUIENES_DATO_FISCAL).describe('De quién falta el dato.'),
    campo: z.enum(CAMPOS_FISCALES).describe('Qué dato falta.'),
    texto: z.string().describe('El aviso, con el nombre de quien tiene el hueco.'),
  })
  .describe('Un dato fiscal que falta para poder emitir el documento.');

/** Un faltante tal como sale de la API. */
export type FaltanteFiscal = z.infer<typeof esquemaFaltanteFiscal>;

// ── El documento ────────────────────────────────────────────────────────────────────────────────

/** Los datos fiscales de una de las dos partes, tal como se imprimen. */
const esquemaParteFiscal = z.object({
  razonSocial: z.string().describe('Nombre legal con el que se timbra.'),
  rfc: z.string(),
  regimenFiscalSat: z.string().describe('Clave del régimen fiscal del SAT.'),
  codigoPostal: z
    .string()
    .describe('CP: del domicilio fiscal (receptor) o de expedición (emisor).'),
});

/** El documento, ya armado y con las tres cifras cuadradas. */
export const esquemaDocumentoFacturacion = z
  .object({
    idCorrida: z.number().int(),
    idRenglon: z.number().int(),
    folioCorrida: z.number().int().describe('Folio de la corrida (por empresa).'),
    semana: z.string().describe('Lunes de la semana que se paga (AAAA-MM-DD).'),
    /** El RECEPTOR: la empresa activa (A9). Quien manda el documento y va a recibir la factura. */
    receptor: esquemaParteFiscal.describe('A nombre de quién se factura (la empresa activa, A9).'),
    /** El EMISOR: el proveedor que va a facturar. */
    emisor: esquemaParteFiscal.describe('Quién va a emitir la factura (el proveedor).'),
    /** Nombre de uso diario del proveedor (el que sale en la relación), para ubicarlo de un vistazo. */
    nombreProveedor: z.string(),
    usoCfdi: z.string().describe('Clave del uso de CFDI que declara el receptor (p. ej. G03).'),
    usoCfdiSugerido: z
      .boolean()
      .describe('true = el proveedor no lo tiene capturado y va el default G03, marcado como tal.'),
    concepto: z.string().describe('Qué se está pagando (el del renglón, o uno armado por rubro).'),
    referencia: z.string().nullable().describe('Folios de remisiones/recibos que ampara, o null.'),
    formaPagoSat: z.string().describe('Clave del SAT de la forma de pago (03 = transferencia).'),
    formaPagoTexto: z.string(),
    metodoPagoSat: z.string().describe('Clave del SAT del método de pago (PUE).'),
    metodoPagoTexto: z.string(),
    moneda: z.string().describe('Moneda del comprobante (MXN).'),
    subtotal: z.number().describe('Base gravable.'),
    iva: z.number().describe('IVA trasladado (explícito, nunca escondido en el total).'),
    tasaIvaTexto: z.string().describe('La tasa como se imprime («16 %»).'),
    total: z.number().describe('Lo que se transfiere. subtotal + iva === total, al centavo.'),
  })
  .describe('El documento con el que el proveedor debe facturar (fila 0.118).');

/** El documento tal como sale de la API. */
export type DocumentoFacturacion = z.infer<typeof esquemaDocumentoFacturacion>;

/**
 * Respuesta del endpoint: o el documento, o el porqué de que no salga.
 *
 * Nunca las dos cosas y nunca ninguna: si `facturable` es `true` viene `documento` y `motivo` va en
 * `null`; si es `false` viene `motivo` (con su texto) y `documento` va en `null`. **No se emite un
 * documento a medias**: un CFDI con un hueco no se puede timbrar, y rellenarlo por nuestra cuenta
 * sería inventar datos fiscales (REGLA 0-B).
 */
export const esquemaDocumentoFacturacionSalida = z
  .object({
    facturable: z.boolean(),
    motivo: z.enum(MOTIVOS_NO_FACTURABLE).nullable().describe('Por qué no se emite, o null.'),
    motivoTexto: z.string().nullable().describe('El porqué, en palabras, o null.'),
    faltantes: z
      .array(esquemaFaltanteFiscal)
      .describe('Los datos fiscales que faltan (vacío si no es ése el problema).'),
    documento: esquemaDocumentoFacturacion.nullable(),
  })
  .describe('El documento para facturar de un renglón, o el motivo por el que no se emite.');

/** Salida del documento tal como sale de la API. */
export type DocumentoFacturacionSalida = z.infer<typeof esquemaDocumentoFacturacionSalida>;

/**
 * Lo que el CONCENTRADO agrega a cada renglón para que la pantalla sepa pintar el botón **sin una
 * llamada por renglón**: si se puede facturar y, si no, por qué y qué falta.
 */
export const esquemaFacturabilidadRenglon = z.object({
  facturable: z.boolean().describe('¿Se puede emitir el documento para facturar de este renglón?'),
  motivo: z.enum(MOTIVOS_NO_FACTURABLE).nullable(),
  motivoTexto: z.string().nullable(),
  faltantes: z.array(esquemaFaltanteFiscal),
});

/** La facturabilidad de un renglón, tal como viaja dentro del concentrado. */
export type FacturabilidadRenglon = z.infer<typeof esquemaFacturabilidadRenglon>;
