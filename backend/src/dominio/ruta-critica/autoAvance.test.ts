/**
 * Tests UNITARIOS (sin BD) del auto-avance de la RC (F5-E6):
 *  • `tipoEventoDeEtapa` — el mapeo evento(etapa)+costura → `TipoEventoProceso` (corte/costura/
 *    estampado/entrega), incluida la rama costura vs estampado por `generaEntradaPt`.
 *  • `calcularCompletitud` — completitud color×talla: parcial, completo EXACTO, SOBRE-cantidad,
 *    sin avance, orden sin nada pedido.
 *  • `completitudRecepcionTela` — completitud por saldo de líneas de OC de tela (parcial/completo/
 *    sin líneas), con tolerancia de redondeo.
 */
import { describe, expect, it } from 'vitest';

import { TipoEventoProceso } from '../../datos/index.js';
import { calcularCompletitud, completitudRecepcionTela, tipoEventoDeEtapa } from './autoAvance.js';

describe('tipoEventoDeEtapa', () => {
  it('corte → corte', () => {
    expect(tipoEventoDeEtapa('corte', false)).toBe(TipoEventoProceso.corte);
    expect(tipoEventoDeEtapa('corte', true)).toBe(TipoEventoProceso.corte);
  });

  it('envío: costura → envioCostura; no costura → envioEstampado', () => {
    expect(tipoEventoDeEtapa('envio_maquila', true)).toBe(TipoEventoProceso.envioCostura);
    expect(tipoEventoDeEtapa('envio_maquila', false)).toBe(TipoEventoProceso.envioEstampado);
  });

  it('recibo: costura → reciboCostura; no costura → reciboEstampado', () => {
    expect(tipoEventoDeEtapa('recibo_maquila', true)).toBe(TipoEventoProceso.reciboCostura);
    expect(tipoEventoDeEtapa('recibo_maquila', false)).toBe(TipoEventoProceso.reciboEstampado);
  });

  it('entrega → entregaCliente (independiente de costura)', () => {
    expect(tipoEventoDeEtapa('entrega_cliente', false)).toBe(TipoEventoProceso.entregaCliente);
    expect(tipoEventoDeEtapa('entrega_cliente', true)).toBe(TipoEventoProceso.entregaCliente);
  });
});

describe('calcularCompletitud (color×talla)', () => {
  const pedido = [
    { idColor: 1, idTalla: 10, cantidad: 10 },
    { idColor: 1, idTalla: 11, cantidad: 20 },
  ];

  it('parcial: cubre una celda pero no la otra', () => {
    const r = calcularCompletitud(pedido, [{ idColor: 1, idTalla: 10, cantidad: 10 }]);
    expect(r.completo).toBe(false);
    expect(r.hayAvance).toBe(true);
  });

  it('completo EXACTO: todas las celdas cubiertas justas', () => {
    const r = calcularCompletitud(pedido, [
      { idColor: 1, idTalla: 10, cantidad: 10 },
      { idColor: 1, idTalla: 11, cantidad: 20 },
    ]);
    expect(r.completo).toBe(true);
    expect(r.hayAvance).toBe(true);
  });

  it('SOBRE-cantidad: pasado > pedido también es completo (≥, no =)', () => {
    const r = calcularCompletitud(pedido, [
      { idColor: 1, idTalla: 10, cantidad: 15 },
      { idColor: 1, idTalla: 11, cantidad: 25 },
    ]);
    expect(r.completo).toBe(true);
  });

  it('suma varias etapas de la misma celda antes de comparar', () => {
    const r = calcularCompletitud(pedido, [
      { idColor: 1, idTalla: 10, cantidad: 6 },
      { idColor: 1, idTalla: 10, cantidad: 4 }, // 6+4 = 10 cubre la CH
      { idColor: 1, idTalla: 11, cantidad: 20 },
    ]);
    expect(r.completo).toBe(true);
  });

  it('sin avance: nada pasó', () => {
    const r = calcularCompletitud(pedido, []);
    expect(r.completo).toBe(false);
    expect(r.hayAvance).toBe(false);
  });

  it('orden sin nada pedido (>0): NO se considera completo (evita falso positivo)', () => {
    const r = calcularCompletitud(
      [{ idColor: 1, idTalla: 10, cantidad: 0 }],
      [{ idColor: 1, idTalla: 10, cantidad: 5 }],
    );
    expect(r.completo).toBe(false);
    expect(r.hayAvance).toBe(true);
  });

  it('ignora celdas pedidas con cantidad 0 al evaluar completitud', () => {
    const pedidoConCero = [
      { idColor: 1, idTalla: 10, cantidad: 10 },
      { idColor: 1, idTalla: 12, cantidad: 0 }, // no exige avance
    ];
    const r = calcularCompletitud(pedidoConCero, [{ idColor: 1, idTalla: 10, cantidad: 10 }]);
    expect(r.completo).toBe(true);
  });
});

describe('completitudRecepcionTela (saldo de OC)', () => {
  it('sin líneas de tela: ni completo ni avance', () => {
    const r = completitudRecepcionTela([]);
    expect(r).toEqual({ completo: false, hayAvance: false });
  });

  it('parcial: una línea recibida, otra no', () => {
    const r = completitudRecepcionTela([
      { pedido: 100, recibido: 100 },
      { pedido: 50, recibido: 0 },
    ]);
    expect(r.completo).toBe(false);
    expect(r.hayAvance).toBe(true);
  });

  it('completo: todas recibidas (≥ pedido, con tolerancia)', () => {
    const r = completitudRecepcionTela([
      { pedido: 100, recibido: 100 },
      { pedido: 50, recibido: 50.0000001 },
    ]);
    expect(r.completo).toBe(true);
    expect(r.hayAvance).toBe(true);
  });

  it('sin avance: ninguna recibida', () => {
    const r = completitudRecepcionTela([{ pedido: 100, recibido: 0 }]);
    expect(r.completo).toBe(false);
    expect(r.hayAvance).toBe(false);
  });
});
