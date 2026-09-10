/**
 * LAS REGLAS PURAS DEL DOCUMENTO PARA FACTURAR (fila 0.118), antes de tocar la base.
 *
 * Lo que se mide aquí es lo que decide si a un proveedor se le pide factura y con qué números:
 * cuándo NO se emite y por qué, qué datos fiscales faltan y de quién, qué dice el concepto y cómo
 * queda el desglose. Lo que necesita Postgres (los permisos, la lectura de la corrida real) vive en
 * `documento-facturacion.int.test.ts`.
 *
 * 🔒 Todos los nombres y RFC de aquí son INVENTADOS (el repo es público, fila 0.123):
 * «TALLER EJEMPLO UNO», «EMPRESA DEMO SA DE CV» y RFC con forma válida pero obviamente sintética.
 */
import { describe, expect, it } from 'vitest';

import {
  armarDocumento,
  conceptoDelDocumento,
  documentoDe,
  evaluarFacturabilidad,
  faltantesDelEmisor,
  faltantesDelReceptor,
  USO_CFDI_SUGERIDO,
  type EmisorFiscal,
  type EntradaDocumento,
  type ReceptorFiscal,
  type RenglonParaFacturar,
} from './documento-facturacion.js';

/** Un proveedor con TODO capturado: el que sí puede facturar. */
const EMISOR_COMPLETO: EmisorFiscal = {
  nombre: 'TALLER EJEMPLO UNO',
  razonSocial: 'TALLER EJEMPLO UNO SA DE CV',
  rfc: 'TEU010101AAA',
  regimenFiscalSat: '601',
  codigoPostalExpedicion: '54000',
  usoCfdiHabitual: 'G03',
};

/** La empresa con su ficha fiscal completa (los dos campos nuevos incluidos). */
const RECEPTOR_COMPLETO: ReceptorFiscal = {
  nombre: 'Empresa Demo',
  razonSocial: 'EMPRESA DEMO SA DE CV',
  rfc: 'EDE010101AAA',
  regimenFiscalSat: '601',
  codigoPostalFiscal: '11000',
};

/** Un renglón de maquila, por transferencia, con monto. */
const RENGLON: RenglonParaFacturar = {
  origen: 'maquila',
  formaPago: 'transferencia',
  monto: 11_600,
  rubro: 'maquila',
  nombre: 'TALLER EJEMPLO UNO',
  concepto: 'Maquila de la semana',
  referencia: '7909 y 7888',
};

/** La entrada «feliz»: corrida cerrada, con factura, todo capturado. Los tests la modifican. */
function entrada(cambios: Partial<EntradaDocumento> = {}): EntradaDocumento {
  return {
    idCorrida: 7,
    folioCorrida: 12,
    semana: '2026-08-31',
    conFactura: true,
    estado: 'cerrada',
    idRenglon: 33,
    renglon: RENGLON,
    emisor: EMISOR_COMPLETO,
    receptor: RECEPTOR_COMPLETO,
    ...cambios,
  };
}

describe('cuándo SÍ se emite el documento', () => {
  it('corrida cerrada CON factura, transferencia, con monto y todo capturado ⇒ facturable', () => {
    const veredicto = evaluarFacturabilidad(entrada());
    expect(veredicto).toEqual({
      facturable: true,
      motivo: null,
      motivoTexto: null,
      faltantes: [],
    });
  });

  it('una corrida EJECUTADA también emite (el dinero ya salió: con más razón hay que facturarlo)', () => {
    expect(evaluarFacturabilidad(entrada({ estado: 'ejecutada' })).facturable).toBe(true);
  });
});

