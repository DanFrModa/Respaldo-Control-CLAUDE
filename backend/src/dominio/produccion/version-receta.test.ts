/**
 * ⭐⭐ fila 0.257 — las tres reglas PURAS que deciden si el snapshot de la explosión sigue vigente.
 * Cada condición «para NO bloquear» tiene su prueba (regla de la 0.155): quitarle la condición a
 * cualquiera tiene que poner algo en rojo aquí.
 */
import { describe, expect, it } from 'vitest';

import {
  cambiaLoQueSeCompra,
  matrizCambiaLoQueSeCompra,
  reasignaLoQueSeCompra,
  recetaDesfasada,
  type LoQueSeCompraDelRenglon,
} from './version-receta.js';

const tela: LoQueSeCompraDelRenglon = {
  consumoPorPrenda: 1.5,
  paraProduccion: true,
  idAmarreProveedor: 4,
};
const avio: LoQueSeCompraDelRenglon = {
  consumoPorPrenda: 6,
  paraProduccion: true,
  idAmarreProveedor: null,
  consumoPorTalla: true,
  tallas: [
    { idTalla: 1, consumo: 53, idAvioMedida: 10 },
    { idTalla: 2, consumo: 55, idAvioMedida: 11 },
  ],
};

describe('cambiaLoQueSeCompra', () => {
  it('lo MISMO (o igual dentro del ruido de redondeo) no cambia nada', () => {
    expect(cambiaLoQueSeCompra(tela, { ...tela })).toBe(false);
    expect(cambiaLoQueSeCompra(tela, { ...tela, consumoPorPrenda: 1.5 + 1e-9 })).toBe(false);
    expect(cambiaLoQueSeCompra(avio, { ...avio, tallas: [...(avio.tallas ?? [])].reverse() })).toBe(
      false,
    );
  });

  it('cada campo que la explosión lee, por separado, SÍ cambia', () => {
    expect(cambiaLoQueSeCompra(tela, { ...tela, consumoPorPrenda: 1.6 })).toBe(true);
    expect(cambiaLoQueSeCompra(tela, { ...tela, paraProduccion: false })).toBe(true);
    expect(cambiaLoQueSeCompra(tela, { ...tela, idAmarreProveedor: 5 })).toBe(true);
    expect(cambiaLoQueSeCompra(tela, { ...tela, idAmarreProveedor: null })).toBe(true);
    expect(cambiaLoQueSeCompra(avio, { ...avio, consumoPorTalla: false })).toBe(true);
  });

  it('las medidas por talla: consumo, medida, una talla de más o de menos', () => {
    const [ch, m] = avio.tallas ?? [];
    if (ch === undefined || m === undefined) throw new Error('fixture');
    expect(cambiaLoQueSeCompra(avio, { ...avio, tallas: [{ ...ch, consumo: 1 }, m] })).toBe(true);
    expect(cambiaLoQueSeCompra(avio, { ...avio, tallas: [{ ...ch, idAvioMedida: 12 }, m] })).toBe(
      true,
    );
    expect(cambiaLoQueSeCompra(avio, { ...avio, tallas: [ch] })).toBe(true);
    expect(cambiaLoQueSeCompra(avio, { ...avio, tallas: [ch, { ...m, idTalla: 3 }] })).toBe(true);
  });

  it('la tela no lleva bandera ni medidas: ausente es «apagado / sin medidas»', () => {
    expect(cambiaLoQueSeCompra(tela, { ...tela, consumoPorTalla: false, tallas: [] })).toBe(false);
  });
});

