/**
 * Tests UNITARIOS del inventario cíclico (F7-E5 + fila 0.099). Dos bloques, los dos sin Postgres:
 *
 *  1. Los rechazos que ocurren ANTES de tocar la base (permisos A4 + validación de entrada).
 *  2. `planearAjuste`, la ARITMÉTICA PURA del cierre: las dos patas del ajuste y el AVISO de «el
 *     almacén se movió» (§Post-F9.193 punto 6).
 *
 * El congelamiento del teórico (D6), el estado, el ajuste como MOVIMIENTO (D3) y el efecto real en
 * el kardex de las tres dimensiones se verifican END-TO-END en `inventario-ciclico.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { textoClave, type Componentes, type RenglonCiclico } from './ciclico/tipos.js';
import {
  cancelarInventarioCiclico,
  capturarConteo,
  consultarExactitud,
  crearInventarioCiclico,
  generarAjusteCiclico,
  listarInventariosCiclicos,
  obtenerConteo,
  obtenerResumen,
  planearAjuste,
} from './inventario-ciclico.js';

const sesion = (permisos: ClavePermiso[] = []) => sesionDePrueba({ idEmpresaActiva: 1, permisos });

describe('Inventario cíclico — permisos (A4)', () => {
  it('el ALTA exige indicadores.ciclicos-alta', async () => {
    await expect(crearInventarioCiclico(sesion([]), { idAlmacen: 1 })).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('el CONTEO exige indicadores.ciclicos-conteo', async () => {
    await expect(
      capturarConteo(sesion([]), 1, { renglones: [{ idDet: 1, cantReal: 0 }] }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('la EXACTITUD exige indicadores.ciclicos-consulta', async () => {
    await expect(consultarExactitud(sesion([]), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('el AJUSTE exige indicadores.ciclicos-consulta', async () => {
    await expect(generarAjusteCiclico(sesion([]), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('CANCELAR exige indicadores.ciclicos-alta', async () => {
    await expect(
      cancelarInventarioCiclico(sesion([]), 1, { motivo: 'ya no' }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('el LISTADO y el RESUMEN exigen AL MENOS UNO de los tres permisos', async () => {
    await expect(listarInventariosCiclicos(sesion([]), {})).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(obtenerResumen(sesion([]), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('el CONTEO ciego exige indicadores.ciclicos-conteo', async () => {
    await expect(obtenerConteo(sesion([]), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('Inventario cíclico — validación de entrada', () => {
  it('rechaza capturar el MISMO renglón dos veces en una sola captura', async () => {
    await expect(
      capturarConteo(sesion(['indicadores.ciclicos-conteo']), 1, {
        renglones: [
          { idDet: 7, cantReal: 3 },
          { idDet: 7, cantReal: 4 },
        ],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza una captura vacía (sin renglones)', async () => {
    await expect(
      capturarConteo(sesion(['indicadores.ciclicos-conteo']), 1, { renglones: [] }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza una cantidad contada negativa', async () => {
    await expect(
      capturarConteo(sesion(['indicadores.ciclicos-conteo']), 1, {
        renglones: [{ idDet: 1, cantReal: -2 }],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza un motivo de cancelación demasiado corto', async () => {
    await expect(
      cancelarInventarioCiclico(sesion(['indicadores.ciclicos-alta']), 1, { motivo: 'x' }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// PLANEAR EL AJUSTE — la aritmética PURA del cierre (fila 0.099)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * {@link planearAjuste} es lo único del cierre que se puede medir SIN base de datos: recibe el
 * detalle ya leído + la existencia ACTUAL bajo lock y devuelve las dos patas del ajuste y el AVISO
 * de la decisión 6. Aquí se fija lo que el motor promete:
 *
 *  • el caso EXACTO del dueño (100 congelado, 95 contado, 20 que entraron de verdad) AVISA, con la
 *    existencia en la que va a quedar el artículo si se aplica;
 *  • el aviso es un DATO, nunca una excepción: avisar no es bloquear;
 *  • los CUATRO cuadrantes de la tela de dos componentes, incluido el renglón de entrada con cuerpo
 *    0 y sólo complemento;
 *  • el redondeo respeta la ESCALA de cada dimensión (PT entero; telas y avíos, 4 decimales);
 *  • y un almacén que NO se movió no genera aviso.
 *
 * Lo que esta prueba NO puede fijar —que sin `confirmarMovimiento` no se escribe nada y que con él
 * sí— vive en `inventario-ciclico.int.test.ts`, contra la BD.
 */
function renglon(parcial: Partial<RenglonCiclico> & { idDet: number }): RenglonCiclico {
  return {
    clave: { idArticulo: parcial.idDet },
    titulo: `Artículo ${String(parcial.idDet)}`,
    subtitulo: null,
    unidad: null,
    nombreComplemento: null,
    cantTeorica: 0,
    cantTeoricaComplemento: null,
    cantReal: null,
    cantRealComplemento: null,
    ajustes: [],
    ...parcial,
  };
}