describe('cuándo NO se emite, y por qué', () => {
  it('la relación SIN factura no lleva comprobante', () => {
    const v = evaluarFacturabilidad(entrada({ conFactura: false }));
    expect(v.facturable).toBe(false);
    expect(v.motivo).toBe('sinFactura');
    expect(v.motivoTexto).toContain('SIN factura');
  });

  it('un CONCEPTO del catálogo no tiene quién facture', () => {
    const v = evaluarFacturabilidad(
      entrada({
        renglon: { ...RENGLON, origen: 'concepto', rubro: 'caja_chica' },
        emisor: null,
      }),
    );
    expect(v.motivo).toBe('concepto');
  });

  it('⭐ un renglón de PROVEEDOR sin emisor legible tiene su PROPIO motivo, no el del concepto', () => {
    // No debería pasar (la FK es Restrict), pero si pasara, el documento saldría sin emisor. Los
    // dos casos acaban sin documento, y aun así NO son el mismo: llamarle «concepto del catálogo»
    // al pago de un taller manda a buscar el arreglo donde no está.
    const v = evaluarFacturabilidad(entrada({ emisor: null }));
    expect(v.motivo).toBe('proveedorNoLegible');
    expect(v.motivoTexto).toContain('proveedor');
    expect(v.motivoTexto).not.toContain('catálogo');
  });

  it('⭐ EFECTIVO no factura: «las facturas son sólo transferencias»', () => {
    const v = evaluarFacturabilidad(entrada({ renglon: { ...RENGLON, formaPago: 'efectivo' } }));
    expect(v.motivo).toBe('efectivo');
    expect(v.motivoTexto).toContain('efectivo');
  });

  it('un renglón en CERO no tiene nada que facturar', () => {
    const v = evaluarFacturabilidad(entrada({ renglon: { ...RENGLON, monto: 0 } }));
    expect(v.motivo).toBe('sinMonto');
  });

  it('un renglón de medio centavo cuenta como cero (misma tolerancia que la relación)', () => {
    expect(evaluarFacturabilidad(entrada({ renglon: { ...RENGLON, monto: 0.004 } })).motivo).toBe(
      'sinMonto',
    );
    expect(
      evaluarFacturabilidad(entrada({ renglon: { ...RENGLON, monto: 0.005 } })).facturable,
    ).toBe(true);
  });

  it('🟡 un BORRADOR no emite: los montos todavía se mueven (default del lead, Daniel confirma)', () => {
    const v = evaluarFacturabilidad(entrada({ estado: 'borrador' }));
    expect(v.motivo).toBe('estado');
    expect(v.motivoTexto).toContain('borrador');
  });

  it('⭐ el proveedor SIN RFC no factura, y el aviso lo dice con su nombre', () => {
    const v = evaluarFacturabilidad(entrada({ emisor: { ...EMISOR_COMPLETO, rfc: null } }));
    expect(v.motivo).toBe('faltantes');
    expect(v.faltantes).toEqual([
      { quien: 'proveedor', campo: 'rfc', texto: 'Falta el RFC del proveedor TALLER EJEMPLO UNO' },
    ]);
  });

  it('⭐ si el hueco es de la EMPRESA, el aviso también lo dice (y a dónde ir a capturarlo)', () => {
    const v = evaluarFacturabilidad(
      entrada({ receptor: { ...RECEPTOR_COMPLETO, codigoPostalFiscal: null } }),
    );
    expect(v.motivo).toBe('faltantes');
    expect(v.faltantes).toHaveLength(1);
    expect(v.faltantes[0]?.quien).toBe('empresa');
    expect(v.faltantes[0]?.campo).toBe('codigoPostalFiscal');
    expect(v.faltantes[0]?.texto).toContain('Administración › Empresas');
  });

  it('un dato en BLANCO cuenta como faltante (una cadena de espacios no es un RFC)', () => {
    const v = evaluarFacturabilidad(entrada({ emisor: { ...EMISOR_COMPLETO, rfc: '   ' } }));
    expect(v.motivo).toBe('faltantes');
    expect(v.faltantes[0]?.campo).toBe('rfc');
  });

  it('faltan los dos lados: salen TODOS, primero los del proveedor', () => {
    const v = evaluarFacturabilidad(
      entrada({
        emisor: { ...EMISOR_COMPLETO, rfc: null, regimenFiscalSat: null },
        receptor: { ...RECEPTOR_COMPLETO, rfc: null },
      }),
    );
    expect(v.faltantes.map((f) => `${f.quien}:${f.campo}`)).toEqual([
      'proveedor:rfc',
      'proveedor:regimenFiscalSat',
      'empresa:rfc',
    ]);
    expect(v.motivoTexto).toContain('(3)');
  });

  it('el motivo es UNO SOLO y gana el primero de la lista (efectivo antes que faltantes)', () => {
    const v = evaluarFacturabilidad(
      entrada({
        renglon: { ...RENGLON, formaPago: 'efectivo' },
        emisor: { ...EMISOR_COMPLETO, rfc: null },
      }),
    );
    expect(v.motivo).toBe('efectivo');
    expect(v.faltantes).toEqual([]);
  });
});

