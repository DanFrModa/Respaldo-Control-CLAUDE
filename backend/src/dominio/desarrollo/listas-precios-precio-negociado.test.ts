/**
 * ⭐⭐ Tests UNIT del CRITERIO de la fila 0.153 — *¿cuál es «el precio que quedó» de una negociación?*
 * SIN Postgres: `ultimoPrecioDeNegociacion` es una función PURA y aquí se le dan los eventos a mano.
 * El flujo real contra base (registrar un acuerdo y verlo salir en la lista) va en
 * `negociacion.int.test.ts`.
 *
 * Daniel, textual:
 *
 * > *«Después de haber cerrado la negociación de un modelo, debería de cambiar el precio que se ve
 * > afuera. Ese fue el precio que quedó… Está muy confuso cuál es el precio. **Dice precio aprobado,
 * > pero dentro de la negociación quedó otro.** Debe de haber congruencia.»*
 *
 * Lo que se blinda aquí:
 *  • 🔴 gana el **ÚLTIMO** evento que registró un precio (id mayor = lo último que pasó), sin
 *    depender del orden en que vengan los eventos;
 *  • 🔴 los eventos **sin precio no cuentan ni tapan** — cerrar o dropear un modelo escribe un
 *    evento con los dos precios en null (a propósito, `negociacion.ts`), y ese acto no puede borrar
 *    de la vista el precio con el que se cerró;
 *  • 🔴 sin ningún precio en el historial, **null**: la pantalla no inventa nada.
 */
import { describe, expect, it } from 'vitest';

import { Prisma } from '../../datos/index.js';

import { ultimoPrecioDeNegociacion } from './listas-precios.js';

const D = (n: number): Prisma.Decimal => new Prisma.Decimal(n);
const F = (dia: string): Date => new Date(`2026-09-${dia}T12:00:00.000Z`);

/** Un evento como los que escribe `negociacion.ts` (id, precio y cuándo). */
function evento(id: number, precio: number | null, dia = '01') {
  return { id, precioNuevo: precio === null ? null : D(precio), registradoEn: F(dia) };
}

describe('ultimoPrecioDeNegociacion — el criterio de «el precio que quedó»', () => {
  it('sin eventos → null (la pantalla no inventa nada)', () => {
    expect(ultimoPrecioDeNegociacion([])).toBeNull();
  });

  /**
   * 🔴 `cambiarEstadoRenglon` escribe su evento con `precioAnterior`/`precioNuevo` en **null a
   * propósito** (*"aquí no se movió ningún precio, y ponerle uno haría que el historial contara una
   * negociación que no pasó"*). Un renglón que sólo se abrió y se cerró no tiene precio negociado.
   */
  it('sólo eventos SIN precio (cambios de estado) → null', () => {
    expect(ultimoPrecioDeNegociacion([evento(1, null), evento(2, null)])).toBeNull();
  });

  it('un solo evento con precio → ese precio, con su fecha', () => {
    const r = ultimoPrecioDeNegociacion([evento(7, 95, '03')]);
    expect(r?.precio).toBe(95);
    expect(r?.registradoEn).toEqual(F('03'));
  });

  /**
   * ⭐ **LA PRUEBA DEL CRITERIO.** Tres precios en el hilo: gana el **último**, no el primero ni el
   * más caro ni el más barato. Es lo que hace que la pantalla de afuera diga lo MISMO que la última
   * fila del diálogo de adentro, que es la congruencia que Daniel pidió.
   */
  it('⭐ varios precios → gana el del evento MÁS RECIENTE (id mayor)', () => {
    const r = ultimoPrecioDeNegociacion([
      evento(1, 231, '01'),
      evento(2, 200, '02'),
      evento(3, 95, '03'),
    ]);
    expect(r?.precio).toBe(95);
    expect(r?.registradoEn).toEqual(F('03'));
  });

  /**
   * El criterio NO se apoya en el orden en que Prisma devuelva las filas: decide por `id`. Así, si
   * mañana alguien cambia el `orderBy` del include, el número que se enseña no cambia.
   */
  it('⭐ el orden en que llegan los eventos NO cambia el resultado', () => {
    const desordenados = [evento(3, 95, '03'), evento(1, 231, '01'), evento(2, 200, '02')];
    expect(ultimoPrecioDeNegociacion(desordenados)?.precio).toBe(95);
  });

  /**
   * ⭐⭐ **POR QUÉ ES «EL ÚLTIMO CON PRECIO» Y NO «EL ÚLTIMO A SECAS».** Se pacta 95, y DESPUÉS se
   * cierra el modelo (`cambiarEstadoRenglon` → evento sin precios). Si el criterio mirara el último
   * evento sin más, cerrar el modelo **borraría de la vista el precio con el que se cerró** — justo
   * lo contrario de lo que la fila 0.153 vino a arreglar.
   */
  it('🔴 un cierre de estado POSTERIOR no borra el precio pactado', () => {
    const r = ultimoPrecioDeNegociacion([evento(1, 95, '03'), evento(2, null, '04')]);
    expect(r?.precio).toBe(95);
    expect(r?.registradoEn).toEqual(F('03')); // la fecha es la del PRECIO, no la del cierre
  });

  /** Decimales: el precio sale como número, con sus centavos intactos. */
  it('conserva los centavos', () => {
    expect(ultimoPrecioDeNegociacion([evento(1, 92.25)])?.precio).toBe(92.25);
  });
});