describe('matrizCambiaLoQueSeCompra', () => {
  const antes = [
    { idColor: 1, idTalla: 1, cantidad: 40 },
    { idColor: 1, idTalla: 2, cantidad: 60 },
  ];

  it('la misma matriz (aunque llegue en otro orden, partida en dos packs, o con celdas en 0) no cambia', () => {
    expect(matrizCambiaLoQueSeCompra(antes, [...antes].reverse())).toBe(false);
    expect(
      matrizCambiaLoQueSeCompra(antes, [
        { idColor: 1, idTalla: 1, cantidad: 20 },
        { idColor: 1, idTalla: 1, cantidad: 20 },
        { idColor: 1, idTalla: 2, cantidad: 60 },
        { idColor: 2, idTalla: 1, cantidad: 0 },
      ]),
    ).toBe(false);
  });

  it('bajar, subir, repartir distinto o cambiar de color SÍ cambia', () => {
    expect(
      matrizCambiaLoQueSeCompra(antes, [antes[0]!, { idColor: 1, idTalla: 2, cantidad: 30 }]),
    ).toBe(true);
    expect(
      matrizCambiaLoQueSeCompra(antes, [antes[0]!, { idColor: 1, idTalla: 2, cantidad: 90 }]),
    ).toBe(true);
    // Mismo total (100), otro reparto entre tallas.
    expect(
      matrizCambiaLoQueSeCompra(antes, [
        { idColor: 1, idTalla: 1, cantidad: 60 },
        { idColor: 1, idTalla: 2, cantidad: 40 },
      ]),
    ).toBe(true);
    // Mismo total, otro color.
    expect(
      matrizCambiaLoQueSeCompra(antes, [
        { idColor: 2, idTalla: 1, cantidad: 40 },
        { idColor: 1, idTalla: 2, cantidad: 60 },
      ]),
    ).toBe(true);
    expect(matrizCambiaLoQueSeCompra(antes, [])).toBe(true);
  });
});

describe('recetaDesfasada', () => {
  it('explotada con la misma versión: vigente', () => {
    expect(
      recetaDesfasada({ versionReceta: 3, versionRecetaExplotada: 3, tieneSnapshot: true }),
    ).toBe(false);
  });

  it('explotada con otra versión: desfasada, haya o no filas en el snapshot', () => {
    expect(
      recetaDesfasada({ versionReceta: 4, versionRecetaExplotada: 3, tieneSnapshot: true }),
    ).toBe(true);
    // Una explosión que no dejó ni un renglón, y después se firmó algo: lo que falta es justo eso.
    expect(
      recetaDesfasada({ versionReceta: 1, versionRecetaExplotada: 0, tieneSnapshot: false }),
    ).toBe(true);
  });

  it('NULL con snapshot (de antes de la fila): desfasada; NULL sin snapshot (nunca explotó): no', () => {
    expect(
      recetaDesfasada({ versionReceta: 0, versionRecetaExplotada: null, tieneSnapshot: true }),
    ).toBe(true);
    expect(
      recetaDesfasada({ versionReceta: 0, versionRecetaExplotada: null, tieneSnapshot: false }),
    ).toBe(false);
  });
});

describe('reasignaLoQueSeCompra (H2)', () => {
  it('la PRIMERA asignación no mueve la compra (el snapshot se calculó sin ella)', () => {
    expect(
      reasignaLoQueSeCompra({ idProveedor: null, precio: null }, { idProveedor: 5, precio: 1.5 }),
    ).toBe(false);
  });

  it('reasignar, cambiar el precio (también de/a «sin precio») o quitar SÍ la mueven', () => {
    const antes = { idProveedor: 5, precio: 1.5 };
    expect(reasignaLoQueSeCompra(antes, { idProveedor: 6, precio: 1.5 })).toBe(true);
    expect(reasignaLoQueSeCompra(antes, { idProveedor: 5, precio: 2 })).toBe(true);
    expect(reasignaLoQueSeCompra(antes, { idProveedor: 5, precio: null })).toBe(true);
    expect(reasignaLoQueSeCompra({ idProveedor: 5, precio: null }, antes)).toBe(true);
    expect(reasignaLoQueSeCompra(antes, { idProveedor: null, precio: null })).toBe(true);
  });

  it('lo MISMO (o igual dentro del ruido de redondeo) no la mueve', () => {
    const antes = { idProveedor: 5, precio: 1.5 };
    expect(reasignaLoQueSeCompra(antes, { ...antes })).toBe(false);
    expect(reasignaLoQueSeCompra(antes, { idProveedor: 5, precio: 1.5 + 1e-9 })).toBe(false);
    expect(
      reasignaLoQueSeCompra({ idProveedor: 5, precio: null }, { idProveedor: 5, precio: null }),
    ).toBe(false);
  });
});
