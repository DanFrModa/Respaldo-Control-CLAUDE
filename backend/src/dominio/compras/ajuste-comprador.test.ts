import { describe, expect, it } from 'vitest';

import { aplicarAjusteDelComprador, precioComunDelRenglon } from './ajuste-comprador.js';

/**
 * Unit de LA REGLA del ajuste del comprador (V1-E3z, §Post-F9.94) — SIN Postgres.
 *
 * Es la regla que decide con qué CANTIDAD y a qué PRECIO nace cada renglón de la orden de compra
 * cuando el comprador los corrige en la revisión previa. Se prueba aquí, entera, porque es donde
 * viven los casos feos que Daniel va a encontrar de verdad: el campo vacío, el cero, el número que
 * el redondeo se come. La generación y la previa llaman a ESTA función, así que lo que aquí queda
 * probado es lo mismo que se escribe en el documento.
 */
describe('V1-E3z — el ajuste del comprador: LA CANTIDAD (§Post-F9.86 + §Post-F9.94)', () => {
  it('sin ajuste, manda lo que propuso el sistema (y no se marca como ajustado)', () => {
    const r = aplicarAjusteDelComprador('Botón', 300, 2, undefined);
    expect(r.cantidadTotal).toBe(300);
    expect(r.cantidadAjustada).toBe(false);
    expect(r.bloqueos).toEqual([]);
  });

  it('un ajuste REEMPLAZA la propuesta (comprar el rollo completo)', () => {
    const r = aplicarAjusteDelComprador('Felpa', 45.4, 100, { cantidadTotal: 60 });
    expect(r.cantidadTotal).toBe(60);
    expect(r.cantidadAjustada).toBe(true);
    expect(r.bloqueos).toEqual([]);
  });

  it('⭐ BAJAR la cantidad se permite — es justo lo que Daniel pidió poder hacer', () => {
    const r = aplicarAjusteDelComprador('Felpa', 45, 100, { cantidadTotal: 10 });
    expect(r.cantidadTotal).toBe(10);
    expect(r.cantidadAjustada).toBe(true);
    expect(r.bloqueos).toEqual([]);
  });

  it('la cantidad se lleva a la escala de SU columna (2 decimales)', () => {
    expect(
      aplicarAjusteDelComprador('Felpa', 45, 100, { cantidadTotal: 60.126 }).cantidadTotal,
    ).toBe(60.13);
  });

  it('🔴 una cantidad que se guardaría como 0.00 BLOQUEA, y el bloqueo NOMBRA el material', () => {
    const r = aplicarAjusteDelComprador('Botón', 300, 2, { cantidadTotal: 0.004 });
    expect(r.bloqueos).toHaveLength(1);
    expect(r.bloqueos[0]).toContain('"Botón"');
    expect(r.bloqueos[0]).toContain('0.004');
    expect(r.bloqueos[0]).toContain('0.01');
  });

  it('0.01 exacto SÍ pasa (es el mínimo guardable, no un error)', () => {
    const r = aplicarAjusteDelComprador('Botón', 300, 2, { cantidadTotal: 0.01 });
    expect(r.cantidadTotal).toBe(0.01);
    expect(r.bloqueos).toEqual([]);
  });

  it('una propuesta chiquita SIN ajuste NO bloquea (el bloqueo es del número que se tecleó)', () => {
    // Sin ajuste no hay nada que reclamarle al comprador: el renglón simplemente no genera línea.
    const r = aplicarAjusteDelComprador('Botón', 0.004, 2, undefined);
    expect(r.bloqueos).toEqual([]);
    expect(r.cantidadAjustada).toBe(false);
  });
});

