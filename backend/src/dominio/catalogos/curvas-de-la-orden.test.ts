/**
 * Pruebas del AVISO de curva distinta (V1-E3r, §Post-F9.81 punto 2). La parte pura: la redacción.
 *
 * 🔴 Lo que estas pruebas defienden, además del texto, es que la función **jamás lanza**: Daniel
 * eligió *"que me diga"* sobre *"que no me deje"* (§Post-F9.64 — la curva es una guía, no una jaula).
 */
import { describe, expect, it } from 'vitest';

import {
  avisoCurvaDistinta,
  ladoDelModelo,
  ladoDeUnaOrden,
  ladoDeVariasOrdenes,
  nombreDeterministaCurva,
} from './curvas-de-la-orden.js';

const caballero = ladoDelModelo('Caballero básica', ['XC', 'CH', 'M', 'G', 'XG']);

describe('avisoCurvaDistinta — el aviso lo redacta el SERVIDOR (A1)', () => {
  describe('cuándo NO hay nada que avisar', () => {
    it('los mismos conjuntos → null', () => {
      const aviso = avisoCurvaDistinta(
        caballero,
        ladoDeUnaOrden('Caballero básica', ['XC', 'CH', 'M', 'G', 'XG']),
      );
      expect(aviso).toBeNull();
    });

    it('el mismo conjunto en OTRO orden tampoco es contradicción', () => {
      // La secuencia de captura la manda cada lado: la curva su posición y la orden su matriz.
      expect(
        avisoCurvaDistinta(caballero, ladoDeUnaOrden('x', ['XG', 'G', 'M', 'CH', 'XC'])),
      ).toBeNull();
    });

    it('el modelo SIN curva → null (no hay dos curvas: hay un hueco, y lo llena la propuesta)', () => {
      expect(avisoCurvaDistinta(ladoDelModelo(null, []), ladoDeUnaOrden('x', ['3M']))).toBeNull();
      expect(
        avisoCurvaDistinta(ladoDelModelo('Vacía', []), ladoDeUnaOrden('x', ['3M'])),
      ).toBeNull();
    });

    it('la orden SIN matriz todavía → null (no hay con qué comparar)', () => {
      expect(avisoCurvaDistinta(caballero, ladoDeUnaOrden('x', []))).toBeNull();
    });
  });

  describe('el caso de Daniel: curva de caballero contra una OC de bebés', () => {
    const bebe = ladoDeUnaOrden('Curva 3M-6M-9M-12-18', ['3M', '6M', '9M', '12', '18']);
    const aviso = avisoCurvaDistinta(caballero, bebe);

    it('avisa', () => {
      expect(aviso).not.toBeNull();
    });

    it('nombra las DOS curvas (era la queja: si no, hay que ir a buscarlo a otra pantalla)', () => {
      expect(aviso?.texto).toContain('Caballero básica');
      expect(aviso?.texto).toContain('Curva 3M-6M-9M-12-18');
    });

    it('dice qué sobra y qué falta, EN LAS DOS DIRECCIONES', () => {
      expect(aviso?.sobran).toEqual(['3M', '6M', '9M', '12', '18']);
      expect(aviso?.faltan).toEqual(['XC', 'CH', 'M', 'G', 'XG']);
      expect(aviso?.texto).toContain('3M, 6M, 9M, 12, 18');
      expect(aviso?.texto).toContain('XC, CH, M, G, XG');
    });

    it('deja claro que NO bloquea y que manda la orden', () => {
      expect(aviso?.texto).toContain('No bloquea');
    });
  });

  describe('las dos direcciones por separado', () => {
    it('sólo SOBRAN (la orden pide una talla de más — el caso legítimo de §Post-F9.64)', () => {
      const aviso = avisoCurvaDistinta(
        ladoDelModelo('Dama', ['CH', 'M', 'G']),
        ladoDeUnaOrden('Curva CH-M-G-XG', ['CH', 'M', 'G', 'XG']),
      );
      expect(aviso?.sobran).toEqual(['XG']);
      expect(aviso?.faltan).toEqual([]);
      expect(aviso?.texto).not.toContain('que la orden no pide');
    });

    it('sólo FALTAN (la orden pide menos tallas que la curva)', () => {
      const aviso = avisoCurvaDistinta(
        ladoDelModelo('Dama', ['CH', 'M', 'G']),
        ladoDeUnaOrden('Curva CH-M', ['CH', 'M']),
      );
      expect(aviso?.faltan).toEqual(['G']);
      expect(aviso?.sobran).toEqual([]);
      expect(aviso?.texto).not.toContain('que la curva no trae');
    });
  });

  describe('el singular/plural lo resuelve el SERVIDOR, no el cliente', () => {
    it('una sola talla → "1 talla"', () => {
      const aviso = avisoCurvaDistinta(
        ladoDelModelo('Dama', ['CH', 'M', 'G']),
        ladoDeUnaOrden('x', ['CH', 'M', 'G', 'XG']),
      );
      expect(aviso?.texto).toContain('1 talla que');
      expect(aviso?.texto).not.toContain('1 tallas');
    });

    it('varias → "N tallas"', () => {
      const aviso = avisoCurvaDistinta(
        ladoDelModelo('Dama', ['CH']),
        ladoDeUnaOrden('x', ['CH', 'M', 'G']),
      );
      expect(aviso?.texto).toContain('2 tallas');
    });
  });

  describe('el rótulo del lado ORDEN, según desde dónde se mire', () => {
    it('desde UNA orden habla de "esta orden"', () => {
      expect(ladoDeUnaOrden('Curva CH-M', ['CH', 'M']).nombre).toContain('esta orden');
    });

    it('desde el MODELO dice CUÁNTAS órdenes la usan (singular)', () => {
      expect(ladoDeVariasOrdenes('Curva CH-M', 1, ['CH', 'M']).nombre).toContain('de 1 orden');
    });

    it('desde el MODELO dice CUÁNTAS órdenes la usan (plural)', () => {
      expect(ladoDeVariasOrdenes('Curva CH-M', 7, ['CH', 'M']).nombre).toContain('de 7 órdenes');
    });
  });

  it('el nombre determinista es el MISMO que usó el ETL (así no se duplica la curva)', () => {
    expect(nombreDeterministaCurva(['CH', 'M', 'G', 'EX'])).toBe('Curva CH-M-G-EX');
  });
});
