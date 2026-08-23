import { describe, expect, it } from 'vitest';

import {
  mapearRolProveedorComercial,
  mapearTipoArte,
  mapearTipoComponente,
  mapearUnidadTela,
  rolesDeMaquilero,
} from './mapeos-enum.js';

describe('migración · mapeos de enum (puros)', () => {
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

  describe('rolesDeMaquilero (Costura/Proceso → roles; Proceso = decorado)', () => {
    it('Costura → maquila-costura', () => {
      expect(rolesDeMaquilero(true, false)).toEqual(['maquila-costura']);
    });
    it('Proceso (decorado) → estampado, NO maquila-costura', () => {
      const roles = rolesDeMaquilero(false, true);
      expect(roles).toContain('estampado');
      expect(roles).not.toContain('maquila-costura');
    });
    it('ambas banderas → ambos roles', () => {
      const roles = rolesDeMaquilero(true, true);
      expect(roles).toContain('maquila-costura');
      expect(roles).toContain('estampado');
      expect(roles).toHaveLength(2);
    });
    it('ninguna bandera → maquila-costura (≥1 rol garantizado)', () => {
      expect(rolesDeMaquilero(false, false)).toEqual(['maquila-costura']);
    });
  });

  describe('mapearTipoArte (BorEst)', () => {
    // V1-E3f: devuelve el CÓDIGO del catálogo único (`TipoProceso.codigo`), no el enum retirado.
    it('0/vacío→bordado, distinto de 0→estampado', () => {
      expect(mapearTipoArte('0')).toBe('bordado');
      expect(mapearTipoArte('')).toBe('bordado');
      expect(mapearTipoArte(null)).toBe('bordado');
      expect(mapearTipoArte('1')).toBe('estampado');
      expect(mapearTipoArte('-1')).toBe('estampado');
      expect(mapearTipoArte('sí')).toBe('estampado');
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

describe('mapearUnidadTela', () => {
  // El mapeo NO se adivinó: el combo del formulario viejo `AgregarTelas` lo declara literal
  // (`-1;"Kilos";0;"Metros"`) y `ExisTela` lo confirma ("Si=Kilos, No=Metros").
  it('la bandera de Access: verdadero = kilos, falso = metros', () => {
    expect(mapearUnidadTela('1')).toBe('KG');
    expect(mapearUnidadTela('-1')).toBe('KG');
    expect(mapearUnidadTela('0')).toBe('M');
  });

  it('sin dato cae en metros (es el valor "falso" del Access, no un default inventado)', () => {
    expect(mapearUnidadTela('')).toBe('M');
    expect(mapearUnidadTela(undefined)).toBe('M');
  });
});
