/**
 * Unit de los helpers de la matriz del inventario PT — en particular el nº de orden de Control
 * viejo (§Post-F9.25), que se captura UNA vez por movimiento y se replica a cada color.
 */
import { describe, expect, it } from 'vitest';

import type { MatrizLinea } from '@/componentes/matriz-color-talla/MatrizColorTalla';

import {
  aLineasApi,
  coloresRetiradosConExistencia,
  ejesDeExistencias,
  ordenesConExistencia,
  SUFIJO_COLOR_RETIRADO,
  totalMatriz,
  type FilaParaEjes,
} from './matriz-inventario';

const matriz: MatrizLinea[] = [
  { idColor: 1, color: 'Marino', cantidades: { 10: 3, 11: 0 } },
  { idColor: 2, color: 'Blanco', cantidades: { 10: 5 } },
  { idColor: 3, color: 'Rojo', cantidades: { 10: 0 } },
];

describe('aLineasApi', () => {
  it('descarta ceros y los colores que quedan sin tallas', () => {
    const r = aLineasApi(matriz);
    expect(r).toEqual([
      { idColor: 1, tallas: [{ idTalla: 10, cantidad: 3 }] },
      { idColor: 2, tallas: [{ idTalla: 10, cantidad: 5 }] },
    ]);
  });

  it('replica el nº de orden de Control viejo a TODOS los colores', () => {
    const r = aLineasApi(matriz, ' 12345 ');
    expect(r.every((l) => l.numOrdenV1 === '12345')).toBe(true);
  });

  it('sin nº de orden no manda el campo (no inventa una referencia vacía)', () => {
    expect(aLineasApi(matriz, '   ')[0]).not.toHaveProperty('numOrdenV1');
    expect(aLineasApi(matriz)[0]).not.toHaveProperty('numOrdenV1');
  });
});

describe('aLineasApi — la ORDEN del bucket (§Post-F9.40)', () => {
  it('replica el idOrden elegido a TODOS los colores', () => {
    const r = aLineasApi(matriz, undefined, 55);
    expect(r.every((l) => l.idOrden === 55)).toBe(true);
  });

  it('el bucket «sin orden» NO manda el campo (null y ausente significan lo mismo)', () => {
    expect(aLineasApi(matriz, undefined, null)[0]).not.toHaveProperty('idOrden');
    expect(aLineasApi(matriz)[0]).not.toHaveProperty('idOrden');
  });
});

describe('ordenesConExistencia (§Post-F9.40)', () => {
  it('suma por bucket, descarta los que no tienen piezas y pone «sin orden» primero', () => {
    expect(
      ordenesConExistencia([
        { idOrden: 55, folioOrden: 9001, existencia: 10 },
        { idOrden: 55, folioOrden: 9001, existencia: 5 },
        { idOrden: null, folioOrden: null, existencia: 4 },
        { idOrden: 60, folioOrden: 9002, existencia: 0 },
        { idOrden: 61, folioOrden: 9003, existencia: -3 },
      ]),
    ).toEqual([
      { idOrden: null, folioOrden: null, existencia: 4 },
      { idOrden: 55, folioOrden: 9001, existencia: 15 },
    ]);
  });

  it('sin filas no ofrece ninguna orden (la pantalla agrega «sin orden» aparte)', () => {
    expect(ordenesConExistencia([])).toEqual([]);
  });

  it('con `incluirCeros` SÍ ofrece el bucket en cero (volver del estampado a su orden)', () => {
    // La orden 55 salió completa a Aplicación: su bucket quedó en 0. Al REGRESAR las piezas tiene
    // que poder elegirse, o entrarían a «sin orden» y la entrega de la orden 55 diría "no hay".
    expect(
      ordenesConExistencia(
        [
          { idOrden: 55, folioOrden: 9001, existencia: 100 },
          { idOrden: 55, folioOrden: 9001, existencia: -100 },
          { idOrden: null, folioOrden: null, existencia: 0 },
        ],
        { incluirCeros: true },
      ),
    ).toEqual([
      { idOrden: null, folioOrden: null, existencia: 0 },
      { idOrden: 55, folioOrden: 9001, existencia: 0 },
    ]);
  });
});

describe('totalMatriz', () => {
  it('suma todas las celdas', () => {
    expect(totalMatriz(matriz)).toBe(8);
  });
});

