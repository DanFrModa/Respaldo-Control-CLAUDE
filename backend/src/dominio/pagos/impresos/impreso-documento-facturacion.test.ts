/**
 * EL IMPRESO del documento para facturar (fila 0.118) — SIN Postgres.
 *
 * ⚠️ Aquí NO basta con comprobar que el buffer empieza con `%PDF`: este documento existe para que
 * un tercero lea unos datos concretos y timbre con ellos. Si el RFC o el IVA no salieran impresos,
 * un test de «es un PDF» pasaría igual y el proveedor recibiría una hoja inservible. Por eso se
 * **extrae el texto del PDF** (`comun/pdf-texto.ts`, el mismo lector que usa el importador de OC) y
 * se asierta sobre lo que de verdad se lee.
 *
 * 🔒 Nombres y RFC INVENTADOS (repo público, fila 0.123).
 */
import { describe, expect, it } from 'vitest';

import type { DocumentoFacturacion } from '../../../contrato/index.js';
import { extraerTextoPdf } from '../../../comun/pdf-texto.js';
import type { DocumentosDeCorrida } from '../documento-facturacion.js';

import {
  generarPdfDocumentoFacturacion,
  generarPdfDocumentosCorrida,
} from './impreso-documento-facturacion.js';

/** El documento de un pago de $11,600.00 (10,000 + 1,600 de IVA). */
const DOC: DocumentoFacturacion = {
  idCorrida: 7,
  idRenglon: 33,
  folioCorrida: 12,
  semana: '2026-08-31',
  receptor: {
    razonSocial: 'EMPRESA DEMO SA DE CV',
    rfc: 'EDE010101AAA',
    regimenFiscalSat: '601',
    codigoPostal: '11000',
  },
  emisor: {
    razonSocial: 'TALLER EJEMPLO UNO SA DE CV',
    rfc: 'TEU010101AAA',
    regimenFiscalSat: '626',
    codigoPostal: '54000',
  },
  nombreProveedor: 'TALLER EJEMPLO UNO',
  usoCfdi: 'G03',
  usoCfdiSugerido: false,
  concepto: 'Maquila de la semana',
  referencia: '7909 y 7888',
  formaPagoSat: '03',
  formaPagoTexto: 'Transferencia electrónica de fondos',
  metodoPagoSat: 'PUE',
  metodoPagoTexto: 'Pago en una sola exhibición',
  moneda: 'MXN',
  subtotal: 10_000,
  iva: 1600,
  tasaIvaTexto: '16 %',
  total: 11_600,
};

/** Todo el texto del PDF, con los saltos normalizados a espacios (react-pdf parte las líneas). */
async function textoDelPdf(buffer: Buffer): Promise<string> {
  const paginas = await extraerTextoPdf(buffer);
  return paginas.join(' ').replace(/\s+/g, ' ');
}

describe('impreso del documento para facturar (una hoja, un pago)', () => {
  it('⭐ imprime los datos fiscales de LOS DOS lados', async () => {
    const texto = await textoDelPdf(await generarPdfDocumentoFacturacion(DOC));
    // Emisor: quien va a facturar.
    expect(texto).toContain('TALLER EJEMPLO UNO SA DE CV');
    expect(texto).toContain('TEU010101AAA');
    expect(texto).toContain('626');
    expect(texto).toContain('54000');
    // Receptor: a quien se le factura.
    expect(texto).toContain('EMPRESA DEMO SA DE CV');
    expect(texto).toContain('EDE010101AAA');
    expect(texto).toContain('11000');
    // Y se distingue quién es quién.
    expect(texto).toContain('EMISOR');
    expect(texto).toContain('RECEPTOR');
  });

  it('⭐ el IVA va EXPLÍCITO: subtotal, IVA con su tasa y total, los tres impresos', async () => {
    const texto = await textoDelPdf(await generarPdfDocumentoFacturacion(DOC));
    expect(texto).toContain('Subtotal');
    expect(texto).toContain('$10,000.00');
    expect(texto).toContain('IVA trasladado 16 %');
    expect(texto).toContain('$1,600.00');
    expect(texto).toContain('Total a facturar');
    expect(texto).toContain('$11,600.00');
  });

  it('lleva el concepto, la referencia y las claves del SAT del pago', async () => {
    const texto = await textoDelPdf(await generarPdfDocumentoFacturacion(DOC));
    expect(texto).toContain('Maquila de la semana');
    expect(texto).toContain('7909 y 7888');
    expect(texto).toContain('03 Transferencia electrónica de fondos');
    expect(texto).toContain('PUE Pago en una sola exhibición');
    expect(texto).toContain('MXN');
    expect(texto).toContain('G03');
  });

  it('⭐ NUNCA lleva el número de cuenta: eso es de la relación ejecutable, no del proveedor', async () => {
    // El documento se le manda al proveedor; los datos bancarios no tienen nada que hacer ahí.
    expect(Object.keys(DOC)).not.toContain('numeroCuenta');
    expect(Object.keys(DOC)).not.toContain('banco');

    const texto = await textoDelPdf(await generarPdfDocumentoFacturacion(DOC));
    // 🔴 Esta aserción decía `not.toContain('Cuenta')` y era VACÍA: las etiquetas del impreso se
    // pintan con `textTransform: 'uppercase'` (`comun/impresos-estilos.ts`), así que «Cuenta» no
    // aparece NUNCA aunque se imprima la cuenta entera. El reviewer metió una CLABE en la hoja y la
    // suite siguió verde. Se compara en MAYÚSCULAS y, sobre todo, se busca el DATO y no la etiqueta:
    // ninguna tira larga de dígitos puede salir en un documento que se le manda al proveedor.
    expect(texto).not.toMatch(/CUENTA|CLABE/);
    expect(texto).not.toMatch(/\d{16,18}/);
  });

  it('⭐ el uso de CFDI que NO estaba capturado sale marcado como SUGERIDO', async () => {
    const texto = await textoDelPdf(
      await generarPdfDocumentoFacturacion({ ...DOC, usoCfdiSugerido: true }),
    );
    expect(texto).toContain('SUGERIDO');
    // Y cuando sí estaba capturado, no se marca nada.
    const capturado = await textoDelPdf(await generarPdfDocumentoFacturacion(DOC));
    expect(capturado).not.toContain('SUGERIDO');
  });

  it('sin referencia capturada, la hoja sale igual (no imprime una etiqueta vacía)', async () => {
    const texto = await textoDelPdf(
      await generarPdfDocumentoFacturacion({ ...DOC, referencia: null }),
    );
    // Igual que arriba: la etiqueta sale en MAYÚSCULAS, así que buscar «Referencia» no medía nada.
    expect(texto).not.toContain('REFERENCIA');
    expect(texto).toContain('$11,600.00');
    // Y con referencia sí sale: sin este contraste, la negativa volvería a poder ser vacía.
    const conReferencia = await textoDelPdf(await generarPdfDocumentoFacturacion(DOC));
    expect(conReferencia).toContain('REFERENCIA');
  });
});

