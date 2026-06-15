import { describe, expect, it } from 'vitest';

import {
  mapearRolProveedorComercial,
  mapearTipoBordado,
  mapearTipoComponente,
  mapearTipoProveedor,
} from './mapeos-enum.js';

describe('migración · mapeos de enum (puros)', () => {
  describe('mapearTipoProveedor (TipoProv H/T/S)', () => {
    it('H→AVIOS, T→TELAS, S→SERVICIOS, vacío/desconocido→SIN_CLASIFICAR', () => {
      expect(mapearTipoProveedor('H')).toBe('AVIOS');
      expect(mapearTipoProveedor('T')).toBe('TELAS');
      expect(mapearTipoProveedor('S')).toBe('SERVICIOS');
      expect(mapearTipoProveedor('')).toBe('SIN_CLASIFICAR');
      expect(mapearTipoProveedor(null)).toBe('SIN_CLASIFICAR');
      expect(mapearTipoProveedor('X')).toBe('SIN_CLASIFICAR');
    });
    it('es insensible a mayúsculas y espacios', () => {
      expect(mapearTipoProveedor(' h ')).toBe('AVIOS');
      expect(mapearTipoProveedor('t')).toBe('TELAS');
    });
  });

  describe('mapearRolProveedorComercial (TipoProv → código de rol, F4/MRP)', () => {
    it('T→vende-telas, H→vende-avios, S/vacío/desconocido→otros-servicios', () => {
      expect(mapearRolProveedorComercial('T')).toBe('vende-telas');
      expect(mapearRolProveedorComercial('H')).toBe('vende-avios');
      expect(mapearRolProveedorComercial('S')).toBe('otros-servicios');
      expect(mapearRolProveedorComercial('')).toBe('otros-servicios');
      expect(mapearRolProveedorComercial(null)).toBe('otros-servicios');
      expect(mapearRolProveedorComercial('X')).toBe('otros-servicios');
    });
    it('es insensible a mayúsculas y espacios', () => {
      expect(mapearRolProveedorComercial(' t ')).toBe('vende-telas');
      expect(mapearRolProveedorComercial('h')).toBe('vende-avios');
    });
    it('SIEMPRE devuelve un código no vacío (cumple la regla ≥1 rol)', () => {
      for (const v of ['T', 'H', 'S', '', null, undefined, 'Z']) {
        expect(mapearRolProveedorComercial(v).length).toBeGreaterThan(0);
      }
    });
  });

  describe('mapearTipoBordado (BorEst)', () => {
    it('0/vacío→BORDADO, distinto de 0→ESTAMPADO', () => {
      expect(mapearTipoBordado('0')).toBe('BORDADO');
      expect(mapearTipoBordado('')).toBe('BORDADO');
      expect(mapearTipoBordado(null)).toBe('BORDADO');
      expect(mapearTipoBordado('1')).toBe('ESTAMPADO');
      expect(mapearTipoBordado('-1')).toBe('ESTAMPADO');
    });
  });

  describe('mapearTipoComponente (Texto1/Texto2)', () => {
    it('detecta CARDIGAN, CUERPO o cae en OTRO', () => {
      expect(mapearTipoComponente('Felpa', 'Cardigan')).toBe('CARDIGAN');
      expect(mapearTipoComponente('Cuerpo', '')).toBe('CUERPO');
      expect(mapearTipoComponente('Terry', '')).toBe('CUERPO');
      expect(mapearTipoComponente('algo raro', 'otra cosa')).toBe('OTRO');
      expect(mapearTipoComponente(null, null)).toBe('OTRO');
    });
  });
});
