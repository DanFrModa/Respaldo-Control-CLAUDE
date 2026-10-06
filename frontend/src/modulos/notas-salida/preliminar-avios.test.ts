import { describe, expect, it } from 'vitest';

import type { HabilitacionAvio } from '@/api/tipos';

import { renglonVacio } from './captura';
import {
  aviosAEnviar,
  cantidadEnNotaPorAvio,
  faltantesSinExistencia,
  filasPreliminar,
  seleccionInicial,
} from './preliminar-avios';

/** Un avío de la habilitación con lo mínimo; el resto, neutro. */
function avio(
  over: Partial<HabilitacionAvio> & { idAvio: number; clave: string },
): HabilitacionAvio {
  return {
    descripcion: `Desc ${over.clave}`,
    unidad: 'pza',
    esGenerico: false,
    requerido: 10,
    enviado: 0,
    falta: 10,
    porcentaje: 0,
    esExtra: false,
    estado: 'pendiente',
    consumoPorTalla: false,
    tallasSinMedida: [],
    ...over,
  };
}

/** BOT-01 (3) con 500, CIE-02 (4) sin renglón (= cero), ETQ-03 (5) con existencia CERO explícita. */
const RECETA = [
  avio({ idAvio: 3, clave: 'BOT-01', requerido: 180, enviado: 30, falta: 150 }),
  avio({ idAvio: 4, clave: 'CIE-02', requerido: 60, falta: 60 }),
  avio({ idAvio: 5, clave: 'ETQ-03', requerido: 30, enviado: 5, falta: 25 }),
  avio({ idAvio: 99, clave: 'EXT-99', requerido: 0, falta: 0, esExtra: true }),
];
const STOCK = new Map([
  [3, { existencia: 500 }],
  [5, { existencia: 0 }],
]);

