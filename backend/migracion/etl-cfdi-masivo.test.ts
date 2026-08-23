/**
 * Unit de la decisión de DIRECCIÓN del importador masivo de CFDI (F9-E6): VENTA si el emisor es una
 * empresa nuestra, COMPRA si lo es el receptor, indeterminada si ambos o ninguno. Pura (sin BD).
 */
import { describe, expect, it } from 'vitest';

import { decidirDireccionCfdi } from './etl-cfdi-masivo.js';

/** Mapa RFC-normalizado → idEmpresa (la empresa activa lleva su RFC capturado). */
const EMPRESAS = new Map<string, number>([['XAXX010101000', 7]]);

describe('decidirDireccionCfdi', () => {
  it('emisor = empresa nuestra → VENTA (CxC), con su idEmpresa', () => {
    const d = decidirDireccionCfdi('XAXX010101000', 'AAA010101AA1', EMPRESAS);
    expect(d).toEqual({ tipo: 'venta', idEmpresa: 7 });
  });

  it('receptor = empresa nuestra → COMPRA (CxP), con su idEmpresa', () => {
    const d = decidirDireccionCfdi('AAA010101AA1', 'XAXX010101000', EMPRESAS);
    expect(d).toEqual({ tipo: 'compra', idEmpresa: 7 });
  });

  it('ni emisor ni receptor son empresa nuestra → indeterminada', () => {
    const d = decidirDireccionCfdi('AAA010101AA1', 'BBB020202BB2', EMPRESAS);
    expect(d.tipo).toBe('indeterminada');
  });

  it('ambos son empresas nuestras (comprobante entre empresas) → indeterminada', () => {
    const empresas = new Map<string, number>([
      ['XAXX010101000', 7],
      ['AAA010101AA1', 8],
    ]);
    const d = decidirDireccionCfdi('XAXX010101000', 'AAA010101AA1', empresas);
    expect(d.tipo).toBe('indeterminada');
  });

  it('normaliza el RFC (minúsculas/espacios) al comparar', () => {
    const d = decidirDireccionCfdi(' xaxx010101000 ', 'AAA010101AA1', EMPRESAS);
    expect(d.tipo).toBe('venta');
  });
});
