import { describe, expect, it } from 'vitest';

import type { WipOrden } from '@/api/tipos';

import { estatusDeFila } from '@/modulos/ordenes/CentroOrdenesPagina';

import { claveEtapaDeMovimiento, pasosDesdeWip, pendientesDesdeWip } from './AvanceProduccion';

/**
 * Unit de las derivaciones PURAS del rediseño R2: a qué etapa del stepper cae cada movimiento
 * (costura vs aplicación por `generaEntradaPt`), los totales del stepper desde el WIP del
 * servidor, y el chip de estatus de la fila del centro (proto `opEstatus`). El flujo completo
 * (abrir avance, capturar, cancelar) vive en el e2e.
 */

const wipBase: WipOrden = {
  idOrden: 1,
  folio: 5424,
  estado: 'completa',
  idModelo: 3,
  codigoModelo: '62182',
  idCliente: 4,
  cliente: 'C&A',
  pedido: 1726,
  cortado: 1726,
  enviado: 2500, // 1726 costura + 774 aplicación
  recibido: 1900, // 1500 costura + 400 aplicación
  incompletas: 0,
  faltantesSaldados: 0,
  pendientePorRecibir: 600, // enviado 2500 − recibido 1900 − incompletas 0
  enviadoCostura: 1726,
  recibidoCostura: 1500,
  // 0.114: Σ empacado (etapas de empaque vivas), publicado por el servidor. Es una cantidad PROPIA
  // —aquí se empacaron 1,400 de las 1,500 recibidas— y no se deriva de ninguna otra cifra.
  empacado: 1400,
  entregado: 900,
  porEntregar: 600, // recibidoCostura 1500 − entregado 900
  porCortar: [],
  cortadoCeldas: [],
  cortadoPorEnviar: [],
  porRecibir: [
    {
      idTipoProceso: 5,
      tipoProceso: 'Costura',
      codigoProceso: 'costura',
      generaEntradaPt: true,
      devuelveAPt: false,
      stockSinOrden: false,
      celdas: [],
      totalPendiente: 226, // enviado costura 1726 − recibido costura 1500
      porMaquilero: [],
    },
    {
      idTipoProceso: 6,
      tipoProceso: 'Estampado',
      codigoProceso: 'estampado',
      generaEntradaPt: false,
      devuelveAPt: false,
      stockSinOrden: false,
      celdas: [],
      totalPendiente: 374,
      porMaquilero: [],
    },
  ],
  entregadoCeldas: [],
};

