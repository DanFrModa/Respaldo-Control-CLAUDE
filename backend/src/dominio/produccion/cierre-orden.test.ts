/**
 * 0.226a (§Post-F9.244) — la guarda de la orden CERRADA, en lo que se puede probar sin Postgres: el
 * MENSAJE único y central (una y varias órdenes) y que el error siga siendo un `ErrorConflicto` (409,
 * contrato de errores intacto). El candado y las puertas viven en `orden-cerrada-puertas.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { ErrorConflicto, esErrorDominio } from '../../comun/errores.js';

import * as cierreOrden from './cierre-orden.js';
import {
  ErrorOrdenCerrada,
  exigirOrdenesAbiertas,
  mensajeOrdenCerrada,
  NAMESPACE_LOCK_CIERRE_ORDEN,
} from './cierre-orden.js';
import type { Tx } from '../../comun/transaccion.js';

describe('mensajeOrdenCerrada: le dice al usuario QUÉ orden y CÓMO salir', () => {
  it('con UNA orden nombra el folio, qué se intentaba y que hay que reabrirla', () => {
    const m = mensajeOrdenCerrada([1515n], 'le puede sacar tela');
    expect(m).toBe(
      'La orden 1515 está CERRADA (su costo quedó congelado): no se le puede sacar tela. Si de ' +
        'verdad hay que moverla, reábrela primero (permiso "ordenes.cerrar") — queda auditado.',
    );
  });

  it('con VARIAS órdenes las nombra TODAS, en plural y sin repetir', () => {
    const m = mensajeOrdenCerrada([12n, 15n, 12n, 20n], 'le puede comprar material');
    expect(m).toContain('Las órdenes 12, 15 y 20 están CERRADAS');
    expect(m).toContain('no se le puede comprar material');
    expect(m).toContain('reábrelas primero');
  });

  it('con DOS usa «y» sin coma', () => {
    expect(mensajeOrdenCerrada([3, 4], 'x')).toContain('Las órdenes 3 y 4 están CERRADAS');
  });
});

describe('ErrorOrdenCerrada', () => {
  it('ES un ErrorConflicto (409, código CONFLICTO) con nombre propio y sus folios', () => {
    const e = new ErrorOrdenCerrada([7n, 9n], 'algo');
    expect(e).toBeInstanceOf(ErrorConflicto);
    expect(esErrorDominio(e)).toBe(true);
    expect(e.codigo).toBe('CONFLICTO');
    expect(e.name).toBe('ErrorOrdenCerrada');
    expect(e.folios).toEqual(['7', '9']);
  });

  it('🔴 la guarda «pura» SIN candado ya no existe (era una trampa a un import de distancia)', () => {
    expect(Object.keys(cierreOrden)).not.toContain('exigirOrdenAbierta');
  });
});

describe('exigirOrdenesAbiertas (con un tx simulado): candado ANTES de leer, ascendente, sin repetir', () => {
  function txFalso(cerradas: { folio: bigint }[]): { tx: Tx; pasos: string[] } {
    const pasos: string[] = [];
    const tx = {
      $executeRaw: (sql: TemplateStringsArray, ...valores: unknown[]) => {
        pasos.push(
          `${sql.join('?').includes('_shared') ? 'shared' : 'excl'}:${String(valores[1])}`,
        );
        expect(valores[0]).toBe(NAMESPACE_LOCK_CIERRE_ORDEN);
        return Promise.resolve(1);
      },
      orden: {
        findMany: () => {
          pasos.push('leer');
          return Promise.resolve(cerradas);
        },
      },
    } as unknown as Tx;
    return { tx, pasos };
  }

  it('toma el COMPARTIDO por cada orden en orden ascendente y DESPUÉS lee', async () => {
    const { tx, pasos } = txFalso([]);
    await exigirOrdenesAbiertas(tx, 1, [9, null, 3, 9, undefined, 5], 'x');
    expect(pasos).toEqual(['shared:3', 'shared:5', 'shared:9', 'leer']);
  });

  it('sin órdenes (todo null) no toca la base', async () => {
    const { tx, pasos } = txFalso([]);
    await exigirOrdenesAbiertas(tx, 1, [null, undefined], 'x');
    expect(pasos).toEqual([]);
  });

  it('si hay cerradas lanza UN error que las nombra todas', async () => {
    const { tx } = txFalso([{ folio: 15n }, { folio: 12n }]);
    await expect(exigirOrdenesAbiertas(tx, 1, [1, 2], 'le puede comprar material')).rejects.toThrow(
      /Las órdenes 15 y 12 están CERRADAS/,
    );
  });
});
