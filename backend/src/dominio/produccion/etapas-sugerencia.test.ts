/**
 * Tests UNITARIOS del núcleo de la SUGERENCIA DE CAPTURA (V1-E8i, §Post-F9.131): lo que precargan
 * los botones «Llenar con lo que falta por cortar» (corte) y «Llenar con lo que se cortó» (envío a
 * maquila). Es la regla PURA — sin BD; el permiso y el filtro por empresa de `sugerirCaptura` viven
 * en `etapas.int.test.ts`.
 *
 * Lo que estas pruebas defienden:
 *  • el botón del corte propone lo ORDENADO cuando no se ha cortado nada (petición de Daniel) y lo
 *    que FALTA cuando ya hubo un corte parcial — nunca duplica piezas;
 *  • el botón del envío propone lo realmente CORTADO menos lo ya enviado A ESE PROCESO, para que un
 *    SEGUNDO envío parcial no proponga un sobre-envío que el servidor rechazaría (decisión (g));
 *  • cuando no hay nada que precargar, dice POR QUÉ (nunca un botón mudo).
 */
import { describe, expect, it } from 'vitest';

import { resolverSugerencia } from './etapas.js';

/** Atajo: mapa de celdas `"idColor:idTalla" → cantidad`. */
const mapa = (entradas: Record<string, number> = {}): Map<string, number> =>
  new Map(Object.entries(entradas));

const vacio = new Map<string, number>();

describe('resolverSugerencia · base CORTE («llenar con lo que falta por cortar»)', () => {
  it('sin nada cortado propone LO ORDENADO, celda por celda (lo que pidió Daniel)', () => {
    const r = resolverSugerencia({
      base: 'corte',
      pedido: mapa({ '1:1': 30, '1:2': 20, '2:1': 10 }),
      cortado: vacio,
      enviado: vacio,
    });
    expect(r.motivo).toBe('hay');
    expect([...r.disponible]).toEqual([
      ['1:1', 30],
      ['1:2', 20],
      ['2:1', 10],
    ]);
  });

  it('con un corte PARCIAL propone solo lo que falta (no vuelve a proponer lo ya cortado)', () => {
    const r = resolverSugerencia({
      base: 'corte',
      pedido: mapa({ '1:1': 30, '1:2': 20 }),
      cortado: mapa({ '1:1': 10 }),
      enviado: vacio,
    });
    expect(r.motivo).toBe('hay');
    expect(r.disponible.get('1:1')).toBe(20); // 30 − 10, NO 30
    expect(r.disponible.get('1:2')).toBe(20);
  });

  it('el SOBRE-CORTE de una celda no propone negativos: esa celda desaparece de la sugerencia', () => {
    // Decisión (f): cortar de más se permite; lo que el botón no hace es PROPONER un negativo.
    const r = resolverSugerencia({
      base: 'corte',
      pedido: mapa({ '1:1': 30, '1:2': 20 }),
      cortado: mapa({ '1:1': 50 }),
      enviado: vacio,
    });
    expect(r.motivo).toBe('hay');
    expect(r.disponible.has('1:1')).toBe(false);
    expect(r.disponible.get('1:2')).toBe(20);
  });

  it('con TODO cortado no propone nada y lo dice: «todo-cortado»', () => {
    const r = resolverSugerencia({
      base: 'corte',
      pedido: mapa({ '1:1': 30 }),
      cortado: mapa({ '1:1': 30 }),
      enviado: vacio,
    });
    expect(r.motivo).toBe('todo-cortado');
    expect(r.disponible.size).toBe(0);
  });

  it('una orden SIN matriz color×talla lo dice: «orden-sin-matriz»', () => {
    const r = resolverSugerencia({ base: 'corte', pedido: vacio, cortado: vacio, enviado: vacio });
    expect(r.motivo).toBe('orden-sin-matriz');
    expect(r.disponible.size).toBe(0);
  });
});

describe('resolverSugerencia · base ENVÍO («llenar con lo que se cortó»)', () => {
  it('primer envío: propone LO CORTADO, no lo ordenado (con sobre-corte son distintos, decisión f)', () => {
    const r = resolverSugerencia({
      base: 'envio',
      pedido: mapa({ '1:1': 30 }),
      cortado: mapa({ '1:1': 34 }), // se cortó de más
      enviado: vacio,
    });
    expect(r.motivo).toBe('hay');
    expect(r.disponible.get('1:1')).toBe(34);
  });

  it('SEGUNDO envío parcial: descuenta lo ya enviado a ESE proceso (si no, sería sobre-envío)', () => {
    // El caso trampa: precargar el bruto cortado (30) tras haber enviado 12 daría un guardado que
    // el servidor rechaza bajo lock (decisión (g), sobre-envío ESTRICTO).
    const r = resolverSugerencia({
      base: 'envio',
      pedido: mapa({ '1:1': 30, '1:2': 20 }),
      cortado: mapa({ '1:1': 30, '1:2': 20 }),
      enviado: mapa({ '1:1': 12, '1:2': 20 }),
    });
    expect(r.motivo).toBe('hay');
    expect(r.disponible.get('1:1')).toBe(18); // 30 − 12
    expect(r.disponible.has('1:2')).toBe(false); // 20 − 20 = 0, ya no hay qué enviar de esa talla
  });

  it('cada proceso se topa contra el cortado TOTAL: el envío del otro proceso NO resta (D8)', () => {
    // `enviado` ya llega filtrado POR PROCESO; con el proceso todavía sin envíos el disponible es
    // el cortado íntegro, aunque el otro flujo (costura/estampado) ya se haya llevado las piezas.
    const r = resolverSugerencia({
      base: 'envio',
      pedido: mapa({ '1:1': 30 }),
      cortado: mapa({ '1:1': 30 }),
      enviado: vacio,
    });
    expect(r.disponible.get('1:1')).toBe(30);
  });

  it('sin NADA cortado lo dice: «nada-cortado» (no «todo-enviado», que sería mentira)', () => {
    const r = resolverSugerencia({
      base: 'envio',
      pedido: mapa({ '1:1': 30 }),
      cortado: vacio,
      enviado: vacio,
    });
    expect(r.motivo).toBe('nada-cortado');
    expect(r.disponible.size).toBe(0);
  });

  it('con todo lo cortado ya enviado lo dice: «todo-enviado»', () => {
    const r = resolverSugerencia({
      base: 'envio',
      pedido: mapa({ '1:1': 30 }),
      cortado: mapa({ '1:1': 30 }),
      enviado: mapa({ '1:1': 30 }),
    });
    expect(r.motivo).toBe('todo-enviado');
    expect(r.disponible.size).toBe(0);
  });

  it('un corte migrado con +5/−5 (total 0) SÍ tiene qué enviar: mira las celdas, no la suma', () => {
    // Cicatriz del histórico de Access: un corte capturado en la talla equivocada deja +5 en una
    // celda y −5 en otra. La suma da 0, pero sí hay 5 piezas enviables.
    const r = resolverSugerencia({
      base: 'envio',
      pedido: mapa({ '1:1': 30, '1:2': 30 }),
      cortado: mapa({ '1:1': 5, '1:2': -5 }),
      enviado: vacio,
    });
    expect(r.motivo).toBe('hay');
    expect(r.disponible.get('1:1')).toBe(5);
    expect(r.disponible.has('1:2')).toBe(false);
  });
});
