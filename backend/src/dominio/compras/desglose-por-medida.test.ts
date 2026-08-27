import { describe, expect, it } from 'vitest';

import {
  desglosarPorMedida,
  ETIQUETA_SIN_MEDIDA,
  motivoDesgloseInvalido,
  repartirDesglose,
  sumarDesgloses,
  textoDesglose,
  type MedidaDeTalla,
} from './desglose-por-medida.js';

/**
 * ⭐⭐ **V1-E8c (§Post-F9.126) — EL DESGLOSE POR MEDIDA DE UN AVÍO.** Daniel: *"Le había puesto que el
 * cierre lo tengo que comprar por medidas. Y al hacer la OC no me aparece cantidad por medida… sólo
 * veo un solo renglón"*.
 *
 * Todo lo de aquí es PURO (sin base): la regla se puede poner roja sin Postgres, que es justo lo que
 * a `claveAgrupada` le faltaba antes de esta etapa.
 */

/** El catálogo de medidas del cierre: la S/M llevan el de 53 cm y la G/XG el de 60. */
const CIERRES: ReadonlyMap<number, MedidaDeTalla> = new Map([
  [1, { idAvioMedida: 100, etiqueta: '53 cm', orden: 1 }],
  [2, { idAvioMedida: 100, etiqueta: '53 cm', orden: 1 }],
  [3, { idAvioMedida: 200, etiqueta: '60 cm', orden: 2 }],
  [4, { idAvioMedida: 200, etiqueta: '60 cm', orden: 2 }],
]);

describe('desglosarPorMedida — agrupa las tallas por la medida que llevan', () => {
  it('junta las tallas que comparten medida y respeta el orden del catálogo', () => {
    const desglose = desglosarPorMedida(
      [
        { idTalla: 1, requerido: 300 },
        { idTalla: 2, requerido: 500 },
        { idTalla: 3, requerido: 700 },
        { idTalla: 4, requerido: 100 },
      ],
      CIERRES,
    );
    expect(desglose).toEqual([
      { idAvioMedida: 100, etiqueta: '53 cm', cantidad: 800, orden: 1 },
      { idAvioMedida: 200, etiqueta: '60 cm', cantidad: 800, orden: 2 },
    ]);
  });

  it('🔴 LA MEDIDA NO MULTIPLICA: la cantidad sale de las PRENDAS, no del número de la medida', () => {
    // El cierre de 53 cm se consume 1 por prenda: 300 prendas ⇒ 300 cierres.
    // 🔴 El valor que pondría esto rojo: `15,900` (300 × 53) — exactamente los 133,095 que Daniel
    // cazó en §Post-F9.105, sólo que a escala de esta talla.
    const desglose = desglosarPorMedida([{ idTalla: 1, requerido: 300 }], CIERRES);
    expect(desglose[0]?.cantidad).toBe(300);
  });

  it('una talla SIN medida amarrada NO se calla ni se reparte: sale en su propia cubeta, al final', () => {
    const desglose = desglosarPorMedida(
      [
        { idTalla: 3, requerido: 700 },
        { idTalla: 9, requerido: 50 },
      ],
      CIERRES,
    );
    expect(desglose.map((m) => m.etiqueta)).toEqual(['60 cm', ETIQUETA_SIN_MEDIDA]);
    expect(desglose[1]).toMatchObject({ idAvioMedida: null, cantidad: 50 });
  });

  it('🔴 sin NINGUNA medida amarrada no hay desglose: ese avío no se compra por medida', () => {
    // Rojo si devolviera `[{ etiqueta: 'Sin medida', cantidad: 180 }]`: cada bolsa de botón saldría
    // con una tablita de una sola fila que no le dice nada al proveedor.
    expect(desglosarPorMedida([{ idTalla: 9, requerido: 180 }], CIERRES)).toEqual([]);
  });

  it('sin tallas no hay desglose', () => {
    expect(desglosarPorMedida([], CIERRES)).toEqual([]);
  });
});