describe('los faltantes, uno por uno', () => {
  it('un proveedor vacío tiene los CUATRO huecos del emisor (el uso de CFDI NO cuenta)', () => {
    const faltas = faltantesDelEmisor({
      nombre: 'TALLER EJEMPLO UNO',
      razonSocial: null,
      rfc: null,
      regimenFiscalSat: null,
      codigoPostalExpedicion: null,
      usoCfdiHabitual: null,
    });
    expect(faltas.map((f) => f.campo)).toEqual([
      'razonSocial',
      'rfc',
      'regimenFiscalSat',
      'codigoPostalExpedicion',
    ]);
  });

  it('una empresa vacía tiene los CUATRO huecos del receptor', () => {
    const faltas = faltantesDelReceptor({
      nombre: 'Empresa Demo',
      razonSocial: null,
      rfc: null,
      regimenFiscalSat: null,
      codigoPostalFiscal: null,
    });
    expect(faltas.map((f) => f.campo)).toEqual([
      'razonSocial',
      'rfc',
      'regimenFiscalSat',
      'codigoPostalFiscal',
    ]);
    // Sin razón social, el aviso se apoya en el nombre corto: nunca sale «Falta la razón social de null».
    expect(faltas[0]?.texto).toBe(
      'Falta la razón social de Empresa Demo (Administración › Empresas)',
    );
  });

  it('el proveedor SIN uso de CFDI sigue siendo facturable (es dato del receptor, no suyo)', () => {
    const v = evaluarFacturabilidad(
      entrada({ emisor: { ...EMISOR_COMPLETO, usoCfdiHabitual: null } }),
    );
    expect(v.facturable).toBe(true);
  });
});

describe('el concepto que se factura', () => {
  it('si el renglón trae concepto capturado, se usa TAL CUAL', () => {
    expect(conceptoDelDocumento(RENGLON, '2026-08-31')).toBe('Maquila de la semana');
  });

  it('sin concepto capturado, se arma por rubro con la semana', () => {
    expect(conceptoDelDocumento({ ...RENGLON, concepto: null }, '2026-08-31')).toBe(
      'Servicios de maquila — semana del 2026-08-31',
    );
    expect(
      conceptoDelDocumento({ ...RENGLON, concepto: null, rubro: 'proveedores' }, '2026-08-31'),
    ).toBe('Servicios y suministros — semana del 2026-08-31');
  });

  it('⭐ un concepto de puros espacios NO deja el documento sin descripción', () => {
    expect(conceptoDelDocumento({ ...RENGLON, concepto: '   ' }, '2026-08-31')).toBe(
      'Servicios de maquila — semana del 2026-08-31',
    );
  });
});

describe('el documento armado', () => {
  it('lleva los dos lados, las claves del SAT y el IVA EXPLÍCITO cuadrando', () => {
    const doc = armarDocumento(entrada());
    expect(doc.receptor).toEqual({
      razonSocial: 'EMPRESA DEMO SA DE CV',
      rfc: 'EDE010101AAA',
      regimenFiscalSat: '601',
      codigoPostal: '11000',
    });
    expect(doc.emisor).toEqual({
      razonSocial: 'TALLER EJEMPLO UNO SA DE CV',
      rfc: 'TEU010101AAA',
      regimenFiscalSat: '601',
      codigoPostal: '54000',
    });
    expect(doc.formaPagoSat).toBe('03');
    expect(doc.metodoPagoSat).toBe('PUE');
    expect(doc.moneda).toBe('MXN');
    expect(doc.subtotal).toBe(10_000);
    expect(doc.iva).toBe(1600);
    expect(doc.total).toBe(11_600);
    expect(doc.tasaIvaTexto).toBe('16 %');
    expect(doc.referencia).toBe('7909 y 7888');
  });

  it('⭐ el uso de CFDI capturado se respeta; el que falta va con G03 MARCADO como sugerido', () => {
    expect(armarDocumento(entrada()).usoCfdi).toBe('G03');
    expect(armarDocumento(entrada()).usoCfdiSugerido).toBe(false);

    const sinUso = armarDocumento(
      entrada({ emisor: { ...EMISOR_COMPLETO, usoCfdiHabitual: null } }),
    );
    expect(sinUso.usoCfdi).toBe(USO_CFDI_SUGERIDO);
    expect(sinUso.usoCfdiSugerido).toBe(true);
  });

  it('⭐ armarDocumento se niega a inventar un emisor que no existe', () => {
    expect(() => armarDocumento(entrada({ emisor: null }))).toThrow(/emisor/);
  });
});

describe('documentoDe: o el documento, o el porqué — nunca las dos cosas', () => {
  it('facturable ⇒ viene el documento y el motivo va en null', () => {
    const salida = documentoDe(entrada());
    expect(salida.facturable).toBe(true);
    expect(salida.motivo).toBeNull();
    expect(salida.documento?.total).toBe(11_600);
  });

  it('⭐ NO facturable ⇒ el documento va en null (nunca uno a medias)', () => {
    const salida = documentoDe(entrada({ emisor: { ...EMISOR_COMPLETO, rfc: null } }));
    expect(salida.facturable).toBe(false);
    expect(salida.documento).toBeNull();
    expect(salida.faltantes).toHaveLength(1);
  });
});
