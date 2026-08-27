/**
 * ⭐⭐ **«CON ESTO QUEDA CUBIERTO»** (V1-E8e, §Post-F9.99) — pruebas de las piezas PURAS: el
 * **criterio único** de *"¿qué falta comprar?"*, la lectura de la marca por *(orden, material,
 * color)* y el **reparto por OP** del faltante.
 *
 * 🔴 **Lo que estas pruebas sostienen, y por qué importa:** la etapa se rompería sola si el criterio
 * viviera escrito dos veces (uno se quedaría atrás y la explosión y la revisión previa dirían
 * números distintos sobre lo mismo — el defecto exacto de §Post-F9.85) o si la marca no llevara el
 * COLOR en su identidad (cubriría el cierre rojo y seguiría pidiendo los otros tres, §Post-F9.126).
 * Las dos cosas se fijan aquí, sin base de datos.
 */
import { describe, expect, it } from 'vitest';

import { pendienteDeComprar } from './comprometido-en-oc.js';
import {
  cubiertoDe,
  repartoDadoPorCubierto,
  type CubiertoPorOrden,
  type LineaParaCubrir,
} from './dado-por-cubierto.js';

describe('pendienteDeComprar — UN criterio: comprometido + dado por cubierto ≥ requerido', () => {
  it('EL CASO DE DANIEL: 481 requeridos, 480 comprados y 1 dado por cubierto ⇒ NO falta nada', () => {
    // *"compré 480 en lugar de 481… y me sigue poniendo que me falta comprar 1 kilo"*.
    expect(pendienteDeComprar(481, 480, 0)).toBe(1);
    expect(pendienteDeComprar(481, 480, 1)).toBe(0);
  });

  it('el faltante SOBREVIVE mientras nadie lo dé por cubierto (el default no cierra nada)', () => {
    expect(pendienteDeComprar(481, 480, 0)).toBe(1);
  });

  it('lo dado por cubierto NO se suma sólo cuando hay compra: cubre por sí solo', () => {
    // Un renglón que nadie compró pero que alguien cerró entero deja de pedirse.
    expect(pendienteDeComprar(45, 0, 45)).toBe(0);
    expect(pendienteDeComprar(45, 0, 20)).toBe(25);
  });

  it('nunca es negativo: cubrir de más no genera un "sobrante" que reste en otro lado', () => {
    expect(pendienteDeComprar(45, 40, 20)).toBe(0);
  });

  it('sale a la escala de la columna de la OC (2 decimales), no a la del snapshot', () => {
    // 🔴 Sin este redondeo, un requerido de 3.7020 contra una línea guardada de 3.70 dejaba 0.002
    // "pendientes" que ninguna columna puede guardar, y el renglón volvía a ofrecerse para siempre.
    expect(pendienteDeComprar(3.702, 3.7, 0)).toBe(0);
    expect(pendienteDeComprar(0.1 + 0.2, 0, 0)).toBe(0.3);
  });
});