describe('repartirDesglose — la suma CIERRA contra la cantidad del renglón', () => {
  const bases = [
    { idAvioMedida: 100, etiqueta: '53 cm', cantidad: 800, orden: 1 },
    { idAvioMedida: 200, etiqueta: '60 cm', cantidad: 800, orden: 2 },
  ];

  it('reparte proporcionalmente y conserva etiqueta, id y orden', () => {
    expect(repartirDesglose(bases, 800)).toEqual([
      { idAvioMedida: 100, etiqueta: '53 cm', cantidad: 400, orden: 1 },
      { idAvioMedida: 200, etiqueta: '60 cm', cantidad: 400, orden: 2 },
    ]);
  });

  it('🔴 Σ = la cantidad EXACTA aunque el reparto no sea redondo (la última absorbe el residuo)', () => {
    // 100 entre tres: [33.33, 33.33, 33.34]. Rojo si alguien "simplificara" a partes iguales.
    const tres = [
      { idAvioMedida: 1, etiqueta: 'a', cantidad: 1, orden: 1 },
      { idAvioMedida: 2, etiqueta: 'b', cantidad: 1, orden: 2 },
      { idAvioMedida: 3, etiqueta: 'c', cantidad: 1, orden: 3 },
    ];
    const partes = repartirDesglose(tres, 100);
    expect(partes.reduce((s, m) => s + m.cantidad, 0)).toBe(100);
  });

  it('🔴 se reparte contra lo que SE VA A COMPRAR, no contra el requerido', () => {
    // La mitad ya estaba en otra OC: quedan 400. El desglose tiene que decir 200/200, no 800/800 —
    // si no, el renglón diría "400" arriba y su tablita sumaría 1,600.
    const partes = repartirDesglose(bases, 400);
    expect(partes.map((m) => m.cantidad)).toEqual([200, 200]);
  });

  it('sin bases no hay nada que repartir', () => {
    expect(repartirDesglose([], 500)).toEqual([]);
  });
});

describe('sumarDesgloses — dos OP en el mismo renglón suman sus medidas', () => {
  it('suma por etiqueta y deja el orden del catálogo', () => {
    const a = [
      { idAvioMedida: 100, etiqueta: '53 cm', cantidad: 300, orden: 1 },
      { idAvioMedida: 200, etiqueta: '60 cm', cantidad: 100, orden: 2 },
    ];
    const b = [{ idAvioMedida: 200, etiqueta: '60 cm', cantidad: 250, orden: 2 }];
    expect(sumarDesgloses([a, b])).toEqual([
      { idAvioMedida: 100, etiqueta: '53 cm', cantidad: 300, orden: 1 },
      { idAvioMedida: 200, etiqueta: '60 cm', cantidad: 350, orden: 2 },
    ]);
  });

  it('🔴 no deja polvo de coma flotante (se redondea a la escala de la columna)', () => {
    const a = [{ idAvioMedida: 1, etiqueta: '53 cm', cantidad: 0.1, orden: 1 }];
    const b = [{ idAvioMedida: 1, etiqueta: '53 cm', cantidad: 0.2, orden: 1 }];
    // Rojo con una suma pelada: 0.30000000000000004 acabaría impreso en el papel del proveedor.
    expect(sumarDesgloses([a, b])[0]?.cantidad).toBe(0.3);
  });

  it('sin partes, nada', () => {
    expect(sumarDesgloses([])).toEqual([]);
  });
});

describe('motivoDesgloseInvalido — el cerrojo del desglose', () => {
  const uno = { etiqueta: '53 cm', cantidad: 800 };

  it('un desglose que cierra es válido', () => {
    expect(motivoDesgloseInvalido([uno, { etiqueta: '60 cm', cantidad: 200 }], 1000)).toBeNull();
  });

  it('🔴 si la suma NO es la cantidad, lo dice con los dos números', () => {
    const motivo = motivoDesgloseInvalido([uno], 1000);
    expect(motivo).toContain('800');
    expect(motivo).toContain('1000');
  });

  it('🔴 dos filas con la misma etiqueta se rechazan con su nombre', () => {
    expect(motivoDesgloseInvalido([uno, { etiqueta: '53 cm', cantidad: 200 }], 1000)).toContain(
      '53 cm',
    );
  });

  it('compara a la escala de la columna (2 decimales), no en coma flotante cruda', () => {
    expect(
      motivoDesgloseInvalido(
        [
          { etiqueta: 'a', cantidad: 0.1 },
          { etiqueta: 'b', cantidad: 0.2 },
        ],
        0.3,
      ),
    ).toBeNull();
  });

  it('un desglose VACÍO es válido: significa "este avío no se pide por medida"', () => {
    expect(motivoDesgloseInvalido([], 1000)).toBeNull();
  });
});

describe('textoDesglose — la línea que lee el proveedor', () => {
  it('pone etiqueta y cantidad separadas por ·', () => {
    expect(
      textoDesglose([
        { idAvioMedida: 1, etiqueta: '53 cm', cantidad: 1200, orden: 1 },
        { idAvioMedida: 2, etiqueta: '60 cm', cantidad: 800, orden: 2 },
      ]),
    ).toBe('53 cm: 1,200 · 60 cm: 800');
  });

  it('sin desglose no dice nada (quien pinta decide si esconde el bloque)', () => {
    expect(textoDesglose([])).toBe('');
  });
});
