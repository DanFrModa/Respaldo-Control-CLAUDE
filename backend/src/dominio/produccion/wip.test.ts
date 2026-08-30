/**
 * Tests UNITARIOS del TABLERO WIP (F3-E5): las fórmulas PURAS de pendientes derivados (form
 * `Proceso`). No tocan BD; los pendientes contra etapas reales (sumas, drill-down, maquilero,
 * canceladas) viven en `wip.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { pendientesDerivados, tienePendiente, type TotalesOrden } from './wip.js';

const totales = (parcial: Partial<TotalesOrden> = {}): TotalesOrden => ({
  pedido: 0,
  cortado: 0,
  enviado: 0,
  recibido: 0,
  incompletas: 0,
  recibidoCostura: 0,
  entregado: 0,
  ...parcial,
});

describe('pendientesDerivados (fórmulas del form Proceso)', () => {
  it('aplica las cinco fórmulas exactas (por cortar/enviar/recibir/entregar)', () => {
    // pedido 100, cortado 80, enviado 60, recibido 50 (todo costura), entregado 20.
    const p = pendientesDerivados(
      totales({
        pedido: 100,
        cortado: 80,
        enviado: 60,
        recibido: 50,
        recibidoCostura: 50,
        entregado: 20,
      }),
    );
    expect(p.porCortar).toBe(20); // 100 − 80
    expect(p.cortadoPorEnviar).toBe(20); // 80 − 60
    expect(p.porRecibir).toBe(10); // 60 − 50
    expect(p.porEntregar).toBe(30); // recibidoCostura 50 − entregado 20
  });

  it('⭐ las INCOMPLETAS restan del «por recibir» — y SÓLO de ése (V1-E8v, §Post-F9.147)', () => {
    // DANIEL: *"al registrarlas como incompletas entregadas, dejan de estar en la maquila"*. La
    // prenda ya volvió del taller ⇒ cierra el pendiente por recibir.
    const p = pendientesDerivados(
      totales({
        pedido: 100,
        cortado: 100,
        enviado: 100,
        recibido: 95,
        incompletas: 5,
        recibidoCostura: 95,
        entregado: 0,
      }),
    );
    // Las 100 volvieron (95 buenas + 5 incompletas): NO falta ninguna con el maquilero.
    expect(p.porRecibir).toBe(0);
    // 🔴 Y NO restan en ningún otro lado. `cortado − enviado` es una cuenta ANTES de que la prenda
    // llegue al taller: ahí el concepto ni existe. Restarlas también aquí inventaría un pendiente
    // negativo de −5 en «cortado por enviar» y le diría al usuario que mandó de más.
    expect(p.cortadoPorEnviar).toBe(0);
    expect(p.porCortar).toBe(0);
    // Ni en «por entregar», que sale del recibido de costura (las incompletas no se producen).
    expect(p.porEntregar).toBe(95);
  });

  it('sobre-corte deja porCortar NEGATIVO (se muestra tal cual, decisión f)', () => {
    const p = pendientesDerivados(totales({ pedido: 10, cortado: 50 }));
    expect(p.porCortar).toBe(-40);
  });

  it('por entregar usa el recibido de COSTURA (no el total): estampado no es lo que se entrega', () => {
    // recibido total 100 (p. ej. estampado), pero recibidoCostura 0 → no hay qué entregar.
    const p = pendientesDerivados(totales({ recibido: 100, recibidoCostura: 0, entregado: 0 }));
    expect(p.porEntregar).toBe(0);
  });

  it('una orden sin nada capturada no tiene pendientes en cero', () => {
    const p = pendientesDerivados(totales());
    expect(p).toEqual({ porCortar: 0, cortadoPorEnviar: 0, porRecibir: 0, porEntregar: 0 });
  });
});

describe('tienePendiente (filtro soloPendientes)', () => {
  it('false cuando todo cuadra (nada pendiente)', () => {
    expect(tienePendiente(totales())).toBe(false);
  });

  it('true si falta cortar', () => {
    expect(tienePendiente(totales({ pedido: 10, cortado: 3 }))).toBe(true);
  });

  it('true si hay sobre-corte (pendiente negativo también cuenta como movimiento abierto)', () => {
    expect(tienePendiente(totales({ pedido: 10, cortado: 12 }))).toBe(true);
  });

  it('true si falta enviar / recibir / entregar', () => {
    expect(tienePendiente(totales({ cortado: 5, enviado: 2 }))).toBe(true);
    expect(tienePendiente(totales({ enviado: 5, recibido: 2 }))).toBe(true);
    expect(tienePendiente(totales({ recibidoCostura: 5, entregado: 2 }))).toBe(true);
  });

  it('false cuando una orden está 100% cerrada en todas las etapas', () => {
    // pedido = cortado = enviado = recibido(costura) = entregado: todo conciliado.
    expect(
      tienePendiente(
        totales({
          pedido: 30,
          cortado: 30,
          enviado: 30,
          recibido: 30,
          recibidoCostura: 30,
          entregado: 30,
        }),
      ),
    ).toBe(false);
  });
});
