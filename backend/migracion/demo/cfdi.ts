/**
 * CFDI 4.0 FICTICIOS del sembrador de inventarios.
 *
 * 🔴 100 % INVENTADOS. El repositorio es PÚBLICO: aquí no hay —ni puede haber— el RFC, el nombre o
 * el domicilio de una persona o empresa real. Los emisores son los proveedores `DEMO-` de
 * `demo/datos.ts` (RFC con raíz `DM…`), y el sello/timbre es un UUID de relleno: **no están
 * timbrados por ningún PAC**, sólo tienen la FORMA que el parser de v2 exige.
 *
 * Para qué sirven: probar la importación de CFDI de proveedor contra las OC sembradas — unos que
 * CASAN (mismo proveedor, total = Σ de la OC + 16 % de IVA) y otros que NO, que es el caso
 * incómodo (emisor desconocido, o el proveedor correcto con otro importe).
 *
 * ⚠️ El RECEPTOR se escribe con el RFC de la empresa activa en el momento de sembrar. Si la empresa
 * todavía no tiene RFC capturado, se usa `XAXX010101000` (el genérico del público en general) y el
 * importador sólo avisa; si la empresa SÍ tiene RFC y el archivo trae otro, el importador RECHAZA
 * el comprobante a propósito (`validarReceptorCfdi`), así que los archivos se vuelven a escribir en
 * cada corrida del sembrador para que siempre casen con la empresa de esa base.
 */

/** IVA trasladado de los comprobantes ficticios. */
const TASA_IVA = 0.16;

/** Datos con los que se arma un CFDI ficticio. */
export interface CfdiDemo {
  /** Nombre del archivo (sin ruta). */
  archivo: string;
  uuid: string;
  /** `I` = ingreso (factura), `E` = egreso (nota de crédito). */
  tipo: 'I' | 'E';
  emisorRfc: string;
  emisorNombre: string;
  /** Fecha del comprobante (`YYYY-MM-DD`). */
  fecha: string;
  /** Importe SIN IVA. El total sale de aquí. */
  subtotal: number;
  /** Qué ampara (va en el concepto). */
  concepto: string;
  /** Para el reporte: con qué OC casa, o por qué NO casa. */
  nota: string;
}

/** Redondea a dos decimales y lo devuelve como texto con dos decimales (formato del SAT). */
function pesos(valor: number): string {
  return (Math.round(valor * 100) / 100).toFixed(2);
}

/**
 * Arma el XML de un CFDI 4.0 ficticio. Mismo esqueleto que los fixtures de las pruebas del parser
 * (`src/pruebas/cfdi-fixtures.ts`): Comprobante + Emisor + Receptor + Conceptos + Impuestos +
 * TimbreFiscalDigital, que es lo que `parsearCfdi` exige para no rechazarlo.
 */
export function construirCfdiDemo(
  datos: CfdiDemo,
  receptorRfc: string,
  receptorNombre: string,
): string {
  const subtotal = pesos(datos.subtotal);
  const iva = pesos(datos.subtotal * TASA_IVA);
  const total = pesos(datos.subtotal * (1 + TASA_IVA));
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" ` +
    `xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" ` +
    `Version="4.0" Fecha="${datos.fecha}T12:00:00" SubTotal="${subtotal}" Total="${total}" ` +
    `Moneda="MXN" TipoDeComprobante="${datos.tipo}" LugarExpedicion="00000">\n` +
    `  <cfdi:Emisor Rfc="${datos.emisorRfc}" Nombre="${datos.emisorNombre}" RegimenFiscal="601"/>\n` +
    `  <cfdi:Receptor Rfc="${receptorRfc}" Nombre="${receptorNombre}" ` +
    `DomicilioFiscalReceptor="00000" RegimenFiscalReceptor="601" UsoCFDI="G03"/>\n` +
    `  <cfdi:Conceptos>\n` +
    `    <cfdi:Concepto ClaveProdServ="53102500" Cantidad="1" ClaveUnidad="H87" ` +
    `Descripcion="${datos.concepto}" ValorUnitario="${subtotal}" Importe="${subtotal}">\n` +
    `      <cfdi:Impuestos><cfdi:Traslados>` +
    `<cfdi:Traslado Base="${subtotal}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${iva}"/>` +
    `</cfdi:Traslados></cfdi:Impuestos>\n` +
    `    </cfdi:Concepto>\n` +
    `  </cfdi:Conceptos>\n` +
    `  <cfdi:Impuestos TotalImpuestosTrasladados="${iva}"><cfdi:Traslados>` +
    `<cfdi:Traslado Base="${subtotal}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${iva}"/>` +
    `</cfdi:Traslados></cfdi:Impuestos>\n` +
    `  <cfdi:Complemento>` +
    `<tfd:TimbreFiscalDigital Version="1.1" UUID="${datos.uuid}" ` +
    `FechaTimbrado="${datos.fecha}T12:01:00" RfcProvCertif="XXX000000XXX"/>` +
    `</cfdi:Complemento>\n` +
    `</cfdi:Comprobante>\n`
  );
}

/** Total con IVA de un CFDI ficticio (lo imprime el reporte para poder cotejarlo a ojo). */
export function totalCfdi(datos: CfdiDemo): number {
  return Math.round(datos.subtotal * (1 + TASA_IVA) * 100) / 100;
}