describe('V1-E3z — el ajuste del comprador: EL PRECIO (§Post-F9.94)', () => {
  it('sin ajuste, el precio es el que resolvió el sistema', () => {
    const r = aplicarAjusteDelComprador('Botón', 300, 2.5, undefined);
    expect(r.precioUnitario).toBe(2.5);
    expect(r.precioPropuesto).toBe(2.5);
    expect(r.precioAjustado).toBe(false);
  });

  it('⭐ el precio que teclea el comprador GANA, y lo propuesto se conserva para leer el desvío', () => {
    const r = aplicarAjusteDelComprador('Botón', 300, 2.5, { precioUnitario: 3.75 });
    expect(r.precioUnitario).toBe(3.75);
    expect(r.precioPropuesto).toBe(2.5);
    expect(r.precioAjustado).toBe(true);
    expect(r.bloqueos).toEqual([]);
  });

  it('se puede corregir SÓLO el precio, sin tocar la cantidad', () => {
    const r = aplicarAjusteDelComprador('Botón', 300, 2, { precioUnitario: 4 });
    expect(r.cantidadTotal).toBe(300);
    expect(r.cantidadAjustada).toBe(false);
    expect(r.precioUnitario).toBe(4);
    expect(r.precioAjustado).toBe(true);
  });

  it('se puede corregir SÓLO la cantidad, sin tocar el precio', () => {
    const r = aplicarAjusteDelComprador('Botón', 300, 2, { cantidadTotal: 500 });
    expect(r.cantidadTotal).toBe(500);
    expect(r.precioUnitario).toBe(2);
    expect(r.precioAjustado).toBe(false);
  });

  it('el precio se lleva a la escala de SU columna (2 decimales)', () => {
    expect(
      aplicarAjusteDelComprador('Botón', 300, 2, { precioUnitario: 33.333333 }).precioUnitario,
    ).toBe(33.33);
  });

  it('⭐ el CERO explícito es un ajuste válido: "la línea nace SIN precio"', () => {
    const r = aplicarAjusteDelComprador('Botón', 300, 2, { precioUnitario: 0 });
    expect(r.precioUnitario).toBe(0);
    expect(r.precioAjustado).toBe(true);
    expect(r.bloqueos).toEqual([]);
  });

  it('🔴 un precio que el redondeo convierte en 0.00 BLOQUEA (no es lo mismo que teclear 0)', () => {
    const r = aplicarAjusteDelComprador('Botón', 300, 2, { precioUnitario: 0.004 });
    expect(r.bloqueos).toHaveLength(1);
    expect(r.bloqueos[0]).toContain('"Botón"');
    expect(r.bloqueos[0]).toContain('0.004');
    // Y le dice cómo pedir "sin precio" a propósito.
    expect(r.bloqueos[0]).toContain('escribe 0');
  });

  it('0.01 exacto SÍ pasa como precio', () => {
    const r = aplicarAjusteDelComprador('Botón', 300, 2, { precioUnitario: 0.01 });
    expect(r.precioUnitario).toBe(0.01);
    expect(r.bloqueos).toEqual([]);
  });

  it('sin precio propuesto y sin ajuste, no hay precio que enseñar (null, no 0)', () => {
    const r = aplicarAjusteDelComprador('Botón', 300, null, undefined);
    expect(r.precioUnitario).toBeNull();
    expect(r.precioPropuesto).toBeNull();
  });

  it('sin precio propuesto, el comprador SÍ puede fijar uno (es el caso que más falta hacía)', () => {
    const r = aplicarAjusteDelComprador('Botón', 300, null, { precioUnitario: 12.5 });
    expect(r.precioUnitario).toBe(12.5);
    expect(r.precioPropuesto).toBeNull();
    expect(r.precioAjustado).toBe(true);
  });

  it('los dos ajustes a la vez, y los dos bloqueos si los dos son impagables', () => {
    const r = aplicarAjusteDelComprador('Botón', 300, 2, {
      cantidadTotal: 0.001,
      precioUnitario: 0.001,
    });
    expect(r.bloqueos).toHaveLength(2);
  });
});

describe('V1-E3z — el precio COMÚN de un renglón (varias OP en una línea)', () => {
  it('todas las líneas al mismo precio → ése es el precio del renglón', () => {
    expect(precioComunDelRenglon([2.5, 2.5, 2.5])).toBe(2.5);
  });

  it('🔴 precios DISTINTOS → null (no se inventa "el precio del renglón")', () => {
    expect(precioComunDelRenglon([2.5, 3])).toBeNull();
  });

  it('las colas largas se comparan YA redondeadas (33.333333 y 33.334 son el mismo 33.33)', () => {
    expect(precioComunDelRenglon([33.333333, 33.334])).toBe(33.33);
  });

  it('sin líneas no hay precio (null)', () => {
    expect(precioComunDelRenglon([])).toBeNull();
  });
});