/** Mapa de existencias ACTUALES, indexado como lo hace el motor ({@link textoClave}). */
function existencias(
  pares: readonly (readonly [RenglonCiclico, Componentes])[],
): Map<string, Componentes> {
  return new Map(pares.map(([r, c]) => [textoClave(r.clave), c]));
}

describe('planearAjuste — el AVISO de «el almacén se movió» (decisión 6)', () => {
  // El caso que Daniel puso sobre la mesa, tal cual, en las TRES dimensiones. Antes de la fila
  // 0.099 el sistema escribía −5 en silencio y dejaba 115 donde el anaquel decía 95.
  const casos = [
    { dimension: 'PT', escala: 0 as const, teorico: 100, contado: 95, actual: 120 },
    { dimension: 'TELA', escala: 4 as const, teorico: 100, contado: 95, actual: 120 },
    { dimension: 'AVIO', escala: 4 as const, teorico: 100, contado: 95, actual: 120 },
  ];

  it.each(casos)(
    'avisa en $dimension: 100 congelado, 95 contado y 20 que entraron de verdad → quedaría en 115',
    ({ escala, teorico, contado, actual }) => {
      const r = renglon({
        idDet: 1,
        titulo: 'Playera A-100',
        cantTeorica: teorico,
        cantReal: contado,
      });
      const plan = planearAjuste(
        [r],
        existencias([[r, { cuerpo: actual, complemento: null }]]),
        escala,
      );

      expect(plan.movidos).toHaveLength(1);
      expect(plan.movidos[0]).toMatchObject({
        idDet: 1,
        titulo: 'Playera A-100',
        componente: 'cuerpo',
        cantTeorica: 100,
        existenciaActual: 120,
        cantReal: 95,
        ajuste: -5,
        // ⭐ Lo que hace falta para decidir: en cuánto va a quedar el anaquel si se aplica.
        existenciaResultante: 115,
      });
      // Y el ajuste que se aplicaría sigue siendo el que midió el conteo (contado − congelado).
      expect(plan.entradas).toHaveLength(0);
      expect(plan.salidas).toHaveLength(1);
      expect(plan.salidas[0]?.linea).toMatchObject({ cuerpo: 5, complemento: null });
    },
  );

  it('el aviso AVISA pero JAMÁS bloquea: no lanza, viaja en la respuesta', () => {
    const r = renglon({ idDet: 1, cantTeorica: 100, cantReal: 95 });
    expect(() =>
      planearAjuste([r], existencias([[r, { cuerpo: 120, complemento: null }]]), 0),
    ).not.toThrow();
  });

  it('NO avisa cuando el almacén no se movió (existencia actual == teórico congelado)', () => {
    const r = renglon({ idDet: 1, cantTeorica: 100, cantReal: 95 });
    const plan = planearAjuste([r], existencias([[r, { cuerpo: 100, complemento: null }]]), 0);
    expect(plan.movidos).toEqual([]);
    expect(plan.salidas).toHaveLength(1); // el conteo sí difiere: sigue habiendo ajuste
  });

  it('avisa por CADA componente que se movió, el complemento incluido', () => {
    const r = renglon({
      idDet: 1,
      nombreComplemento: 'Cardigan',
      cantTeorica: 100,
      cantTeoricaComplemento: 40,
      cantReal: 100,
      cantRealComplemento: 40,
    });
    const plan = planearAjuste([r], existencias([[r, { cuerpo: 90, complemento: 55 }]]), 4);
    expect(plan.movidos.map((m) => m.componente)).toEqual(['cuerpo', 'complemento']);
    // El conteo cuadró con lo congelado: no hay nada que escribir, pero SÍ que avisar.
    expect(plan.entradas).toHaveLength(0);
    expect(plan.salidas).toHaveLength(0);
    expect(plan.movidos[1]).toMatchObject({
      componente: 'complemento',
      cantTeorica: 40,
      existenciaActual: 55,
      ajuste: 0,
      existenciaResultante: 55,
    });
  });

  it('rechaza si NO se pudo leer la existencia actual del artículo (eso sí es un error)', () => {
    const r = renglon({ idDet: 1, cantTeorica: 10, cantReal: 10 });
    expect(() => planearAjuste([r], new Map(), 0)).toThrow(ErrorValidacion);
  });
});

