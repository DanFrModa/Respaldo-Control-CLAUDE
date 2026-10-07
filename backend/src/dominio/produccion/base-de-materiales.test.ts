/**
 * Tests UNIT de la base de piezas de los AVÍOS (fila 0.232, §Post-F9.245(c)) — sin Postgres.
 *
 * Lo que se fija aquí es la regla entera de la «segunda pasada»:
 *  • antes de cortar, la base es lo pedido y NADA cambia (los mismos objetos);
 *  • después de un sobre-corte, la celda sube a lo cortado y sólo esa celda;
 *  • el bajo-corte NUNCA baja la base (el material ya se compró);
 *  • es por CELDA: un corte que rebalancea tallas pide el extra de la talla que creció;
 *  • cortes por partes se SUMAN, los cancelados NO cuentan, el pack se PLIEGA y el color se
 *    CANONIZA (fila 0.159) — si no, la celda se compararía en dos espacios distintos.
 */
import { describe, expect, it } from 'vitest';

import type { ClienteLectura } from '../../comun/transaccion.js';
import {
  claveCeldaBase,
  cortadoVivoDeOrdenes,
  cortadoVivoPorCelda,
  matrizParaAvios,
} from './base-de-materiales.js';

// Colores y tallas de las pruebas.
const ROJO = 1;
const AZUL = 2;
/** Un color absorbido por ROJO en una fusión (fila 0.159). */
const ROJO_VIEJO = 9;
const CH = 10;
const M = 20;

/** Una línea de la matriz con su nombre (la forma que trae la explosión). */
function linea(
  idColor: number,
  tallas: [number, number][],
): {
  idColor: number;
  color: { nombre: string };
  tallas: { idTalla: number; cantidad: number; talla: { etiqueta: string } }[];
} {
  return {
    idColor,
    color: { nombre: `Color ${String(idColor)}` },
    tallas: tallas.map(([idTalla, cantidad]) => ({
      idTalla,
      cantidad,
      talla: { etiqueta: `T${String(idTalla)}` },
    })),
  };
}

function cortado(celdas: [number, number, number][]): Map<string, number> {
  return new Map(celdas.map(([c, t, n]) => [claveCeldaBase(c, t), n]));
}

/** Σ de la matriz, para comparar totales sin depender del orden de los renglones. */
function celdas(lineas: { idColor: number; tallas: { idTalla: number; cantidad: number }[] }[]) {
  const mapa = new Map<string, number>();
  for (const l of lineas) {
    for (const t of l.tallas) {
      const k = claveCeldaBase(l.idColor, t.idTalla);
      mapa.set(k, (mapa.get(k) ?? 0) + t.cantidad);
    }
  }
  return Object.fromEntries([...mapa].sort(([a], [b]) => a.localeCompare(b)));
}

