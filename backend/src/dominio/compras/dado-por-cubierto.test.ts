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

import { claveMaterial, pendienteDeComprar } from './comprometido-en-oc.js';
import {
  repartirCubiertoPorColor,
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

describe('repartirCubiertoPorColor — a qué renglón le cubre cada marca', () => {
  /**
   * Mapa como el que devuelve `dadoPorCubierto`:
   * `idOrden → (claveMaterial → (color del renglón → cantidad))`.
   *
   * El avío 3 tiene cerrado un pedazo del Rojo (7) y otro del Azul (9); la tela 1, un pedazo de un
   * renglón que no dice color.
   */
  const mapa: CubiertoPorOrden = new Map([
    [
      50,
      new Map<string, Map<number | null, number>>([
        [
          'avio-3',
          new Map<number | null, number>([
            [7, 4],
            [9, 11],
          ]),
        ],
        ['tela-1', new Map<number | null, number>([[null, 1]])],
      ]),
    ],
  ]);

  /** Las cubetas de UN material en UNA orden, como las lee el dominio. */
  const cubetas = (
    idOrden: number,
    material: { idTela: number | null; idAvio: number | null },
  ): ReadonlyMap<number | null, number> | undefined =>
    mapa.get(idOrden)?.get(claveMaterial(material));

  const AVIO_3 = { idTela: null, idAvio: 3 };
  const TELA_1 = { idTela: 1, idAvio: null };

  it('⭐ el cierre ROJO cubierto NO cubre al azul (el color sigue mandando)', () => {
    expect(repartirCubiertoPorColor([{ idColor: 7 }, { idColor: 9 }], cubetas(50, AVIO_3))).toEqual(
      [4, 11],
    );
  });

  it('un color que nadie cubrió da 0 — y una orden distinta también', () => {
    expect(repartirCubiertoPorColor([{ idColor: 12 }], cubetas(50, AVIO_3))).toEqual([0]);
    expect(repartirCubiertoPorColor([{ idColor: 7 }], cubetas(51, AVIO_3))).toEqual([0]);
  });

  it('la TELA usa su propio color, y el renglón SIN color tiene su propia cubeta', () => {
    expect(repartirCubiertoPorColor([{ idColor: null }], cubetas(50, TELA_1))).toEqual([1]);
    // Un renglón de color Marino (4) no se lleva lo que se cerró sin decir color.
    expect(repartirCubiertoPorColor([{ idColor: 4 }], cubetas(50, TELA_1))).toEqual([0]);
  });

  it('la tela 3 y el avío 3 son materiales DISTINTOS: no se confunden por el número', () => {
    expect(
      repartirCubiertoPorColor([{ idColor: 7 }], cubetas(50, { idTela: 3, idAvio: null })),
    ).toEqual([0]);
  });

  it('sin marcas del material, todos los renglones salen en cero', () => {
    expect(repartirCubiertoPorColor([{ idColor: 7 }, { idColor: null }], undefined)).toEqual([
      0, 0,
    ]);
    expect(repartirCubiertoPorColor([], cubetas(50, AVIO_3))).toEqual([]);
  });

  describe('⭐⭐ fila 0.162 — LAS MARCAS HUÉRFANAS (el renglón que cambió de forma)', () => {
    /**
     * Alguien cerró un pedazo del Rojo y otro del Azul; después se marcó «se compra sin tomar en
     * cuenta el color» en el avío y la explosión pasó a emitir UN solo renglón sin color. Buscando
     * por igualdad exacta las dos marcas se caían al piso y el faltante volvía a perseguirse.
     */
    it('⭐ el renglón SIN color ÚNICO se lleva las marcas de colores que nadie reclama', () => {
      // 🔴 El valor que la pone roja: 0 — las dos marcas perdidas y el faltante resucitado.
      expect(repartirCubiertoPorColor([{ idColor: null }], cubetas(50, AVIO_3))).toEqual([15]);
    });

    it('⭐ suma su propia cubeta Y las huérfanas, sin contarlas dos veces', () => {
      const conLasDos = new Map<number | null, number>([
        [null, 2],
        [7, 4],
      ]);
      expect(repartirCubiertoPorColor([{ idColor: null }], conLasDos)).toEqual([6]);
    });

    it('🔴 LA GUARDA: con un hermano CON color, la huérfana NO se absorbe', () => {
      // Una tela mixta: un renglón Rojo (7) y otro sin color (los tonos que nadie capturó). La
      // marca del Azul (9) quedó sin dueño — y darle al renglón sin color 11 kg que se cerraron
      // sobre OTRO tono le bajaría el faltante sin que nadie lo haya dicho: ese material dejaría
      // de comprarse. 🔴 El valor que la pone roja: [11, 4] (la huérfana absorbida).
      expect(
        repartirCubiertoPorColor([{ idColor: null }, { idColor: 7 }], cubetas(50, AVIO_3)),
      ).toEqual([0, 4]);
    });

    it('🔴 la cubeta SIN color NO se reparte entre los colores (no hay era anterior que rescatar)', () => {
      // El gemelo del acervo sin color de `repartirComprometidoPorColor` NO existe aquí a
      // propósito: `RequerimientoCubierto` nació ya con color y sin backfill, y una marca sin
      // color puede valer la orden entera — repartirla dejaría a todos los colores en cero.
      const soloSinColor = new Map<number | null, number>([[null, 10]]);
      expect(repartirCubiertoPorColor([{ idColor: 7 }, { idColor: 9 }], soloSinColor)).toEqual([
        0, 0,
      ]);
    });
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
    // 🔴 Bajar el total puede dejar a una OP en `0.009`, que la generación se salta. Si esa OP se
    // diera por cubierta sólo por su diferencia, se quedaría con una astilla pendiente PARA SIEMPRE.
    //
    // ⚠️ El `0.009` (y no un `0.004`) está elegido para que la aserción DISTINGA: con `0.004` el
    // redondeo a la escala de la columna devuelve `50` por los dos caminos y la prueba se queda
    // verde aunque el guard desaparezca — se comprobó mutándolo.
    expect(
      repartoDadoPorCubierto([linea({ cantidadPropuesta: 50, cantidad: 0.009, seEscribe: false })]),
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