describe('pasosDesdeWip (totales del stepper derivados del servidor)', () => {
  it('separa costura y aplicación con los totales que publica el SERVIDOR', () => {
    const pasos = pasosDesdeWip(wipBase);
    const porClave = new Map(pasos.map((p) => [p.clave, p]));
    expect(porClave.get('corte')?.hecho).toBe(1726);
    expect(porClave.get('entrega-maquila')?.hecho).toBe(1726); // `enviadoCostura` del servidor
    expect(porClave.get('recibo-maquila')?.hecho).toBe(1500);
    expect(porClave.get('entrega-aplicacion')?.hecho).toBe(774); // 2500 − 1726 (el complemento)
    expect(porClave.get('recibo-aplicacion')?.hecho).toBe(400); // 1900 − 1500
    expect(pasos.every((p) => p.total === 1726)).toBe(true);
  });

  it('⭐ con INCOMPLETAS entregadas el stepper NO encoge lo enviado ni se lo regala a Arte (V1-E8v)', () => {
    // 🔴 LA NOVENA PUERTA (hallazgo del reviewer). Hasta V1-E8v esta función DESPEJABA lo enviado a
    // costura del pendiente (`recibidoCostura + Σ totalPendiente`), o sea invertía la fórmula del
    // pendiente. Desde que el pendiente resta las prendas incompletas (§Post-F9.147), ese despeje
    // devolvía `enviado − incompletas`: la pantalla decía que al maquilero se le mandaron 1706 de
    // 1726 —MENOS de lo que se le mandó— y las 20 que faltaban se las sumaba a Arte (794 en vez de
    // 774). Es el REVERSO del estado prohibido de esta etapa.
    //
    // ⚠️ El fixture base lleva `incompletas: 0`, que es justo el sesgo que esconde este defecto:
    // con ceros coherentes la aritmética rota queda invisible. Aquí van ≠ 0 A PROPÓSITO.
    // Escenario: de 1726 enviadas a costura vuelven 1500 buenas + 20 incompletas ⇒ pendiente 206.
    const conIncompletas: WipOrden = {
      ...wipBase,
      incompletas: 20,
      pendientePorRecibir: 580, // 2500 − 1900 − 20
      porRecibir: [
        { ...(wipBase.porRecibir[0] as WipOrden['porRecibir'][number]), totalPendiente: 206 },
        wipBase.porRecibir[1] as WipOrden['porRecibir'][number],
      ],
    };
    const porClave = new Map(pasosDesdeWip(conIncompletas).map((p) => [p.clave, p]));
    // Lo ENVIADO no se mueve porque vuelvan incompletas: se mandaron 1726 y se mandaron 1726.
    expect(porClave.get('entrega-maquila')?.hecho).toBe(1726);
    // Y a Arte no se le inventan piezas: sigue siendo 2500 − 1726.
    expect(porClave.get('entrega-aplicacion')?.hecho).toBe(774);
    // Lo recibido tampoco cambia: la incompleta no se produjo (regla 1 de §Post-F9.136).
    expect(porClave.get('recibo-maquila')?.hecho).toBe(1500);
    expect(porClave.get('recibo-aplicacion')?.hecho).toBe(400);
  });

  it('⭐ el PENDIENTE del resumen se CONSUME del servidor: no se resta enviado − recibido (V1-E8v)', () => {
    // 🔴 LA DÉCIMA PUERTA, y fue una REGRESIÓN del arreglo de la novena. El resumen calculaba
    // `enviadoCostura − recibidoCostura`. Mientras `enviadoCostura` era el DESPEJE del pendiente esa
    // resta daba el número correcto por casualidad; al volverlo SUMA DIRECTA pasó a valer
    // `enviado − buenas`, o sea **con las incompletas dentro**. La tarjeta decía «por recibir 2»
    // mientras el mismo panel topaba la captura en 0.
    //
    // Escenario de Daniel: 10 enviadas a costura, vuelven 8 buenas + 2 incompletas ⇒ el servidor
    // publica `totalPendiente: 0`. La tarjeta tiene que decir 0, no 2.
    const wip: WipOrden = {
      ...wipBase,
      pedido: 10,
      cortado: 10,
      enviado: 10,
      recibido: 8,
      incompletas: 2,
      pendientePorRecibir: 0,
      enviadoCostura: 10,
      recibidoCostura: 8,
      porRecibir: [
        {
          ...(wipBase.porRecibir[0] as WipOrden['porRecibir'][number]),
          generaEntradaPt: true,
          totalPendiente: 0, // 10 − 8 buenas − 2 incompletas
        },
      ],
    };
    // `enviado − recibido` daría 2; el pendiente REAL del servidor es 0.
    expect(wip.enviadoCostura - wip.recibidoCostura).toBe(2);
    expect(pendientesDesdeWip(wip).costura).toBe(0);
  });

  it('⭐ el pendiente de ARTE también se consume (mismo defecto, otro bloque)', () => {
    const wip: WipOrden = {
      ...wipBase,
      enviado: 20,
      recibido: 16,
      incompletas: 4,
      enviadoCostura: 10,
      recibidoCostura: 8,
      porRecibir: [
        {
          ...(wipBase.porRecibir[0] as WipOrden['porRecibir'][number]),
          generaEntradaPt: true,
          totalPendiente: 0,
        },
        {
          ...(wipBase.porRecibir[1] as WipOrden['porRecibir'][number]),
          generaEntradaPt: false,
          totalPendiente: 0, // 10 enviadas − 8 buenas − 2 incompletas
        },
      ],
    };
    expect(pendientesDesdeWip(wip).aplicacion).toBe(0);
    // Y el histórico migrado (recibo sin envío ⇒ pendiente negativo) se pisa a 0, no a −N.
    const migrado: WipOrden = {
      ...wip,
      porRecibir: [
        {
          ...(wipBase.porRecibir[1] as WipOrden['porRecibir'][number]),
          generaEntradaPt: false,
          totalPendiente: -3,
        },
      ],
    };
    expect(pendientesDesdeWip(migrado).aplicacion).toBe(0);
  });

  it('la ÚLTIMA etapa es la ENTREGA A CLIENTE y sale del `entregado` del servidor (V1-E3a)', () => {
    // Antes el stepper terminaba en "Recibo de Arte": el ciclo de la OP no cerraba visualmente y la
    // entrega —que existe y funciona— no la enlazaba nada. Desde 0.114 son SIETE pasos (entró el
    // empaque antes del cierre), así que se mira la última posición, no el índice 5 a pelo.
    const pasos = pasosDesdeWip(wipBase);
    expect(pasos).toHaveLength(7);
    expect(pasos.at(-1)).toEqual({
      clave: 'entrega-cliente',
      etiqueta: 'Entrega a cliente',
      hecho: 900,
      total: 1726,
    });
  });

  it('⭐ el EMPAQUE es su propio paso y sale de `empacado` del servidor (0.114)', () => {
    // La cantidad del empaque es PROPIA: no se deriva de lo recibido ni de lo entregado. El fixture
    // trae 1,400 empacadas con 1,500 recibidas de costura y 900 entregadas — tres cifras distintas
    // a propósito, para que un despeje accidental desde cualquiera de las otras dos falle aquí.
    const pasos = pasosDesdeWip(wipBase);
    const empaque = pasos.find((p) => p.clave === 'empaque');
    expect(empaque).toEqual({
      clave: 'empaque',
      etiqueta: 'Empaque',
      hecho: 1400,
      total: 1726,
    });
    // Y va JUSTO ANTES del cierre del ciclo: se empaca lo que ya volvió, antes de mandarlo.
    expect(pasos.map((p) => p.clave).slice(-2)).toEqual(['empaque', 'entrega-cliente']);
  });

  it('una orden sin movimientos queda toda en cero (etapas vacías)', () => {
    const pasos = pasosDesdeWip({
      ...wipBase,
      cortado: 0,
      enviado: 0,
      recibido: 0,
      incompletas: 0,
      pendientePorRecibir: 0,
      // ⚠️ Antes este fixture heredaba `enviadoCostura` del base y el defecto no se veía porque la
      // pantalla lo DESPEJABA (con `porRecibir: []` el despeje daba 0 por casualidad). Ahora es un
      // dato del servidor: una orden sin movimientos tiene 0, y decir otra cosa era incoherente.
      enviadoCostura: 0,
      recibidoCostura: 0,
      empacado: 0,
      entregado: 0,
      porEntregar: 0,
      porRecibir: [],
    });
    expect(pasos.every((p) => p.hecho === 0)).toBe(true);
  });
});

