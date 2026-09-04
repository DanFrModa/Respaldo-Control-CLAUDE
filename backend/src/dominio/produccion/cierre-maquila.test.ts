/**
 * Tests UNITARIOS del CIERRE DE ORDEN CON UN MAQUILERO (V1, fila 0.109) — la aritmética PURA, sin
 * Postgres. Dos cosas se prueban aquí, y las dos son de las que se rompen en silencio:
 *
 *  1. {@link pendientePorCelda} con su TERCER sumando: que lo saldado salga del pendiente. Es la
 *     razón de ser de la fila — mientras `faltante ≡ pendiente`, cobrarlo no bajaba nada.
 *  2. {@link repartirFaltantePorTendido}: cómo se reparte ese faltante entre los tendidos de una
 *     celda. El caso que importa es el de los packs REVUELTOS, donde `Σ positivos > pendiente real`
 *     y repartir mal cobraría de más.
 *
 * El acto completo (transacción, lock, descuento propuesto, deshacer) vive en
 * `cierre-maquila.int.test.ts`, contra Postgres.
 */
import { describe, expect, it } from 'vitest';

import { repartirFaltantePorTendido } from './cierre-maquila.js';
import { celdasSaldables, totalSaldable } from './faltantes-saldados.js';
import { pendientePorCelda } from './incompletas.js';
import { pendientesDerivados, type TotalesOrden } from './wip.js';

describe('pendientePorCelda: lo SALDADO sale del pendiente (V1, fila 0.109)', () => {
  it('de 1000 enviadas con 995 devueltas, el faltante son 5 mientras nadie cierre', () => {
    expect(pendientePorCelda(1000, 995, 0)).toBe(5);
  });

  it('al cerrar esas 5, el pendiente queda en CERO (y por eso el cobro por fin baja algo)', () => {
    expect(pendientePorCelda(1000, 995, 5)).toBe(0);
  });

  it('las INCOMPLETAS y los faltantes SALDADOS restan por caminos distintos y ambos cierran', () => {
    // 100 enviadas: 95 buenas + 3 incompletas (volvieron) + 2 faltantes (no volvieron).
    expect(pendientePorCelda(100, 95 + 3, 0)).toBe(2); // antes de cerrar: debe 2
    expect(pendientePorCelda(100, 95 + 3, 2)).toBe(0); // cerradas esas 2: no debe nada
  });

  it('un cierre parcial deja el resto pendiente (no salda de más)', () => {
    expect(pendientePorCelda(100, 90, 5)).toBe(5);
  });

  it('el pendiente NEGATIVO del histórico migrado no cambia de naturaleza al restar 0', () => {
    expect(pendientePorCelda(0, 5, 0)).toBe(-5);
  });
});

describe('pendientesDerivados: el tablero WIP deja de pedir lo ya saldado', () => {
  const base: TotalesOrden = {
    pedido: 100,
    cortado: 100,
    enviado: 100,
    recibido: 95,
    incompletas: 3,
    faltantesSaldados: 0,
    recibidoCostura: 95,
    entregado: 0,
  };

  it('sin cierre, la orden todavía espera las 2 faltantes', () => {
    expect(pendientesDerivados(base).porRecibir).toBe(2);
  });

  it('con el cierre hecho, «por recibir» es 0 y la orden deja de aparecer como pendiente', () => {
    const conCierre = { ...base, faltantesSaldados: 2 };
    expect(pendientesDerivados(conCierre).porRecibir).toBe(0);
  });

  it('lo saldado NO se cuela a las demás etapas (ni produce, ni entrega)', () => {
    const conCierre = { ...base, faltantesSaldados: 2 };
    const p = pendientesDerivados(conCierre);
    expect(p.porCortar).toBe(0);
    expect(p.cortadoPorEnviar).toBe(0);
    // Lo faltante NUNCA se produjo: «por entregar» sigue siendo lo recibido de costura.
    expect(p.porEntregar).toBe(95);
  });
});