/**
 * ⭐ FILA 0.164 — los colores retirados que tienen mercancía en ESTE contexto. Nace de la fusión de
 * duplicados (§Post-F9.222): el color absorbido se apaga y sus piezas siguen en el almacén, así que
 * sin esto no había forma de ajustarlas ni de traspasarlas.
 *
 * 📌 FILA 0.192 — la función ya NO recibe el catálogo vivo (lo busca el servidor vía
 * `SelectorColor`): aquí sólo queda el extra que el servidor no puede devolver.
 */
describe('coloresRetiradosConExistencia (filas 0.164 / 0.192)', () => {
  const retirado = (idColor: number, color: string) => ({ idColor, color, colorActivo: false });

  it('sin filas de existencia no ofrece NADA (el catálogo vivo lo pone el servidor)', () => {
    expect(coloresRetiradosConExistencia()).toEqual([]);
    expect(coloresRetiradosConExistencia([])).toEqual([]);
  });

  it('ofrece el color RETIRADO con mercancía, ROTULADO', () => {
    expect(coloresRetiradosConExistencia([retirado(9, 'Blanco Hueso')])).toEqual([
      { id: 9, nombre: `Blanco Hueso${SUFIJO_COLOR_RETIRADO}` },
    ]);
  });

  it('no duplica el color repetido en varias filas', () => {
    expect(
      coloresRetiradosConExistencia([retirado(9, 'Blanco Hueso'), retirado(9, 'Blanco Hueso')]),
    ).toEqual([{ id: 9, nombre: `Blanco Hueso${SUFIJO_COLOR_RETIRADO}` }]);
  });

  it('ordena los retirados por nombre', () => {
    expect(coloresRetiradosConExistencia([retirado(9, 'Zafiro'), retirado(4, 'Ámbar')])).toEqual([
      { id: 4, nombre: `Ámbar${SUFIJO_COLOR_RETIRADO}` },
      { id: 9, nombre: `Zafiro${SUFIJO_COLOR_RETIRADO}` },
    ]);
  });

  /**
   * La puerta se abre por el color RETIRADO, no por «todo lo que tenga existencia»: un color ACTIVO
   * ya lo ofrece la búsqueda del servidor, y colarlo aquí lo rotularía «(retirado)» siendo mentira.
   */
  it('un color ACTIVO con existencia NO se agrega', () => {
    expect(
      coloresRetiradosConExistencia([{ idColor: 7, color: 'Rojo', colorActivo: true }]),
    ).toEqual([]);
  });
});

/**
 * ⭐⭐ FILA 0.215 — LOS EJES DEL CUADRO SALEN DE LO QUE HAY, NO DEL CATÁLOGO.
 *
 * Nace del repaso de Daniel (§Post-F9.243, punto 11): *«pide que escoja una talla y un color… me
 * está poniendo cosas que no existen. Me pone todas las tallas yo creo que existen en todos los
 * modelos… No puedo avanzar»*.
 */