describe('claveEtapaDeMovimiento (costura vs aplicación por generaEntradaPt)', () => {
  const esCostura = (id: number): boolean => id === 5;

  it('corte siempre cae en la etapa corte', () => {
    expect(claveEtapaDeMovimiento({ tipo: 'corte', idTipoProceso: null }, esCostura)).toBe('corte');
  });

  it('envío de costura → entrega a maquila; envío de estampado → entrega aplicación', () => {
    expect(claveEtapaDeMovimiento({ tipo: 'envio_maquila', idTipoProceso: 5 }, esCostura)).toBe(
      'entrega-maquila',
    );
    expect(claveEtapaDeMovimiento({ tipo: 'envio_maquila', idTipoProceso: 6 }, esCostura)).toBe(
      'entrega-aplicacion',
    );
  });

  it('recibo de costura → recibo de maquila; recibo de estampado → recibo aplicación', () => {
    expect(claveEtapaDeMovimiento({ tipo: 'recibo_maquila', idTipoProceso: 5 }, esCostura)).toBe(
      'recibo-maquila',
    );
    expect(claveEtapaDeMovimiento({ tipo: 'recibo_maquila', idTipoProceso: 6 }, esCostura)).toBe(
      'recibo-aplicacion',
    );
  });

  it('la entrega a cliente NO viaja en ESTE historial (null): tiene el suyo', () => {
    // Sí es una etapa del stepper desde V1-E3a, pero `listarEtapasOrden` solo devuelve cortes,
    // envíos y recibos: las entregas se leen de `GET /ordenes/{id}/entregas`. Si algún día el
    // historial de etapas las incluyera, este clasificador las mandaría a `null` (fuera de toda
    // etapa) y desaparecerían de la lista — de ahí la prueba.
    expect(
      claveEtapaDeMovimiento({ tipo: 'entrega_cliente', idTipoProceso: null }, esCostura),
    ).toBe(null);
  });
});

describe('estatusDeFila (chip del centro, proto opEstatus)', () => {
  it('cancelada gana a todo', () => {
    expect(estatusDeFila({ estado: 'cancelada', cantOrdenada: 10, cantCortada: 10 })).toEqual({
      tono: 'crit',
      texto: 'Cancelada',
    });
  });

  it('sin corte → neutro; parcial → ámbar; completo (o sobre-corte) → verde', () => {
    expect(estatusDeFila({ estado: 'completa', cantOrdenada: 10, cantCortada: 0 }).texto).toBe(
      'Sin cortar',
    );
    expect(estatusDeFila({ estado: 'completa', cantOrdenada: 10, cantCortada: 4 }).tono).toBe(
      'warn',
    );
    expect(estatusDeFila({ estado: 'completa', cantOrdenada: 10, cantCortada: 12 }).tono).toBe(
      'ok',
    );
  });

  it('una orden sin matriz (ordenada 0) no se marca "Cortada" aunque tenga cortes', () => {
    expect(estatusDeFila({ estado: 'capturada', cantOrdenada: 0, cantCortada: 5 }).texto).toBe(
      'En proceso',
    );
  });
});
