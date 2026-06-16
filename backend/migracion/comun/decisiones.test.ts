import { describe, expect, it } from 'vitest';

import { cruzarTelas, decidirPrecioAvio } from './decisiones.js';

describe('migración · decisiones puras', () => {
  describe('decidirPrecioAvio (fallback de precio, ADR-0009)', () => {
    it('CON match → renglón AvioProveedor con precio, SIN precioReferencia', () => {
      expect(decidirPrecioAvio(7, 0.5)).toEqual({
        proveedor: { idProveedor: 7, precio: 0.5 },
        precioReferencia: undefined,
      });
    });
    it('SIN match → precio va a precioReferencia (no se pierde)', () => {
      expect(decidirPrecioAvio(undefined, 0.5)).toEqual({
        proveedor: null,
        precioReferencia: 0.5,
      });
    });
    it('precio null sin match → ni renglón ni referencia', () => {
      expect(decidirPrecioAvio(undefined, null)).toEqual({
        proveedor: null,
        precioReferencia: undefined,
      });
    });
    it('precio null con match → renglón sin precio', () => {
      expect(decidirPrecioAvio(7, null)).toEqual({
        proveedor: { idProveedor: 7 },
        precioReferencia: undefined,
      });
    });
    it('clava precios negativos a 0', () => {
      expect(decidirPrecioAvio(7, -5).proveedor).toEqual({ idProveedor: 7, precio: 0 });
      expect(decidirPrecioAvio(undefined, -5).precioReferencia).toBe(0);
    });
  });

  describe('cruzarTelas (unificación Telas ↔ TelasDis por nombre, ADR-0009)', () => {
    it('clasifica en común / solo-Telas / solo-TelasDis (ambos sentidos)', () => {
      const r = cruzarTelas(['felpa100', 'jersey', 'rib'], ['felpa100', 'lycra']);
      expect(r.enComun.sort()).toEqual(['felpa100']);
      expect(r.soloTelas.sort()).toEqual(['jersey', 'rib']);
      expect(r.soloTelasDis.sort()).toEqual(['lycra']);
    });
    it('sin intersección: todo queda en su lado', () => {
      const r = cruzarTelas(['a'], ['b']);
      expect(r.enComun).toEqual([]);
      expect(r.soloTelas).toEqual(['a']);
      expect(r.soloTelasDis).toEqual(['b']);
    });
  });
});