describe('impreso de TODA la corrida', () => {
  /** Una corrida con un documento emitido y uno que no se pudo. */
  const CORRIDA: DocumentosDeCorrida = {
    membrete: 'EMPRESA DEMO SA DE CV',
    folioCorrida: 12,
    semana: '2026-08-31',
    conFactura: true,
    estado: 'cerrada',
    documentos: [DOC],
    noEmitidos: [
      {
        // ⚠️ `nombre` y `beneficiario` DISTINTOS a propósito: con quién se contrató y a nombre de
        // quién iba el depósito no son lo mismo, y la hoja tiene que enseñar los dos.
        nombre: 'TALLER EJEMPLO DOS',
        beneficiario: 'PERSONA EJEMPLO DOS',
        monto: 5000,
        motivo: 'faltantes',
        motivoTexto: 'Faltan datos fiscales (1): sin ellos el proveedor no puede timbrar.',
        faltantes: [
          {
            quien: 'proveedor',
            campo: 'rfc',
            texto: 'Falta el RFC del proveedor TALLER EJEMPLO DOS',
          },
        ],
      },
    ],
  };

  it('⭐ la PRIMERA página lista a quién no se le pudo pedir factura, y por qué', async () => {
    const paginas = await extraerTextoPdf(await generarPdfDocumentosCorrida(CORRIDA));
    expect(paginas.length).toBe(2);
    const primera = (paginas[0] ?? '').replace(/\s+/g, ' ');
    expect(primera).toContain('NO se pudieron emitir');
    expect(primera).toContain('Falta el RFC del proveedor TALLER EJEMPLO DOS');
    expect(primera).toContain('$5,000.00');
    // ⭐ Las DOS columnas: con quién se contrató Y a nombre de quién iba el depósito. Antes se
    // rotulaba «Beneficiario» y se imprimía el nombre: la columna mentía y el beneficiario no
    // salía por ningún lado (y es justo el dato para saber a quién perseguir).
    expect(primera).toContain('TALLER EJEMPLO DOS');
    expect(primera).toContain('PERSONA EJEMPLO DOS');
    // Los encabezados de tabla también llevan `textTransform: 'uppercase'` — la misma trampa que
    // hacía vacías las aserciones de arriba, y por la que este `toMatch` nació en rojo.
    expect(primera).toMatch(/NOMBRE\s+BENEFICIARIO/);
  });

  it('después de los avisos va una hoja por cada documento emitido', async () => {
    const paginas = await extraerTextoPdf(await generarPdfDocumentosCorrida(CORRIDA));
    const segunda = (paginas[1] ?? '').replace(/\s+/g, ' ');
    expect(segunda).toContain('TALLER EJEMPLO UNO SA DE CV');
    expect(segunda).toContain('$11,600.00');
  });

  it('sin nadie fuera, NO se imprime la hoja de avisos (sólo los documentos)', async () => {
    const paginas = await extraerTextoPdf(
      await generarPdfDocumentosCorrida({ ...CORRIDA, noEmitidos: [] }),
    );
    expect(paginas.length).toBe(1);
    expect((paginas[0] ?? '').replace(/\s+/g, ' ')).not.toContain('NO se pudieron emitir');
  });

  it('una corrida sin nada que pagar sale con UNA hoja que lo explica (no un PDF roto)', async () => {
    const paginas = await extraerTextoPdf(
      await generarPdfDocumentosCorrida({ ...CORRIDA, documentos: [], noEmitidos: [] }),
    );
    expect(paginas.length).toBe(1);
    expect((paginas[0] ?? '').replace(/\s+/g, ' ')).toContain('no hay nada que facturar');
  });
});