describe('planearAjuste — los CUATRO cuadrantes de una tela de dos componentes (D5)', () => {
  /** Una tela con cardigan: cuerpo y complemento congelados a 100 y 40, y sin movimiento externo. */
  const tela = (cantReal: number, cantRealComplemento: number) =>
    renglon({
      idDet: 7,
      titulo: 'Felpa Suiza',
      subtitulo: 'Marino',
      nombreComplemento: 'Cardigan',
      cantTeorica: 100,
      cantTeoricaComplemento: 40,
      cantReal,
      cantRealComplemento,
    });
  const sinMovimiento = (r: ReturnType<typeof tela>) =>
    existencias([[r, { cuerpo: 100, complemento: 40 }]]);

  it('cuadrante 1 — FALTA cuerpo y FALTA complemento: una sola ENTRADA con los dos', () => {
    const r = tela(112.5, 45.25);
    const plan = planearAjuste([r], sinMovimiento(r), 4);
    expect(plan.salidas).toHaveLength(0);
    expect(plan.entradas).toHaveLength(1);
    expect(plan.entradas[0]?.linea).toMatchObject({ cuerpo: 12.5, complemento: 5.25 });
  });

  it('cuadrante 2 — SOBRA cuerpo y SOBRA complemento: una sola SALIDA con los dos', () => {
    const r = tela(87.5, 34.75);
    const plan = planearAjuste([r], sinMovimiento(r), 4);
    expect(plan.entradas).toHaveLength(0);
    expect(plan.salidas).toHaveLength(1);
    expect(plan.salidas[0]?.linea).toMatchObject({ cuerpo: 12.5, complemento: 5.25 });
  });

  it('cuadrante 3 — FALTA cuerpo y SOBRA complemento: el MISMO renglón cae en las DOS patas', () => {
    const r = tela(110, 30);
    const plan = planearAjuste([r], sinMovimiento(r), 4);
    expect(plan.entradas).toHaveLength(1);
    expect(plan.salidas).toHaveLength(1);
    // Cada pata mueve SÓLO su componente: la otra mitad va en 0, nunca negativa.
    expect(plan.entradas[0]?.linea).toMatchObject({ cuerpo: 10, complemento: 0 });
    expect(plan.salidas[0]?.linea).toMatchObject({ cuerpo: 0, complemento: 10 });
  });

  it('cuadrante 4 — SOBRA cuerpo y FALTA complemento: entrada con CUERPO 0 (la que el kardex sí admite)', () => {
    const r = tela(90, 52);
    const plan = planearAjuste([r], sinMovimiento(r), 4);
    expect(plan.entradas).toHaveLength(1);
    expect(plan.salidas).toHaveLength(1);
    // `validarLineasTela` acepta un renglón por color con cuerpo 0 y complemento > 0: es
    // exactamente esta pata. Si el motor la omitiera, el cardigan que faltó no entraría nunca.
    expect(plan.entradas[0]?.linea).toMatchObject({ cuerpo: 0, complemento: 12 });
    expect(plan.salidas[0]?.linea).toMatchObject({ cuerpo: 10, complemento: 0 });
  });

  it('una tela SIN complemento nunca fabrica el segundo número (complemento null en la línea)', () => {
    const r = renglon({ idDet: 8, cantTeorica: 10, cantReal: 12 });
    const plan = planearAjuste([r], existencias([[r, { cuerpo: 10, complemento: null }]]), 4);
    expect(plan.entradas[0]?.linea.complemento).toBeNull();
  });
});

describe('planearAjuste — el redondeo respeta la ESCALA de cada dimensión', () => {
  // 130.1 − 100.2 da 29.899999999999999 en coma flotante. Sin redondear, el motor escribiría ese
  // ruido en una columna `Decimal(14,4)` que ni siquiera puede guardarlo.
  const r = renglon({ idDet: 1, cantTeorica: 100.2, cantReal: 130.1 });
  const actual = () => existencias([[r, { cuerpo: 100.2, complemento: null }]]);

  it('escala 4 (telas y avíos): 130.1 − 100.2 = 29.9 exacto, no 29.899999999999999', () => {
    const plan = planearAjuste([r], actual(), 4);
    expect(plan.entradas[0]?.linea.cuerpo).toBe(29.9);
  });

  it('escala 0 (producto terminado): la misma resta se redondea a PIEZAS enteras', () => {
    const plan = planearAjuste([r], actual(), 0);
    expect(plan.entradas[0]?.linea.cuerpo).toBe(30);
    expect(Number.isInteger(plan.entradas[0]?.linea.cuerpo)).toBe(true);
  });

  it('escala 0: una diferencia MENOR que media pieza no mueve nada ni avisa', () => {
    // El aviso también pasa por la escala: en PT una décima de pieza no existe.
    const casi = renglon({ idDet: 2, cantTeorica: 10, cantReal: 10.2 });
    const plan = planearAjuste(
      [casi],
      existencias([[casi, { cuerpo: 10.2, complemento: null }]]),
      0,
    );
    expect(plan.entradas).toHaveLength(0);
    expect(plan.salidas).toHaveLength(0);
    expect(plan.movidos).toEqual([]);
  });

  it('escala 4: la existencia RESULTANTE del aviso también sale redondeada', () => {
    const movido = renglon({ idDet: 3, cantTeorica: 100.2, cantReal: 130.1 });
    const plan = planearAjuste(
      [movido],
      existencias([[movido, { cuerpo: 150.3, complemento: null }]]),
      4,
    );
    expect(plan.movidos[0]).toMatchObject({ ajuste: 29.9, existenciaResultante: 180.2 });
  });
});