describe('matrizParaAvios — la base de los avíos es max(pedido, cortado) por celda', () => {
  const pedida = [
    linea(ROJO, [
      [CH, 10],
      [M, 20],
    ]),
  ];

  it('sin corte: la base es LO PEDIDO y devuelve los mismos objetos (nada cambia antes de cortar)', () => {
    const r = matrizParaAvios(pedida, new Map());
    expect(r.piezasSobreCorte).toBe(0);
    expect(r.lineas[0]).toBe(pedida[0]);
  });

  it('cortado igual a lo pedido: no hay extra', () => {
    const r = matrizParaAvios(
      pedida,
      cortado([
        [ROJO, CH, 10],
        [ROJO, M, 20],
      ]),
    );
    expect(r.piezasSobreCorte).toBe(0);
    expect(celdas(r.lineas)).toEqual(celdas(pedida));
  });

  it('sobre-corte en UNA celda: sólo esa celda sube a lo cortado', () => {
    const r = matrizParaAvios(
      pedida,
      cortado([
        [ROJO, CH, 10],
        [ROJO, M, 26],
      ]),
    );
    expect(r.piezasSobreCorte).toBe(6);
    expect(celdas(r.lineas)).toEqual({ [`${ROJO}|${CH}`]: 10, [`${ROJO}|${M}`]: 26 });
    // La entrada NO se muta (la matriz de la orden es lo que el cliente pidió, D7).
    expect(pedida[0]?.tallas[1]?.cantidad).toBe(20);
  });

  it('bajo-corte: la base NUNCA baja de lo pedido (el material ya se compró)', () => {
    const r = matrizParaAvios(
      pedida,
      cortado([
        [ROJO, CH, 4],
        [ROJO, M, 20],
      ]),
    );
    expect(r.piezasSobreCorte).toBe(0);
    expect(celdas(r.lineas)).toEqual(celdas(pedida));
  });

  it('rebalanceo de tallas (mismo total): el extra de M se pide aunque falten de CH — es por CELDA', () => {
    const r = matrizParaAvios(
      pedida,
      cortado([
        [ROJO, CH, 5],
        [ROJO, M, 25],
      ]),
    );
    expect(r.piezasSobreCorte).toBe(5);
    expect(celdas(r.lineas)).toEqual({ [`${ROJO}|${CH}`]: 10, [`${ROJO}|${M}`]: 25 });
  });

  it('dos colores: cada uno se compara contra SU pedido', () => {
    const dos = [linea(ROJO, [[CH, 10]]), linea(AZUL, [[CH, 10]])];
    const r = matrizParaAvios(
      dos,
      cortado([
        [ROJO, CH, 8],
        [AZUL, CH, 13],
      ]),
    );
    expect(r.piezasSobreCorte).toBe(3);
    expect(celdas(r.lineas)).toEqual({ [`${ROJO}|${CH}`]: 10, [`${AZUL}|${CH}`]: 13 });
  });

  it('dos renglones con el MISMO color (packs o fusión): se compara contra la Σ y el extra se suma UNA vez', () => {
    // 10 + 10 = 20 pedidas en la celda; cortadas 25 ⇒ extra 5, no 15 (ni 10).
    const dosRenglones = [linea(ROJO, [[CH, 10]]), linea(ROJO, [[CH, 10]])];
    const r = matrizParaAvios(dosRenglones, cortado([[ROJO, CH, 25]]));
    expect(r.piezasSobreCorte).toBe(5);
    expect(celdas(r.lineas)).toEqual({ [`${ROJO}|${CH}`]: 25 });
  });

  it('una celda cortada que la orden no tiene se ignora (se tolera, no se compensa)', () => {
    const r = matrizParaAvios(pedida, cortado([[AZUL, CH, 50]]));
    expect(r.piezasSobreCorte).toBe(0);
    expect(celdas(r.lineas)).toEqual(celdas(pedida));
  });
});

// ── El lector: lo cortado VIVO, con el pack plegado y el color canónico ──────────────────────────

interface DetCorte {
  idOrden: number;
  tipo: 'corte' | 'envio_maquila';
  cancelado: boolean;
  idColor: number;
  idTalla: number;
  pack: string;
  cantidad: number;
}

/**
 * Cliente FALSO que imita las dos consultas que el lector hace. ⚠️ Aplica el `where` que le pasan
 * (orden, tipo y `canceladoEn`): si el lector dejara de filtrar los cancelados o los otros tipos de
 * etapa, esta base falsa se los devolvería y las pruebas se pondrían rojas.
 */
function clienteFalso(detalles: DetCorte[]): ClienteLectura {
  const catalogo = [
    { id: ROJO, nombre: 'Rojo', activo: true, idFusionadoEn: null },
    { id: AZUL, nombre: 'Azul', activo: true, idFusionadoEn: null },
    { id: ROJO_VIEJO, nombre: 'Rojo viejo', activo: false, idFusionadoEn: ROJO },
  ];
  return {
    etapaMovimientoDet: {
      findMany: (args: {
        where: {
          etapaMov: { idOrden: { in: number[] }; tipo?: string; canceladoEn?: null };
        };
      }) => {
        const w = args.where.etapaMov;
        const filas = detalles
          .filter((d) => w.idOrden.in.includes(d.idOrden))
          .filter((d) => w.tipo === undefined || d.tipo === w.tipo)
          .filter((d) => !('canceladoEn' in w) || !d.cancelado)
          .map((d) => ({
            idColor: d.idColor,
            idTalla: d.idTalla,
            pack: d.pack,
            cantidad: d.cantidad,
            etapaMov: { idOrden: d.idOrden },
          }));
        return Promise.resolve(filas);
      },
    },
    color: {
      findMany: (args: { where: { id: { in: number[] } } }) =>
        Promise.resolve(catalogo.filter((c) => args.where.id.in.includes(c.id))),
    },
  } as unknown as ClienteLectura;
}

