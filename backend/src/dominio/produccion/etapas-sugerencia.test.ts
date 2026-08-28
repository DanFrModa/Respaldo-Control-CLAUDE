/**
 * Tests UNITARIOS de la SUGERENCIA DE CAPTURA (V1-E8i, §Post-F9.131): lo que precargan los botones
 * «Llenar con lo que falta por cortar» (corte) y «Llenar con lo que se cortó» (envío a maquila).
 *
 * Dos bloques, los dos SIN Postgres:
 *  1. `resolverSugerencia` — la regla PURA (qué se propone y, si no hay nada, por qué);
 *  2. `sugerirCaptura` con un cliente Prisma FALSO — **la FORMA de las consultas**, que es donde vive
 *     el filtro por proceso (hallazgo H1 del reviewer: una mutación que le quitaba el
 *     `idTipoProceso` a la lectura del envío pasaba el typecheck y las 273 pruebas del módulo).
 *
 * El permiso a nivel HTTP se prueba en `api/produccion/etapas.rutas.test.ts`; contra etapas reales
 * (sumas, cancelaciones, empresa ajena, D8 de punta a punta) en `etapas.int.test.ts`.
 *
 * Lo que estas pruebas defienden:
 *  • el botón del corte propone lo ORDENADO cuando no se ha cortado nada (petición de Daniel) y lo
 *    que FALTA cuando ya hubo un corte parcial — nunca duplica piezas;
 *  • el botón del envío propone lo realmente CORTADO menos lo ya enviado A ESE PROCESO, para que un
 *    SEGUNDO envío parcial no proponga un sobre-envío que el servidor rechazaría (decisión (g));
 *  • cuando no hay nada que precargar, dice POR QUÉ (nunca un botón mudo).
 */
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { resolverSugerencia, sugerirCaptura } from './etapas.js';

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

  it('⭐ H6: no propone una celda que YA NO ESTÁ en la matriz de la orden (invisible e inguardable)', () => {
    // `guardarMatrizOrden` no bloquea quitar de la orden un color/talla que ya tiene cortes. Esa
    // celda no la dibuja la captura y `lineasApi()` la descarta al guardar: proponerla haría que el
    // rótulo dijera 30 y se guardaran 10.
    const r = resolverSugerencia({
      base: 'envio',
      pedido: mapa({ '1:1': 10 }),
      cortado: mapa({ '1:1': 10, '1:2': 20 }), // 1:2 se quitó de la matriz después de cortarse
      enviado: vacio,
    });
    expect(r.motivo).toBe('hay');
    expect(r.disponible.has('1:2')).toBe(false);
    expect([...r.disponible.values()].reduce((s, v) => s + v, 0)).toBe(10);
  });

  it('H6: si TODO lo cortado quedó fuera de la matriz dice «nada-cortado», no «todo-enviado»', () => {
    // Decir "ya se envió todo" de un corte que nunca salió sería mentira.
    const r = resolverSugerencia({
      base: 'envio',
      pedido: mapa({ '1:1': 10 }),
      cortado: mapa({ '9:9': 20 }),
      enviado: vacio,
    });
    expect(r.motivo).toBe('nada-cortado');
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

/**
 * ⭐⭐ H1 del reviewer — **LA FORMA DE LAS CONSULTAS**, con un cliente Prisma FALSO y sin Postgres.
 *
 * `resolverSugerencia` recibe `enviado` YA filtrado por proceso, así que ninguna prueba del núcleo
 * puro puede cazar que `sugerirCaptura` pierda ese filtro al leerlo — y ésa es **la única línea que
 * distingue bien de mal en toda la etapa**: costura y estampado consumen las mismas piezas en flujos
 * paralelos y NO se restan entre sí (D8). Sin el filtro, el botón de arte contestaría con los envíos
 * de costura y diría «todo lo cortado ya se le envió a este proceso» sobre un proceso al que nunca
 * se le mandó nada.
 *
 * Aquí se afirma el `where` con el que se lee cada suma. El comportamiento contra etapas reales vive
 * en `etapas.int.test.ts` (Postgres); esto es la red que sí corre en cada `npm run test:unit`.
 */
describe('sugerirCaptura · la FORMA de las consultas (H1)', () => {
  const sesion = () => sesionDePrueba({ idEmpresaActiva: 7, permisos: ['produccion.wip-ver'] });

  /**
   * Cliente falso: la orden trae una celda (Rojo CH, 30 pedidas) y `etapaMovimientoDet.findMany`
   * responde según el tipo que se le pida, apuntando cada llamada para poder afirmar su `where`.
   */
  function bdFalso(porTipo: { corte: number; envio: number }): {
    bd: { cliente: PrismaClient };
    llamadas: { where: unknown }[];
    ordenFindFirst: ReturnType<typeof vi.fn>;
  } {
    const llamadas: { where: unknown }[] = [];
    const celda = { idColor: 1, idTalla: 11 };
    const ordenFindFirst = vi.fn(() =>
      Promise.resolve({
        id: 50,
        lineas: [
          {
            idColor: 1,
            color: { nombre: 'Rojo' },
            tallas: [{ idTalla: 11, cantidad: 30, talla: { etiqueta: 'CH', orden: 1 } }],
          },
        ],
      }),
    );
    const cliente = {
      orden: { findFirst: ordenFindFirst },
      etapaMovimientoDet: {
        findMany: (args: { where: { etapaMov: { tipo: string } } }) => {
          llamadas.push({ where: args.where });
          const cantidad = args.where.etapaMov.tipo === 'corte' ? porTipo.corte : porTipo.envio;
          return Promise.resolve(cantidad === 0 ? [] : [{ ...celda, cantidad }]);
        },
      },
    } as unknown as PrismaClient;
    return { bd: { cliente }, llamadas, ordenFindFirst };
  }

  it('la orden se busca SIEMPRE por la empresa activa de la sesión (A9)', async () => {
    const { bd, ordenFindFirst } = bdFalso({ corte: 0, envio: 0 });
    await sugerirCaptura(sesion(), 50, {}, bd);
    expect(ordenFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 50, idEmpresa: 7 },
    });
  });

  it('base CORTE: lee SOLO los cortes vivos, y no consulta envíos', async () => {
    const { bd, llamadas } = bdFalso({ corte: 10, envio: 0 });
    const sug = await sugerirCaptura(sesion(), 50, {}, bd);
    expect(sug.total).toBe(20); // 30 pedidas − 10 cortadas
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.where).toEqual({
      etapaMov: { idOrden: 50, tipo: 'corte', canceladoEn: null },
    });
  });

  it('⭐⭐ base ENVÍO: la lectura de lo enviado va FILTRADA POR EL PROCESO (D8)', async () => {
    const { bd, llamadas } = bdFalso({ corte: 30, envio: 12 });
    const sug = await sugerirCaptura(sesion(), 50, { idTipoProceso: 5 }, bd);
    expect(sug.total).toBe(18); // 30 cortadas − 12 ya enviadas A ESE PROCESO

    const corte = llamadas.find(
      (l) => (l.where as { etapaMov: { tipo: string } }).etapaMov.tipo === 'corte',
    );
    const envio = llamadas.find(
      (l) => (l.where as { etapaMov: { tipo: string } }).etapaMov.tipo === 'envio_maquila',
    );
    // El CORTE se lee entero (todos los cortes de la orden, sin proceso: no lo tiene)…
    expect(corte?.where).toEqual({
      etapaMov: { idOrden: 50, tipo: 'corte', canceladoEn: null },
    });
    // …y el ENVÍO, sólo el de ESTE proceso. Sin este filtro, los envíos de costura le restarían al
    // disponible de arte y viceversa.
    expect(envio?.where).toEqual({
      etapaMov: { idOrden: 50, tipo: 'envio_maquila', canceladoEn: null, idTipoProceso: 5 },
    });
  });

  it('las etapas CANCELADAS quedan fuera de las dos lecturas (`canceladoEn: null`)', async () => {
    const { bd, llamadas } = bdFalso({ corte: 30, envio: 5 });
    await sugerirCaptura(sesion(), 50, { idTipoProceso: 5 }, bd);
    expect(llamadas).toHaveLength(2);
    for (const l of llamadas) {
      expect((l.where as { etapaMov: { canceladoEn: null } }).etapaMov.canceladoEn).toBeNull();
    }
  });

  it('sin `produccion.wip-ver` no consulta nada (deny-by-default, A4)', async () => {
    const { bd, ordenFindFirst } = bdFalso({ corte: 0, envio: 0 });
    await expect(
      sugerirCaptura(sesionDePrueba({ idEmpresaActiva: 7, permisos: [] }), 50, {}, bd),
    ).rejects.toBeInstanceOf(Error);
    expect(ordenFindFirst).not.toHaveBeenCalled();
  });
});
