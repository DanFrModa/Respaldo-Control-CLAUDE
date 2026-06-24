/**
 * Pruebas unitarias del emparejado DETERMINISTA de pares de traspaso de tela (F4-E6, Pieza B).
 *
 * Los fixtures incluyen un PAR REAL extraído del dump (Entrada 5927 'Transferencia' ↔ Salida 12088
 * sin orden, misma fecha/tela, mismas cantidades por color, distinto almacén) y un caso de
 * cardinalidad desigual que NO debe parearse.
 */
import { describe, expect, it } from 'vitest';

import { emparejarTraspasos, firmaDocumento, type DocumentoTela } from './pares-traspaso-tela.js';

/** Construye un documento de prueba con un solo renglón. */
function doc(
  id: string,
  fecha: string,
  idTela: string,
  idTelasColores: string,
  idAlmacen: string,
  cant1: string,
  cant2: string,
): DocumentoTela {
  return {
    id,
    fecha,
    idTela,
    renglones: [{ idTelasColAlm: `ca-${id}`, idTelasColores, idAlmacen, cant1, cant2 }],
  };
}

describe('firmaDocumento', () => {
  it('IGNORA el almacén (origen y destino difieren) pero conserva fecha/tela/color/cantidades', () => {
    const entrada = doc('5927', '2020-12-09', '717', '2948', 'A', '1169.50', '57.50');
    const salida = doc('12088', '2020-12-09', '717', '2948', 'B', '1169.50', '57.50');
    // Mismo color y cantidades, distinto almacén → MISMA firma (parean).
    expect(firmaDocumento(entrada)).toBe(firmaDocumento(salida));
  });

  it('es ESTABLE ante el orden de los renglones (los ordena)', () => {
    const a: DocumentoTela = {
      id: '1',
      fecha: '2021-01-01',
      idTela: '10',
      renglones: [
        { idTelasColAlm: 'x', idTelasColores: '100', idAlmacen: 'A', cant1: '5', cant2: '0' },
        { idTelasColAlm: 'y', idTelasColores: '200', idAlmacen: 'A', cant1: '3', cant2: '1' },
      ],
    };
    const b: DocumentoTela = {
      id: '2',
      fecha: '2021-01-01',
      idTela: '10',
      renglones: [
        { idTelasColAlm: 'z', idTelasColores: '200', idAlmacen: 'B', cant1: '3', cant2: '1' },
        { idTelasColAlm: 'w', idTelasColores: '100', idAlmacen: 'B', cant1: '5', cant2: '0' },
      ],
    };
    expect(firmaDocumento(a)).toBe(firmaDocumento(b));
  });
});

describe('emparejarTraspasos', () => {
  it('parea 1:1 el PAR REAL (Entrada 5927 ↔ Salida 12088) y marca la salida como usada', () => {
    const entrada = doc('5927', '2020-12-09', '717', '2948', 'A', '1169.50', '57.50');
    const salida = doc('12088', '2020-12-09', '717', '2948', 'B', '1169.50', '57.50');
    const { pares, entradasSinPar, idsSalidaUsados } = emparejarTraspasos([entrada], [salida]);
    expect(pares).toHaveLength(1);
    expect(pares[0]?.entrada.id).toBe('5927');
    expect(pares[0]?.salida.id).toBe('12088');
    expect(entradasSinPar).toHaveLength(0);
    expect(idsSalidaUsados.has('12088')).toBe(true);
  });

  it('parea por ORDEN dentro de un grupo de firma con igual cardinalidad', () => {
    // Dos entradas y dos salidas con la MISMA firma → parean por id ascendente.
    const e1 = doc('100', '2021-05-01', '5', '50', 'A', '10', '0');
    const e2 = doc('200', '2021-05-01', '5', '50', 'A', '10', '0');
    const s1 = doc('300', '2021-05-01', '5', '50', 'B', '10', '0');
    const s2 = doc('400', '2021-05-01', '5', '50', 'B', '10', '0');
    const { pares } = emparejarTraspasos([e2, e1], [s2, s1]);
    expect(pares).toHaveLength(2);
    expect(pares.map((p) => [p.entrada.id, p.salida.id]).sort()).toEqual([
      ['100', '300'],
      ['200', '400'],
    ]);
  });

  it('NO parea cuando la cardinalidad difiere (2 entradas, 1 salida) — se reportan sin par', () => {
    const e1 = doc('1', '2021-01-01', '5', '50', 'A', '10', '0');
    const e2 = doc('2', '2021-01-01', '5', '50', 'A', '10', '0');
    const s1 = doc('3', '2021-01-01', '5', '50', 'B', '10', '0');
    const { pares, entradasSinPar, idsSalidaUsados } = emparejarTraspasos([e1, e2], [s1]);
    expect(pares).toHaveLength(0);
    expect(entradasSinPar.map((e) => e.id).sort()).toEqual(['1', '2']);
    expect(idsSalidaUsados.size).toBe(0);
  });

  it('una entrada Transferencia sin salida gemela queda sin par', () => {
    const e1 = doc('1', '2021-01-01', '5', '50', 'A', '10', '0');
    const { pares, entradasSinPar } = emparejarTraspasos([e1], []);
    expect(pares).toHaveLength(0);
    expect(entradasSinPar).toHaveLength(1);
  });
});
