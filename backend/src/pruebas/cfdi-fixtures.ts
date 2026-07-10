/**
 * FIXTURES de CFDI 4.0 SINTÉTICOS para los tests de F9-E3 (R11). No hay CFDI reales en el repo (traen
 * datos fiscales), así que se arman XML de ejemplo válidos/estructurados. Vive en `src/pruebas` para
 * quedar EXCLUIDO del build (tsconfig.build.json). Lo usan `parser-cfdi.test.ts` y el int test.
 */

/** Opciones del CFDI de ejemplo. Por defecto: factura (I) con IVA trasladado + retención ISR. */
export interface OpcionesCfdiFixture {
  version?: string;
  tipo?: string;
  uuid?: string;
  emisorRfc?: string;
  receptorRfc?: string;
  total?: string;
  subtotal?: string;
  conTimbre?: boolean;
  conRetencion?: boolean;
  conConceptos?: boolean;
}

/** Timbre Fiscal Digital (dentro de Complemento) con un UUID configurable. */
function timbre(uuid: string): string {
  return (
    `<cfdi:Complemento>` +
    `<tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" ` +
    `FechaTimbrado="2026-07-01T12:01:00" RfcProvCertif="SAT970701NN3"/>` +
    `</cfdi:Complemento>`
  );
}

/** Arma un CFDI 4.0 de ejemplo. */
export function construirCfdi(opciones: OpcionesCfdiFixture = {}): string {
  const {
    version = '4.0',
    tipo = 'I',
    uuid = '11111111-1111-1111-1111-111111111111',
    emisorRfc = 'AAA010101AA1',
    receptorRfc = 'XAXX010101000',
    total = '1060.00',
    subtotal = '1000.00',
    conTimbre = true,
    conRetencion = true,
    conConceptos = true,
  } = opciones;

  const conceptos = conConceptos
    ? `<cfdi:Conceptos>` +
      `<cfdi:Concepto ClaveProdServ="53102500" Cantidad="10" ClaveUnidad="H87" ` +
      `Descripcion="Tela algodon" ValorUnitario="100.00" Importe="1000.00">` +
      `<cfdi:Impuestos><cfdi:Traslados>` +
      `<cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/>` +
      `</cfdi:Traslados></cfdi:Impuestos>` +
      `</cfdi:Concepto>` +
      `</cfdi:Conceptos>`
    : '';

  const retenciones = conRetencion
    ? `<cfdi:Retenciones><cfdi:Retencion Impuesto="001" Importe="100.00"/></cfdi:Retenciones>`
    : '';

  const impuestos =
    `<cfdi:Impuestos TotalImpuestosTrasladados="160.00"` +
    (conRetencion ? ` TotalImpuestosRetenidos="100.00"` : '') +
    `>` +
    retenciones +
    `<cfdi:Traslados>` +
    `<cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/>` +
    `</cfdi:Traslados>` +
    `</cfdi:Impuestos>`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" ` +
    `xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" ` +
    `Version="${version}" Fecha="2026-07-01T12:00:00" SubTotal="${subtotal}" Total="${total}" ` +
    `Moneda="MXN" TipoDeComprobante="${tipo}" LugarExpedicion="64000">` +
    `<cfdi:Emisor Rfc="${emisorRfc}" Nombre="Telas del Norte SA" RegimenFiscal="601"/>` +
    `<cfdi:Receptor Rfc="${receptorRfc}" Nombre="FR Moda SA de CV" ` +
    `DomicilioFiscalReceptor="64000" RegimenFiscalReceptor="601" UsoCFDI="G03"/>` +
    conceptos +
    impuestos +
    (conTimbre ? timbre(uuid) : '') +
    `</cfdi:Comprobante>`
  );
}
