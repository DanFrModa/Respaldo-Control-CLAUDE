// Los dos tipos de proveedor de Daniel (§Post-F9.22) — y por qué son TRES estados y no dos.

import { describe, expect, it } from 'vitest';

import {
  admiteCfdi,
  exigirProveedorQueFactura,
  modalidadFactura,
} from './facturacion-proveedor.js';

describe('modalidadFactura', () => {
  it('distingue al que factura, al que no, y al que nadie definió', () => {
    expect(modalidadFactura(true)).toBe('factura');
    expect(modalidadFactura(false)).toBe('sin-factura');
    expect(modalidadFactura(null)).toBe('no-definida');
    expect(modalidadFactura(undefined)).toBe('no-definida');
  });
});

describe('admiteCfdi', () => {
  it('solo deja fuera al que está marcado como que NO factura', () => {
    expect(admiteCfdi(true)).toBe(true);
    expect(admiteCfdi(false)).toBe(false);
    // Los proveedores migrados traen NULL: apagarles la lectura de facturas por un dato que nadie
    // capturó sería peor que dejarlos pasar (el CFDI que manden es prueba de que sí timbran).
    expect(admiteCfdi(null)).toBe(true);
  });
});

describe('exigirProveedorQueFactura', () => {
  it('deja pasar al que factura y al que no tiene la casilla definida', () => {
    expect(() => {
      exigirProveedorQueFactura({ nombre: 'Bloom', factura: true }, 'guardar la factura');
    }).not.toThrow();
    expect(() => {
      exigirProveedorQueFactura({ nombre: 'Migrado', factura: null }, 'guardar la factura');
    }).not.toThrow();
  });

  it('corta el paso al informal, diciendo qué se intentaba y dónde se corrige', () => {
    expect(() => {
      exigirProveedorQueFactura({ nombre: 'Don Chuy', factura: false }, 'capturar el documento');
    }).toThrow(/Don Chuy/);
    expect(() => {
      exigirProveedorQueFactura({ nombre: 'Don Chuy', factura: false }, 'capturar el documento');
    }).toThrow(/capturar el documento/);
    expect(() => {
      exigirProveedorQueFactura({ nombre: 'Don Chuy', factura: false }, 'capturar el documento');
    }).toThrow(/catálogo de proveedores/);
  });
});
