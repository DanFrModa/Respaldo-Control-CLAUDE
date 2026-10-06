import { describe, expect, it } from 'vitest';

import {
  ETIQUETA_MOSTRAR_CERRADAS,
  estaCerrada,
  foliosDeOrdenesCerradas,
  textoAvisoCerradasOcultas,
  textoAvisoOrdenCerrada,
} from './orden-cerrada';

describe('estaCerrada (0.226b)', () => {
  it('lee las tres formas del dato: cerradaEn, estado y el booleano aditivo', () => {
    expect(estaCerrada({ cerradaEn: '2026-10-01T10:00:00.000Z' })).toBe(true);
    expect(estaCerrada({ estado: 'cerrada' })).toBe(true);
    expect(estaCerrada({ ordenCerrada: true })).toBe(true);
  });

  it('abierta, o sin el dato, NO inventa un bloqueo', () => {
    expect(estaCerrada({ cerradaEn: null, estado: 'completa' })).toBe(false);
    expect(estaCerrada({ ordenCerrada: false })).toBe(false);
    expect(estaCerrada({})).toBe(false);
    expect(estaCerrada(undefined)).toBe(false);
    expect(estaCerrada(null)).toBe(false);
  });
});

describe('textoAvisoOrdenCerrada (0.226b)', () => {
  it('una orden: la nombra, dice que se consulta y cómo se mueve', () => {
    expect(textoAvisoOrdenCerrada([101])).toBe(
      'La orden 101 está cerrada: se puede consultar, pero no admite movimientos. Para moverla ' +
        'primero hay que reabrirla, y eso sólo lo puede hacer quien tiene el permiso de reabrir ' +
        'órdenes cerradas.',
    );
  });

  it('⭐ 0.228: dice QUIÉN puede reabrir, sin clave técnica (igual que el servidor)', () => {
    for (const texto of [textoAvisoOrdenCerrada([101]), textoAvisoOrdenCerrada([101, 102])]) {
      expect(texto).toContain('permiso de reabrir órdenes cerradas');
      expect(texto).not.toContain('ordenes.');
      expect(texto).not.toContain('desde la ficha');
    }
  });

  it('varias: las nombra TODAS una sola vez, en español', () => {
    expect(textoAvisoOrdenCerrada([101, 102, 101, 103])).toMatch(
      /^Las órdenes 101, 102 y 103 están cerradas/,
    );
  });
});

describe('foliosDeOrdenesCerradas (0.226b)', () => {
  it('junta sólo las cerradas, sin repetir, y usa el id si falta el folio', () => {
    expect(
      foliosDeOrdenesCerradas([
        { ordenCerrada: true, folioOrden: 7, idOrden: 1 },
        { ordenCerrada: false, folioOrden: 8, idOrden: 2 },
        { ordenCerrada: true, folioOrden: 7, idOrden: 1 },
        { ordenCerrada: true, folioOrden: null, idOrden: 3 },
      ]),
    ).toEqual([7, 3]);
  });

  it('sin el dato (`ordenCerrada` ausente o null) NO se cuenta como cerrada', () => {
    expect(
      foliosDeOrdenesCerradas([
        { folioOrden: 7, idOrden: 1 },
        { ordenCerrada: null, folioOrden: 8, idOrden: 2 },
        { ordenCerrada: undefined, folioOrden: 9, idOrden: 3 },
      ]),
    ).toEqual([]);
  });
});

describe('textoAvisoCerradasOcultas (0.227)', () => {
  it('una orden: la nombra, cita el interruptor tal cual y dice cómo moverla', () => {
    expect(textoAvisoCerradasOcultas([5424])).toBe(
      'La orden 5424 está cerrada: actívala con “Mostrar cerradas” para consultarla; para ' +
        'moverla hay que reabrirla.',
    );
  });

  it('varias: las une en español y habla en plural', () => {
    expect(textoAvisoCerradasOcultas([1, 2, 3])).toBe(
      'Las órdenes 1, 2 y 3 están cerradas: actívalas con “Mostrar cerradas” para ' +
        'consultarlas; para moverlas hay que reabrirlas.',
    );
  });

  it('si hay más de las nombradas, dice cuántas más (nunca las calla)', () => {
    expect(textoAvisoCerradasOcultas([10, 11], 7)).toContain('Las órdenes 10, 11 y 5 más');
    expect(textoAvisoCerradasOcultas([10], 2)).toContain('Las órdenes 10 y 1 más');
  });

  it('cita la MISMA etiqueta que lleva el interruptor', () => {
    expect(textoAvisoCerradasOcultas([1])).toContain(`“${ETIQUETA_MOSTRAR_CERRADAS}”`);
  });

  it('sin folios no dice nada', () => {
    expect(textoAvisoCerradasOcultas([])).toBe('');
  });
});
