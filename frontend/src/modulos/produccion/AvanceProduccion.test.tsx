import { describe, expect, it } from 'vitest';

import type { WipOrden } from '@/api/tipos';

import { estatusDeFila } from '@/modulos/ordenes/CentroOrdenesPagina';

import { claveEtapaDeMovimiento, pasosDesdeWip } from './AvanceProduccion';

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
  recibidoCostura: 1500,
  entregado: 900,
  porEntregar: 600, // recibidoCostura 1500 − entregado 900
  porCortar: [],
  cortadoPorEnviar: [],
  porRecibir: [
    {
      idTipoProceso: 5,
      tipoProceso: 'Costura',
      codigoProceso: 'costura',
      generaEntradaPt: true,
      celdas: [],
      totalPendiente: 226, // enviado costura 1726 − recibido costura 1500
      porMaquilero: [],
    },
    {
      idTipoProceso: 6,
      tipoProceso: 'Estampado',
      codigoProceso: 'estampado',
      generaEntradaPt: false,
      celdas: [],
      totalPendiente: 374,
      porMaquilero: [],
    },
  ],
  entregadoCeldas: [],
};

describe('pasosDesdeWip (totales del stepper derivados del servidor)', () => {
  it('separa costura y aplicación: enviado costura = recibidoCostura + porRecibir(costura)', () => {
    const pasos = pasosDesdeWip(wipBase);
    const porClave = new Map(pasos.map((p) => [p.clave, p]));
    expect(porClave.get('corte')?.hecho).toBe(1726);
    expect(porClave.get('entrega-maquila')?.hecho).toBe(1726); // 1500 + 226
    expect(porClave.get('recibo-maquila')?.hecho).toBe(1500);
    expect(porClave.get('entrega-aplicacion')?.hecho).toBe(774); // 2500 − 1726
    expect(porClave.get('recibo-aplicacion')?.hecho).toBe(400); // 1900 − 1500
    expect(pasos.every((p) => p.total === 1726)).toBe(true);
  });

  it('la 6ª etapa es la ENTREGA A CLIENTE y sale del `entregado` del servidor (V1-E3a)', () => {
    // Antes el stepper terminaba en "Recibo de Arte": el ciclo de la OP no cerraba visualmente y la
    // entrega —que existe y funciona— no la enlazaba nada.
    const pasos = pasosDesdeWip(wipBase);
    expect(pasos).toHaveLength(6);
    expect(pasos[5]).toEqual({
      clave: 'entrega-cliente',
      etiqueta: 'Entrega a cliente',
      hecho: 900,
      total: 1726,
    });
  });

  it('una orden sin movimientos queda toda en cero (etapas vacías)', () => {
    const pasos = pasosDesdeWip({
      ...wipBase,
      cortado: 0,
      enviado: 0,
      recibido: 0,
      recibidoCostura: 0,
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