describe('preliminar de «Traer avíos de la orden» (fila 0.220)', () => {
  it('enseña TODA la receta (sin extras), con los que no hay incluidos y no seleccionables', () => {
    const filas = filasPreliminar(RECETA, STOCK);
    expect(filas.map((f) => f.clave)).toEqual(['BOT-01', 'CIE-02', 'ETQ-03']);
    expect(filas.map((f) => f.seleccionable)).toEqual([true, false, false]);
    // Con el stock conocido, el que no aparece es CERO (nunca entró ahí), no «no se sabe».
    expect(filas.map((f) => f.existencia)).toEqual([500, 0, 0]);
    // ⭐ 0.220: la cantidad propuesta es lo que le FALTA a la orden, no el requerido (180/60/30).
    expect(filas.map((f) => f.cantidad)).toEqual([150, 60, 25]);
  });

  it('cuando NO se sabe la existencia, todos se pueden marcar (no se inventa un cero)', () => {
    const filas = filasPreliminar(RECETA, undefined);
    expect(filas.every((f) => f.seleccionable)).toBe(true);
    expect(filas.every((f) => f.existencia === null)).toBe(true);
  });

  it('por omisión vienen marcados SÓLO los que tienen existencia', () => {
    expect([...seleccionInicial(filasPreliminar(RECETA, STOCK))]).toEqual([3]);
  });

  it('los de existencia desconocida se pueden marcar pero NO vienen marcados solos', () => {
    expect(seleccionInicial(filasPreliminar(RECETA, undefined)).size).toBe(0);
  });

  it('entran sólo los marcados', () => {
    const conDos = new Map([
      [3, { existencia: 500 }],
      [4, { existencia: 8 }],
    ]);
    const filas = filasPreliminar(RECETA, conDos);
    expect(aviosAEnviar(filas, new Set([4])).map((f) => f.idAvio)).toEqual([4]);
    expect(aviosAEnviar(filas, new Set()).length).toBe(0);
  });

  it('un marcado que se quedó SIN existencia no se cuela', () => {
    // Se marcó con existencia y luego el stock dice cero: no entra.
    const filas = filasPreliminar(RECETA, new Map([[3, { existencia: 0 }]]));
    expect(aviosAEnviar(filas, new Set([3, 4]))).toEqual([]);
  });

  it('⭐ una OP surtida a medias propone la FALTA, no el requerido', () => {
    const filas = filasPreliminar(
      [avio({ idAvio: 3, clave: 'BOT-01', requerido: 180, enviado: 100, falta: 80 })],
      STOCK,
    );
    expect(filas[0]?.cantidad).toBe(80);
    expect(filas[0]?.yaSurtido).toBe(false);
  });

  it('⭐ un avío con falta 0 es YA SURTIDO: no se marca aunque haya, ni viene marcado, ni entra', () => {
    const filas = filasPreliminar(
      [avio({ idAvio: 3, clave: 'BOT-01', requerido: 180, enviado: 200, falta: 0 })],
      STOCK,
    );
    expect(filas[0]).toMatchObject({ yaSurtido: true, seleccionable: false, existencia: 500 });
    expect(seleccionInicial(filas).size).toBe(0);
    expect(aviosAEnviar(filas, new Set([3]))).toEqual([]);
    // Y tampoco cuando no se sabe la existencia: lo ya surtido no depende del almacén.
    expect(
      filasPreliminar([avio({ idAvio: 3, clave: 'BOT-01', falta: 0 })], undefined)[0]
        ?.seleccionable,
    ).toBe(false);
  });

  /**
   * 🔴 La falta llega del servidor en FLOTANTE: un residuo como 5e-17 es «ya surtido», no «faltan
   * 5e-17». Con `<= 0` en vez de la tolerancia, este avío se ofrecería (o se trataría como «ya en
   * esta nota») en vez de salir surtido.
   */
  it('una falta RESIDUAL (5e-17) cuenta como ya surtido', () => {
    const filas = filasPreliminar(
      [avio({ idAvio: 4, clave: 'CIE-02', requerido: 60, enviado: 60, falta: 5e-17 })],
      STOCK,
    );
    expect(filas[0]).toMatchObject({ yaSurtido: true, yaEnNota: false, seleccionable: false });
    // Y no se avisa como faltante aunque no haya existencia de él.
    expect(faltantesSinExistencia(filas)).toEqual([]);
  });

  describe('lo que ESTA nota ya lleva', () => {
    it('suma por avío los renglones de ESA orden (ni otras órdenes ni renglones vacíos)', () => {
      const r = (idOrden: number | null, idAvio: number | null, cantidad: string) => ({
        ...renglonVacio(),
        idOrden,
        idAvio,
        cantidad,
      });
      const mapa = cantidadEnNotaPorAvio(
        [r(50, 3, '100'), r(50, 3, '20'), r(51, 3, '999'), r(50, 4, ''), r(50, null, '7')],
        50,
      );
      expect([...mapa.entries()]).toEqual([
        [3, 120],
        [4, 0],
      ]);
    });

    it('⭐ se DESCUENTA de lo que falta: propone el resto y dice cuánto ya va', () => {
      const filas = filasPreliminar(
        [avio({ idAvio: 3, clave: 'BOT-01', requerido: 180, falta: 180 })],
        STOCK,
        new Map([[3, 100]]),
      );
      expect(filas[0]).toMatchObject({ cantidad: 80, enEstaNota: 100, seleccionable: true });
    });

    it('⭐ si lo que falta ya va COMPLETO en la nota: «ya en esta nota», ni se marca ni se avisa', () => {
      const filas = filasPreliminar(
        [
          avio({ idAvio: 3, clave: 'BOT-01', requerido: 180, falta: 180 }),
          // Sin existencia y ya en la nota: tampoco es un faltante que haya que ir a comprar.
          avio({ idAvio: 4, clave: 'CIE-02', requerido: 60, falta: 60 }),
        ],
        STOCK,
        new Map([
          [3, 180],
          [4, 75],
        ]),
      );
      expect(filas.map((f) => [f.yaEnNota, f.seleccionable, f.cantidad])).toEqual([
        [true, false, 0],
        [true, false, 0],
      ]);
      expect(seleccionInicial(filas).size).toBe(0);
      expect(aviosAEnviar(filas, new Set([3, 4]))).toEqual([]);
      expect(faltantesSinExistencia(filas)).toEqual([]);
    });
  });
});
