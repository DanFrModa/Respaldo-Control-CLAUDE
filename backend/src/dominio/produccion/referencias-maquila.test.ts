/**
 * ⭐ Fila 0.242 — la REGLA del tope, pura (sin base de datos): el 5 % en un solo sitio, la frontera
 * exacta en Decimal, la suma de los artes, y la excepción reservada que deja rastro. Las de
 * integración (`referencias-maquila.int.test.ts`) prueban las puertas contra Postgres.
 */
import { describe, expect, it, vi } from 'vitest';

import { ErrorConflicto } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import { Prisma } from '../../datos/index.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  FACTOR_TOPE_SOBREPRECIO,
  excedeTope,
  exigirPrecioDentroDelTope,
  sumarReferenciaDeArte,
  topeDeReferencia,
} from './referencias-maquila.js';

const D = (v: number | string) => new Prisma.Decimal(v);

describe('el tope: precio > referencia × 1.05', () => {
  it('el factor es 1.05 (Daniel: «pongamos 5 % de margen hacia arriba»)', () => {
    expect(FACTOR_TOPE_SOBREPRECIO.toString()).toBe('1.05');
  });

  it('la frontera es EXACTA en Decimal: 10.50 no excede, 10.51 sí', () => {
    expect(excedeTope(10.5, D(10))).toBe(false);
    expect(excedeTope('10.51', D(10))).toBe(true);
  });

  it('⭐ D2 (reviewer 0.242): compara el precio COMO SE GUARDA — 34.996 se guardaría 35.00 y excede', () => {
    // Referencia 33.33 ⇒ tope 34.9965. Sin redondear, 34.996 «no excede»; guardado es 35.00.
    expect(excedeTope('34.996', D('33.33'))).toBe(true);
    expect(excedeTope(34.996, D('33.33'))).toBe(true);
    // Y una fracción que redondea HACIA ABAJO al tope sigue pasando.
    expect(excedeTope('34.994', D('33.33'))).toBe(false);
  });

  it('sin freno hacia abajo: 0 y cualquier precio menor pasan', () => {
    expect(excedeTope(0, D(10))).toBe(false);
    expect(excedeTope(9.99, D(10))).toBe(false);
  });

  it('no sufre la aritmética binaria: 33.33 × 1.05 = 34.9965 → 34.99 pasa, 35.00 no', () => {
    expect(excedeTope(34.99, D('33.33'))).toBe(false);
    expect(excedeTope(35, D('33.33'))).toBe(true);
  });

  it('el tope que se ENSEÑA es el precio más alto que PASA (truncado a centavos, nunca hacia arriba)', () => {
    expect(topeDeReferencia(D(7)).toString()).toBe('7.35');
    expect(topeDeReferencia(D('33.33')).toString()).toBe('34.99');
    expect(excedeTope(topeDeReferencia(D('33.33')), D('33.33'))).toBe(false);
  });
});

describe('la referencia de ARTE: la SUMA de sus renglones vivos', () => {
  it('dos renglones de 3 y 4 ⇒ 7 (no el primero, no el mayor)', () => {
    const r = sumarReferenciaDeArte([{ precio: D(3) }, { precio: D(4) }]);
    expect(r.referencia?.toNumber()).toBe(7);
  });

  it('un renglón sin precio ⇒ sin referencia (no se suma la mitad)', () => {
    expect(sumarReferenciaDeArte([{ precio: D(3) }, { precio: null }])).toEqual({
      referencia: null,
      falta: 'arte-sin-precio',
    });
  });

  it('sin renglones ⇒ el arte no está en la orden', () => {
    expect(sumarReferenciaDeArte([])).toEqual({ referencia: null, falta: 'arte-sin-renglones' });
  });
});

describe('la excepción reservada', () => {
  function txDoble() {
    const tx = {
      ordenReferenciaEvento: { create: vi.fn(() => Promise.resolve({})) },
      bitacora: { create: vi.fn(() => Promise.resolve({})) },
    };
    return { tx, comoTx: tx as unknown as Tx };
  }
  const datos = {
    idOrden: 5,
    idTipoProceso: 1,
    nombre: 'Costura',
    referencia: D(10),
    punto: 'envio' as const,
  };

  it('dentro del tope: no escribe nada y no pide la llave', async () => {
    const { tx, comoTx } = txDoble();
    const s = sesionDePrueba({ permisos: [] });
    await expect(exigirPrecioDentroDelTope(comoTx, s, { ...datos, precio: 10.5 })).resolves.toBe(
      false,
    );
    expect(tx.ordenReferenciaEvento.create).not.toHaveBeenCalled();
  });

  it('arriba del tope SIN la llave: ErrorConflicto y no escribe el rastro', async () => {
    const { tx, comoTx } = txDoble();
    const s = sesionDePrueba({ permisos: ['ordenes.precio-maquila'] });
    await expect(
      exigirPrecioDentroDelTope(comoTx, s, { ...datos, precio: 11 }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(tx.ordenReferenciaEvento.create).not.toHaveBeenCalled();
    expect(tx.bitacora.create).not.toHaveBeenCalled();
  });

  it('arriba del tope CON la llave: pasa y deja el sobreprecio en el rastro y en la bitácora', async () => {
    const { tx, comoTx } = txDoble();
    const s = sesionDePrueba({ permisos: ['ordenes.autorizar-sobreprecio'] });
    await expect(exigirPrecioDentroDelTope(comoTx, s, { ...datos, precio: 11 })).resolves.toBe(
      true,
    );
    expect(tx.ordenReferenciaEvento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accion: 'sobreprecio',
        punto: 'envio',
        idTipoProceso: 1,
        precioAutorizado: D(11),
      }) as unknown,
    });
    expect(tx.bitacora.create).toHaveBeenCalledTimes(1);
  });
});