const det = (d: Partial<DetCorte> & Pick<DetCorte, 'idColor' | 'idTalla' | 'cantidad'>) => ({
  idOrden: 1,
  tipo: 'corte' as const,
  cancelado: false,
  pack: '',
  ...d,
});

describe('cortadoVivoPorCelda — Σ de los cortes VIVOS por color×talla', () => {
  it('cortes por partes se SUMAN (60 % + 50 % = 110 %)', async () => {
    const c = await cortadoVivoPorCelda(
      clienteFalso([
        det({ idColor: ROJO, idTalla: CH, cantidad: 6 }),
        det({ idColor: ROJO, idTalla: CH, cantidad: 5 }),
      ]),
      1,
    );
    expect(c.get(claveCeldaBase(ROJO, CH))).toBe(11);
    const r = matrizParaAvios([linea(ROJO, [[CH, 10]])], c);
    expect(r.piezasSobreCorte).toBe(1);
  });

  it('un corte CANCELADO no cuenta (D3)', async () => {
    const c = await cortadoVivoPorCelda(
      clienteFalso([
        det({ idColor: ROJO, idTalla: CH, cantidad: 10 }),
        det({ idColor: ROJO, idTalla: CH, cantidad: 30, cancelado: true }),
      ]),
      1,
    );
    expect(c.get(claveCeldaBase(ROJO, CH))).toBe(10);
  });

  it('sólo cuenta el CORTE (no los envíos a maquila ni otras etapas)', async () => {
    const c = await cortadoVivoPorCelda(
      clienteFalso([
        det({ idColor: ROJO, idTalla: CH, cantidad: 10 }),
        det({ idColor: ROJO, idTalla: CH, cantidad: 10, tipo: 'envio_maquila' }),
      ]),
      1,
    );
    expect(c.get(claveCeldaBase(ROJO, CH))).toBe(10);
  });

  it('el PACK se pliega: dos tendidos del mismo color×talla son una sola celda', async () => {
    const c = await cortadoVivoPorCelda(
      clienteFalso([
        det({ idColor: ROJO, idTalla: CH, cantidad: 7, pack: 'A' }),
        det({ idColor: ROJO, idTalla: CH, cantidad: 8, pack: 'B' }),
      ]),
      1,
    );
    expect([...c]).toEqual([[claveCeldaBase(ROJO, CH), 15]]);
  });

  it('el color se CANONIZA: lo cortado con un color absorbido cae en la celda del sobreviviente', async () => {
    const c = await cortadoVivoPorCelda(
      clienteFalso([
        det({ idColor: ROJO_VIEJO, idTalla: CH, cantidad: 7 }),
        det({ idColor: ROJO, idTalla: CH, cantidad: 5 }),
      ]),
      1,
    );
    expect([...c]).toEqual([[claveCeldaBase(ROJO, CH), 12]]);
  });

  it('por lote: cada orden con lo suyo, y una orden sin corte no aparece', async () => {
    const lote = await cortadoVivoDeOrdenes(
      clienteFalso([
        det({ idOrden: 1, idColor: ROJO, idTalla: CH, cantidad: 4 }),
        det({ idOrden: 2, idColor: ROJO, idTalla: CH, cantidad: 9 }),
      ]),
      [1, 2, 3],
    );
    expect(lote.get(1)?.get(claveCeldaBase(ROJO, CH))).toBe(4);
    expect(lote.get(2)?.get(claveCeldaBase(ROJO, CH))).toBe(9);
    expect(lote.has(3)).toBe(false);
  });

  it('sin órdenes no consulta nada', async () => {
    expect((await cortadoVivoDeOrdenes(clienteFalso([]), [])).size).toBe(0);
  });
});
