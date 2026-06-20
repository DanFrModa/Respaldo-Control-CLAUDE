/**
 * Unit (sin BD) de los helpers PUROS del loader de kardex IPT (F3-E6 Pieza B):
 *  • `tipoDestino`: decisión del código de tipo de movimiento a partir de IdIPT_TipoMov + EnSa.
 *  • `construirObservaciones`: obs + referencia + IdRecibos (traza, no FK).
 */
import { describe, expect, it } from 'vitest';

import { construirObservaciones, tipoDestino, type MovCrudo } from './ipt-kardex.js';

describe('tipoDestino — mapeo IdIPT_TipoMov + EnSa → código de v2', () => {
  it('tipo conocido cuya dirección casa con EnSa → su código (caso normal)', () => {
    // 1 = inventario-inicial (entrada), EnSa 1.
    expect(tipoDestino(1, 1)).toEqual({
      codigo: 'inventario-inicial',
      discordante: false,
      vacio: false,
    });
    // 5 = entrega-cliente (salida), EnSa 2.
    expect(tipoDestino(5, 2)).toEqual({
      codigo: 'entrega-cliente',
      discordante: false,
      vacio: false,
    });
  });

  it('tipo 0/vacío → Otras Entradas/Salidas según EnSa (vacio=true)', () => {
    expect(tipoDestino(0, 1)).toEqual({
      codigo: 'otras-entradas',
      discordante: false,
      vacio: true,
    });
    expect(tipoDestino(null, 2)).toEqual({
      codigo: 'otras-salidas',
      discordante: false,
      vacio: true,
    });
  });

  it('tipo 9 (traspaso, dir 3) NO casa con EnSa → Otras por EnSa (discordante=true)', () => {
    expect(tipoDestino(9, 1)).toEqual({
      codigo: 'otras-entradas',
      discordante: true,
      vacio: false,
    });
    expect(tipoDestino(9, 2)).toEqual({ codigo: 'otras-salidas', discordante: true, vacio: false });
  });

  it('tipo desconocido (fuera de 1..19) → Otras por EnSa (discordante=true)', () => {
    expect(tipoDestino(99, 1)).toEqual({
      codigo: 'otras-entradas',
      discordante: true,
      vacio: false,
    });
  });

  it('EnSa inválido sin código de respaldo → null (irresoluble)', () => {
    expect(tipoDestino(0, 3)).toBeNull();
    expect(tipoDestino(99, null)).toBeNull();
  });

  it('error-entrada (tipo 11, dir salida) casa con EnSa 2', () => {
    expect(tipoDestino(11, 2)).toEqual({
      codigo: 'error-entrada',
      discordante: false,
      vacio: false,
    });
  });
});

describe('construirObservaciones', () => {
  const base: MovCrudo = {
    fecha: null,
    idTipoMov: 1,
    enSa: 1,
    idAlmacenV1: '1',
    referencia: null,
    obs: null,
    idRecibos: null,
  };

  it('junta obs + referencia + IdRecibos como traza', () => {
    const texto = construirObservaciones({
      ...base,
      obs: 'Inventario Inicial',
      referencia: 'Inv 2020',
      idRecibos: '555',
    });
    expect(texto).toContain('Inventario Inicial');
    expect(texto).toContain('Ref: Inv 2020');
    expect(texto).toContain('[v1 IdRecibos=555]');
  });

  it('no duplica la referencia cuando es igual a la observación', () => {
    const texto = construirObservaciones({ ...base, obs: 'igual', referencia: 'igual' });
    expect(texto).toBe('igual');
  });

  it('todo vacío → null', () => {
    expect(construirObservaciones(base)).toBeNull();
  });

  it('solo IdRecibos → solo la traza', () => {
    expect(construirObservaciones({ ...base, idRecibos: '777' })).toBe('[v1 IdRecibos=777]');
  });
});
