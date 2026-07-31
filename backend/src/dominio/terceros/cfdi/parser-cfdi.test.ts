import { describe, expect, it } from 'vitest';

import { ErrorValidacion } from '../../../comun/errores.js';
import { construirCfdi as cfdi } from '../../../pruebas/cfdi-fixtures.js';

import { normalizarRfc, origenDeTipoComprobante, parsearCfdi } from './parser-cfdi.js';

/**
 * Tests UNIT del parser/validador de CFDI 4.0 (F9-E3; R11). XML SINTÉTICOS de ejemplo como fixtures
 * (`src/pruebas/cfdi-fixtures.ts`): uno completo con IVA + retención ISR, una nota de crédito (E), uno
 * mal formado, uno sin timbre, uno 3.3 (rechazado), uno de tipo Pago (rechazado). El parser es PURO.
 */

describe('parsearCfdi — CFDI 4.0 completo (factura I con IVA + retención)', () => {
  const parsed = parsearCfdi(cfdi({}));

  it('extrae versión, tipo, UUID, fecha y moneda', () => {
    expect(parsed.version).toBe('4.0');
    expect(parsed.tipoComprobante).toBe('I');
    expect(parsed.uuid).toBe('11111111-1111-1111-1111-111111111111');
    expect(parsed.fecha).toBe('2026-07-01');
    expect(parsed.fechaTimbrado).toBe('2026-07-01T12:01:00');
    expect(parsed.moneda).toBe('MXN');
  });

  it('extrae emisor y receptor (RFC + nombre)', () => {
    expect(parsed.emisorRfc).toBe('AAA010101AA1');
    expect(parsed.emisorNombre).toBe('Telas del Norte SA');
    expect(parsed.receptorRfc).toBe('XAXX010101000');
    expect(parsed.receptorNombre).toBe('FR Moda SA de CV');
  });

  it('extrae montos e impuestos (total, subtotal, IVA trasladado, ISR retenido)', () => {
    expect(parsed.total).toBe(1060);
    expect(parsed.subtotal).toBe(1000);
    expect(parsed.ivaTrasladado).toBe(160);
    expect(parsed.isrRetenido).toBe(100);
    expect(parsed.ivaRetenido).toBe(0);
  });

  it('extrae los conceptos', () => {
    expect(parsed.conceptos).toHaveLength(1);
    expect(parsed.conceptos[0]).toEqual({
      descripcion: 'Tela algodon',
      cantidad: 10,
      valorUnitario: 100,
      importe: 1000,
    });
  });
});

describe('parsearCfdi — nota de crédito (E)', () => {
  it('reconoce el tipo E y su origen es nota_credito', () => {
    const parsed = parsearCfdi(
      cfdi({
        tipo: 'E',
        uuid: '22222222-2222-2222-2222-222222222222',
        total: '116.00',
        conRetencion: false,
      }),
    );
    expect(parsed.tipoComprobante).toBe('E');
    expect(origenDeTipoComprobante(parsed.tipoComprobante)).toBe('nota_credito');
    expect(parsed.total).toBe(116);
    expect(parsed.isrRetenido).toBe(0);
  });
});

describe('parsearCfdi — rechazos (nunca un cargo a medias)', () => {
  it('rechaza XML mal formado / que no es CFDI', () => {
    expect(() => parsearCfdi('esto no es un xml')).toThrow(ErrorValidacion);
    expect(() => parsearCfdi('<root><hijo>x</hijo></root>')).toThrow(ErrorValidacion);
    expect(() => parsearCfdi('')).toThrow(ErrorValidacion);
  });

  it('rechaza un CFDI sin Timbre Fiscal Digital', () => {
    expect(() => parsearCfdi(cfdi({ conTimbre: false }))).toThrow(/TIMBRADO/i);
  });

  it('rechaza un CFDI que no es versión 4.0', () => {
    expect(() => parsearCfdi(cfdi({ version: '3.3' }))).toThrow(/4\.0/);
  });

  it('rechaza un tipo de comprobante que no es I ni E (p. ej. Pago)', () => {
    expect(() => parsearCfdi(cfdi({ tipo: 'P' }))).toThrow(ErrorValidacion);
  });

  it('rechaza un total menor o igual a cero', () => {
    expect(() => parsearCfdi(cfdi({ total: '0.00' }))).toThrow(/Total/i);
  });

  it('rechaza un XML que declara DOCTYPE (S1: posible entidad externa/XXE)', () => {
    const conDoctype =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<!DOCTYPE Comprobante [<!ENTITY xxe "reventado">]>` +
      `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" ` +
      `Version="4.0" TipoDeComprobante="I" Total="1.00" Fecha="2026-07-01T00:00:00">` +
      `</cfdi:Comprobante>`;
    expect(() => parsearCfdi(conDoctype)).toThrow(/DOCTYPE/i);
  });
});

describe('helpers puros', () => {
  it('origenDeTipoComprobante mapea I→factura_proveedor, E→nota_credito', () => {
    expect(origenDeTipoComprobante('I')).toBe('factura_proveedor');
    expect(origenDeTipoComprobante('E')).toBe('nota_credito');
  });

  it('normalizarRfc pasa a mayúsculas y quita espacios', () => {
    expect(normalizarRfc('aaa010101aa1')).toBe('AAA010101AA1');
    expect(normalizarRfc(' AAA 010101 AA1 ')).toBe('AAA010101AA1');
  });
});
