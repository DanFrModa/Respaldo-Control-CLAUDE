/** Tests UNITARIOS (sin BD) de las reglas puras del ETL de órdenes (F2-E5). */
import { describe, expect, it } from 'vitest';

import {
  esIdPedidosDetVacio,
  estadoOrdenMigrada,
  monarchEsDefaultDeModelo,
} from './ordenes-reglas.js';

describe('migración F2 · esIdPedidosDetVacio (orden sin pedido → idPedidoLinea NULL)', () => {
  it('0 y vacío cuentan como SIN pedido', () => {
    expect(esIdPedidosDetVacio('0')).toBe(true);
    expect(esIdPedidosDetVacio('')).toBe(true);
    expect(esIdPedidosDetVacio('  ')).toBe(true);
    expect(esIdPedidosDetVacio(null)).toBe(true);
    expect(esIdPedidosDetVacio(undefined)).toBe(true);
  });
  it('cualquier id real cuenta como CON pedido', () => {
    expect(esIdPedidosDetVacio('1')).toBe(false);
    expect(esIdPedidosDetVacio('5636')).toBe(false);
    expect(esIdPedidosDetVacio(' 42 ')).toBe(false);
  });
});

describe('migración F2 · monarchEsDefaultDeModelo (descartar el default automático)', () => {
  it('Monarch igual al código del modelo (caja-insensible) → descartar', () => {
    expect(monarchEsDefaultDeModelo('AB123', 'AB123')).toBe(true);
    expect(monarchEsDefaultDeModelo('ab123', 'AB123')).toBe(true);
    expect(monarchEsDefaultDeModelo('  AB123 ', 'AB123')).toBe(true);
  });
  it('Monarch distinto del código → valor real (migrar)', () => {
    expect(monarchEsDefaultDeModelo('PEDIDO-9981', 'AB123')).toBe(false);
    expect(monarchEsDefaultDeModelo('99-001', 'AB123')).toBe(false);
  });
  it('Monarch vacío → nada que migrar (descartar)', () => {
    expect(monarchEsDefaultDeModelo('', 'AB123')).toBe(true);
    expect(monarchEsDefaultDeModelo(null, 'AB123')).toBe(true);
    expect(monarchEsDefaultDeModelo('   ', 'AB123')).toBe(true);
  });
  it('sin código de modelo conocido → se trata como real (no se puede descartar)', () => {
    expect(monarchEsDefaultDeModelo('AB123', undefined)).toBe(false);
    expect(monarchEsDefaultDeModelo('AB123', '')).toBe(false);
  });
});

describe('migración F2 · estadoOrdenMigrada (estado histórico, sin re-sellar now())', () => {
  it('cancelada tiene prioridad sobre completa', () => {
    expect(estadoOrdenMigrada(true, true)).toBe('cancelada');
    expect(estadoOrdenMigrada(true, false)).toBe('cancelada');
  });
  it('con FechaDet (y sin cancelar) → completa', () => {
    expect(estadoOrdenMigrada(false, true)).toBe('completa');
  });
  it('sin nada → capturada', () => {
    expect(estadoOrdenMigrada(false, false)).toBe('capturada');
  });
});