describe('celdasSaldables / totalSaldable: una celda NO le presta saldo a otra', () => {
  it('sin celdas negativas, lo saldable es la suma de siempre', () => {
    const celdas = [
      { idColor: 7, idTalla: 1, pendiente: 3 },
      { idColor: 7, idTalla: 2, pendiente: 2 },
    ];
    expect(totalSaldable(celdas)).toBe(5);
    expect(celdasSaldables(celdas)).toHaveLength(2);
  });

  it('⭐ una celda NEGATIVA no compensa a otra positiva: +5 y −5 dan 5 SALDABLES, no 0', () => {
    // Histórico migrado: un recibo capturado en la talla equivocada deja +5 en una y −5 en otra.
    // La suma PLANA (`totalPendiente`) da 0 ⇒ el botón no aparecería y esa orden no se podría
    // cerrar NUNCA. Lo saldable de verdad son 5 — y es lo que el servidor va a escribir.
    const celdas = [
      { idColor: 7, idTalla: 1, pendiente: 5 },
      { idColor: 7, idTalla: 2, pendiente: -5 },
    ];
    const plano = celdas.reduce((s, c) => s + c.pendiente, 0);
    expect(plano).toBe(0);
    expect(totalSaldable(celdas)).toBe(5);
    expect(celdasSaldables(celdas)).toEqual([{ idColor: 7, idTalla: 1, pendiente: 5 }]);
  });

  it('⭐ y al revés: +5 y −3 son 5 saldables, no 2 (el descuento saldría por 5)', () => {
    const celdas = [
      { idColor: 7, idTalla: 1, pendiente: 5 },
      { idColor: 7, idTalla: 2, pendiente: -3 },
    ];
    expect(celdas.reduce((s, c) => s + c.pendiente, 0)).toBe(2);
    expect(totalSaldable(celdas)).toBe(5);
  });

  it('DENTRO de una misma celda los tendidos SÍ se compensan (el saldo real es el agregado)', () => {
    // Los packs de un mismo color×talla son el MISMO saldo (§Post-F9.10, condición (1)): enviadas 5
    // de A y 5 de B con 8 devueltas sin pack deja 2, no 10.
    const celdas = [
      { idColor: 7, idTalla: 1, pendiente: 5 },
      { idColor: 7, idTalla: 1, pendiente: 5 },
      { idColor: 7, idTalla: 1, pendiente: -8 },
    ];
    expect(totalSaldable(celdas)).toBe(2);
    expect(celdasSaldables(celdas)).toEqual([{ idColor: 7, idTalla: 1, pendiente: 2 }]);
  });

  it('todo en cero o en negativo no salda nada', () => {
    expect(totalSaldable([{ idColor: 7, idTalla: 1, pendiente: -4 }])).toBe(0);
    expect(celdasSaldables([{ idColor: 7, idTalla: 1, pendiente: 0 }])).toEqual([]);
  });
});

describe('repartirFaltantePorTendido (§Post-F9.10)', () => {
  it('sin packs (el caso normal) reparte todo al único bucket vacío', () => {
    expect(repartirFaltantePorTendido(5, [{ pack: '', pendiente: 5 }])).toEqual([
      { pack: '', cantidad: 5 },
    ]);
  });

  it('con dos tendidos y nada revuelto, cada uno salda lo suyo', () => {
    expect(
      repartirFaltantePorTendido(4, [
        { pack: 'A', pendiente: 3 },
        { pack: 'B', pendiente: 1 },
      ]),
    ).toEqual([
      { pack: 'A', cantidad: 3 },
      { pack: 'B', cantidad: 1 },
    ]);
  });

  it('⭐ con los tendidos REVUELTOS no cobra de más: el tope es el AGREGADO, no la Σ de positivos', () => {
    // Enviadas 5 de A y 5 de B, devueltas 8 SIN pack ⇒ {A:+5, B:+5, '':−8} y el pendiente REAL es 2.
    // Saldar los positivos habría cobrado 10 piezas de 2 (el defecto que este reparto evita).
    const reparto = repartirFaltantePorTendido(2, [
      { pack: '', pendiente: -8 },
      { pack: 'A', pendiente: 5 },
      { pack: 'B', pendiente: 5 },
    ]);
    expect(reparto.reduce((s, r) => s + r.cantidad, 0)).toBe(2);
    expect(reparto).toEqual([{ pack: 'A', cantidad: 2 }]);
  });

  it('los tendidos sin pendiente no aparecen en el reparto', () => {
    expect(
      repartirFaltantePorTendido(3, [
        { pack: 'A', pendiente: 0 },
        { pack: 'B', pendiente: 3 },
      ]),
    ).toEqual([{ pack: 'B', cantidad: 3 }]);
  });

  it('un pendiente agregado de 0 o negativo no salda NADA (no es una deuda)', () => {
    expect(repartirFaltantePorTendido(0, [{ pack: 'A', pendiente: 5 }])).toEqual([]);
    expect(repartirFaltantePorTendido(-3, [{ pack: 'A', pendiente: 5 }])).toEqual([]);
  });

  it('la SUMA repartida es siempre el pendiente agregado, aunque los tendidos no alcancen', () => {
    // Defensivo: una lectura inconsistente no puede cambiar cuánto se le cobra al maquilero.
    const reparto = repartirFaltantePorTendido(7, [{ pack: 'A', pendiente: 3 }]);
    expect(reparto.reduce((s, r) => s + r.cantidad, 0)).toBe(7);
  });
});
