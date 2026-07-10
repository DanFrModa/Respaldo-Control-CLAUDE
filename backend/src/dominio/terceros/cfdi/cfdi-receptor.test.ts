import { describe, expect, it } from 'vitest';

import { ErrorConflicto } from '../../../comun/errores.js';

import { validarReceptorCfdi } from './cfdi-proveedor.js';
import { type CfdiParseado } from './parser-cfdi.js';

/**
 * Tests UNIT de la validación del RECEPTOR de un CFDI (F9-E3; R11) — "receptor ajeno rechazado". Es
 * lógica de negocio del servicio (comparar el receptor del XML contra el RFC de la empresa), no del
 * parser: por eso vive aquí y no en `parser-cfdi.test.ts`. Función pura → test sin BD.
 */

/** CFDI parseado mínimo con el receptor dado (el resto no interviene en la validación del receptor). */
function conReceptor(receptorRfc: string): CfdiParseado {
  return {
    version: '4.0',
    tipoComprobante: 'I',
    uuid: '11111111-1111-1111-1111-111111111111',
    fecha: '2026-07-01',
    fechaTimbrado: null,
    emisorRfc: 'AAA010101AA1',
    emisorNombre: 'Telas del Norte SA',
    receptorRfc,
    receptorNombre: 'FR Moda SA de CV',
    moneda: 'MXN',
    subtotal: 1000,
    total: 1160,
    ivaTrasladado: 160,
    isrRetenido: 0,
    ivaRetenido: 0,
    conceptos: [],
  };
}

describe('validarReceptorCfdi', () => {
  it('rechaza un CFDI dirigido a otro RFC (receptor ajeno)', () => {
    expect(() => validarReceptorCfdi(conReceptor('XEXX010101000'), 'XAXX010101000')).toThrow(
      ErrorConflicto,
    );
  });

  it('acepta (sin avisos) cuando el receptor coincide, insensible a mayúsculas/espacios', () => {
    expect(validarReceptorCfdi(conReceptor('xaxx010101000'), 'XAXX010101000')).toEqual([]);
    expect(validarReceptorCfdi(conReceptor('XAXX010101000'), ' xaxx 010101 000 ')).toEqual([]);
  });

  it('sin RFC esperado NO rechaza: devuelve un aviso de "no validado"', () => {
    const avisos = validarReceptorCfdi(conReceptor('XAXX010101000'), null);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/no se validó/i);
  });
});