describe('cubiertoDe — la marca se busca por *(orden, material, COLOR)*', () => {
  /** Mapa como el que devuelve `dadoPorCubierto`: `idOrden → (claveMaterialColor → cantidad)`. */
  const mapa: CubiertoPorOrden = new Map([
    [
      50,
      new Map([
        ['avio-3|7', 4],
        ['avio-3|9', 11],
        ['tela-1|sin', 1],
      ]),
    ],
  ]);

  it('⭐ el cierre ROJO cubierto NO cubre al azul (el color está en la identidad)', () => {
    const cierre = { idTela: null, idAvio: 3, idTelaColor: null, idColorPrenda: 7 };
    const cierreAzul = { idTela: null, idAvio: 3, idTelaColor: null, idColorPrenda: 9 };
    expect(cubiertoDe(mapa, 50, cierre)).toBe(4);
    expect(cubiertoDe(mapa, 50, cierreAzul)).toBe(11);
  });

  it('un color que nadie cubrió da 0 — y una orden distinta también', () => {
    const cierreVerde = { idTela: null, idAvio: 3, idTelaColor: null, idColorPrenda: 12 };
    expect(cubiertoDe(mapa, 50, cierreVerde)).toBe(0);
    const cierre = { idTela: null, idAvio: 3, idTelaColor: null, idColorPrenda: 7 };
    expect(cubiertoDe(mapa, 51, cierre)).toBe(0);
  });

  it('la TELA usa su propio color, y el renglón SIN color tiene su propia cubeta', () => {
    const felpaSinColor = { idTela: 1, idAvio: null, idTelaColor: null, idColorPrenda: null };
    const felpaMarino = { idTela: 1, idAvio: null, idTelaColor: 4, idColorPrenda: null };
    expect(cubiertoDe(mapa, 50, felpaSinColor)).toBe(1);
    expect(cubiertoDe(mapa, 50, felpaMarino)).toBe(0);
  });

  it('la tela 3 y el avío 3 son materiales DISTINTOS: no se confunden por el número', () => {
    const tela3 = { idTela: 3, idAvio: null, idTelaColor: 7, idColorPrenda: null };
    expect(cubiertoDe(mapa, 50, tela3)).toBe(0);
  });
});

describe('repartoDadoPorCubierto — a qué OP le toca cada pedazo del faltante', () => {
  const linea = (over: Partial<LineaParaCubrir> = {}): LineaParaCubrir => ({
    idOrden: 50,
    cantidadPropuesta: 100,
    cantidad: 100,
    seEscribe: true,
    ...over,
  });

  it('sin faltante no devuelve NADA (comprar completo no cubre nada)', () => {
    expect(repartoDadoPorCubierto([linea()])).toEqual([]);
  });

  it('el faltante de cada OP es lo que se le proponía menos lo que se le va a comprar', () => {
    expect(
      repartoDadoPorCubierto([
        linea({ idOrden: 50, cantidadPropuesta: 300, cantidad: 200 }),
        linea({ idOrden: 51, cantidadPropuesta: 181, cantidad: 180 }),
      ]),
    ).toEqual([
      { idOrden: 50, cantidad: 100 },
      { idOrden: 51, cantidad: 1 },
    ]);
  });

  it('⭐ una línea que NO se escribe cuenta como comprada en CERO, no como comprada', () => {
    // 🔴 Bajar el total puede dejar a una OP en `0.004`, que la generación se salta. Si esa OP se
    // diera por cubierta sólo por su diferencia, se quedaría con una astilla pendiente PARA SIEMPRE.
    expect(
      repartoDadoPorCubierto([linea({ cantidadPropuesta: 50, cantidad: 0.004, seEscribe: false })]),
    ).toEqual([{ idOrden: 50, cantidad: 50 }]);
  });

  it('un faltante que no sobrevive al guardarse (< 0.01) no genera acto', () => {
    // Un acto de 0.004 sería un renglón de bitácora sobre una cantidad que ninguna columna guarda.
    expect(repartoDadoPorCubierto([linea({ cantidadPropuesta: 100.004, cantidad: 100 })])).toEqual(
      [],
    );
  });

  it('comprar de MÁS (el rollo completo) no deja faltante ni lo vuelve negativo', () => {
    expect(repartoDadoPorCubierto([linea({ cantidadPropuesta: 100, cantidad: 180 })])).toEqual([]);
  });

  it('sólo aparecen las OP con faltante: las que se compran completas no ensucian la lista', () => {
    expect(
      repartoDadoPorCubierto([
        linea({ idOrden: 50, cantidadPropuesta: 100, cantidad: 100 }),
        linea({ idOrden: 51, cantidadPropuesta: 100, cantidad: 60 }),
      ]),
    ).toEqual([{ idOrden: 51, cantidad: 40 }]);
  });
});