describe('ejesDeExistencias (fila 0.215)', () => {
  /** Un renglón de existencia, con lo justo que el cuadro necesita. */
  function fila(p: Partial<FilaParaEjes> = {}): FilaParaEjes {
    return {
      idColor: 7,
      color: 'Rojo',
      colorActivo: true,
      idTalla: 11,
      etiquetaTalla: 'CH',
      ordenTalla: 1,
      idOrden: null,
      ...p,
    };
  }

  it('sin renglones no arma nada (no inventa columnas del catálogo)', () => {
    const ejes = ejesDeExistencias([], null);
    expect(ejes.tallas).toEqual([]);
    expect(ejes.lineas).toEqual([]);
  });

  it('arma una columna por talla y una fila por color, SIN repetir', () => {
    const ejes = ejesDeExistencias(
      [
        fila(),
        // el mismo color×talla en otro almacén: es el mismo eje, no dos
        fila(),
        fila({ idTalla: 12, etiquetaTalla: 'M', ordenTalla: 2 }),
        fila({ idColor: 8, color: 'Marino' }),
      ],
      null,
    );
    expect(ejes.tallas).toEqual([
      { idTalla: 11, etiqueta: 'CH' },
      { idTalla: 12, etiqueta: 'M' },
    ]);
    expect(ejes.lineas).toEqual([
      { idColor: 8, color: 'Marino', cantidades: {} },
      { idColor: 7, color: 'Rojo', cantidades: {} },
    ]);
  });

  it('las columnas van en el orden del CATÁLOGO de tallas (CH, M, G), no en el que llegaron', () => {
    const ejes = ejesDeExistencias(
      [
        fila({ idTalla: 13, etiquetaTalla: 'G', ordenTalla: 3 }),
        fila({ idTalla: 11, etiquetaTalla: 'CH', ordenTalla: 1 }),
        fila({ idTalla: 12, etiquetaTalla: 'M', ordenTalla: 2 }),
      ],
      null,
    );
    expect(ejes.tallas.map((t) => t.etiqueta)).toEqual(['CH', 'M', 'G']);
  });

  /**
   * 🔴 EL GUARDIÁN DEL FILTRO POR BUCKET. Si se le quitara el `if (f.idOrden !== idOrden) continue`,
   * el cuadro del bucket «sin orden» traería la talla G y el color Marino de la orden 55 — o sea
   * volvería a ofrecer «cosas que no existen», ahora disfrazadas de reales. MEDIDO: sin esa línea,
   * este `toEqual` falla con 2 tallas y 2 colores.
   */
  it('⭐ SOLO el bucket pedido: los renglones de otra orden no son ejes de éste', () => {
    const filas = [
      fila({ idOrden: null }),
      fila({
        idOrden: 55,
        idColor: 8,
        color: 'Marino',
        idTalla: 13,
        etiquetaTalla: 'G',
        ordenTalla: 3,
      }),
    ];
    expect(ejesDeExistencias(filas, null)).toMatchObject({
      tallas: [{ idTalla: 11, etiqueta: 'CH' }],
      lineas: [{ idColor: 7, color: 'Rojo', cantidades: {} }],
    });
    // Y su gemela: pedir la orden 55 trae SUS ejes, no los del bucket «sin orden».
    expect(ejesDeExistencias(filas, 55)).toMatchObject({
      tallas: [{ idTalla: 13, etiqueta: 'G' }],
      lineas: [{ idColor: 8, color: 'Marino', cantidades: {} }],
    });
  });

  /**
   * ⭐⭐ LA FIRMA — y esto NO es un detalle interno. Las dos pantallas deciden con ella si REARMAN el
   * cuadro. Si comparasen la identidad del objeto, una respuesta nueva con el mismo contenido
   * rearmaría en cada render y el efecto no pararía nunca: pasó, y la suite de Movimientos se quedó
   * **diez minutos sin imprimir una línea**.
   */
  describe('la firma de los ejes', () => {
    it('no cambia si el contenido es el mismo (aunque los renglones lleguen en otro objeto)', () => {
      expect(ejesDeExistencias([fila()], null).firma).toBe(ejesDeExistencias([fila()], null).firma);
    });

    it('cambia si cambia una talla o un color', () => {
      const base = ejesDeExistencias([fila()], null).firma;
      expect(ejesDeExistencias([fila({ idTalla: 12, etiquetaTalla: 'M' })], null).firma).not.toBe(
        base,
      );
      expect(ejesDeExistencias([fila({ idColor: 8, color: 'Marino' })], null).firma).not.toBe(base);
    });

    /**
     * 🔑 Y lleva el BUCKET dentro. Dos órdenes con los mismos colores y las mismas tallas NO son el
     * mismo cuadro: su saldo es otro. Sin esto, cambiar de orden dejaría pegado lo capturado y se
     * validaría contra un disponible que no le corresponde.
     */
    it('⭐ cambia al cambiar de BUCKET, aunque los ejes sean idénticos', () => {
      expect(ejesDeExistencias([fila({ idOrden: 55 })], 55).firma).not.toBe(
        ejesDeExistencias([fila({ idOrden: null })], null).firma,
      );
    });
  });

  /**
   * Fila 0.164 — el color retirado conserva sus piezas (§Post-F9.222), así que sí es fila del
   * cuadro; pero va ROTULADO, o se leería como uno más del catálogo vivo.
   */
  it('el color RETIRADO es fila del cuadro, y va rotulado', () => {
    expect(
      ejesDeExistencias([fila({ idColor: 9, color: 'Blanco Hueso', colorActivo: false })], null)
        .lineas,
    ).toEqual([{ idColor: 9, color: `Blanco Hueso${SUFIJO_COLOR_RETIRADO}`, cantidades: {} }]);
  });
});
