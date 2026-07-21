/**
 * Unit de la lógica PURA del loader EsMa (F6-E6) — sin BD:
 *  • `resolverMaquileroCabecera` — el FIX de estampado: se resuelve PRIMERO en `mapaMaquilero` (los
 *    cargos de estampado apuntan a un `Maquileros` con Proceso=1) y `mapaEstampador` es respaldo.
 *  • Núcleo del SALDO INICIAL de la ventana temporal (D3): `contribucionCargoExcluido` (solo cargos
 *    VALIDADOS suman, importe "ceronulo"), `SaldoInicialEsMa.sumar` (signos: +cargo/+abono,
 *    −pago/−descuento; por maquilero; inerte con ventana inactiva) y `calcularAsientosSaldoInicial`
 *    (neto cero → sin asiento; redondeo a 2 decimales; orden determinista).
 */
import { describe, expect, it } from 'vitest';

import type { ConfigVentana } from '../comun/ventana.js';
import {
  calcularAsientosSaldoInicial,
  contribucionCargoExcluido,
  resolverMaquileroCabecera,
  SaldoInicialEsMa,
} from './esma-cargos.js';

const maquileros = new Map<string, number>([
  ['7', 700],
  ['8', 800],
]);
const estampadores = new Map<string, number>([['9', 900]]);

describe('resolverMaquileroCabecera', () => {
  it('resuelve por mapaMaquilero (incluye el maquilero que hace estampado, Proceso=1)', () => {
    expect(resolverMaquileroCabecera('7', maquileros, estampadores)).toBe(700);
    expect(resolverMaquileroCabecera('8', maquileros, estampadores)).toBe(800);
  });

  it('cae a mapaEstampador solo si no está en maquileros (respaldo defensivo)', () => {
    expect(resolverMaquileroCabecera('9', maquileros, estampadores)).toBe(900);
  });

  it('devuelve null para vacío, "0" o sin mapeo', () => {
    expect(resolverMaquileroCabecera('', maquileros, estampadores)).toBeNull();
    expect(resolverMaquileroCabecera('0', maquileros, estampadores)).toBeNull();
    expect(resolverMaquileroCabecera('  ', maquileros, estampadores)).toBeNull();
    expect(resolverMaquileroCabecera('123', maquileros, estampadores)).toBeNull();
  });
});

// ── Saldo inicial de la ventana temporal (D3) ────────────────────────────────────────────────────

/** Ventana ACTIVA de laboratorio (corte fijo, determinista). */
const ventanaActiva: ConfigVentana = {
  anios: 0,
  refMs: Date.parse('2026-01-01T00:00:00.000Z'),
  corte: new Date('2025-01-01T00:00:00.000Z'),
};

/** Ventana INACTIVA (default de producción: sin corte). */
const ventanaInactiva: ConfigVentana = {
  anios: 0,
  refMs: Date.parse('2026-01-01T00:00:00.000Z'),
  corte: null,
};

describe('contribucionCargoExcluido (cargo excluido por ventana → aporte al saldo, D3)', () => {
  it('cargo VALIDADO (RevisionPendiente=0/vacía) suma cant×precio', () => {
    expect(
      contribucionCargoExcluido({ RevisionPendiente: '0', CantRecEsMa: '10', PrecioEsMa: '2.5' }),
    ).toBe(25);
    expect(contribucionCargoExcluido({ CantRecEsMa: '4', PrecioEsMa: '3' })).toBe(12);
  });

  it('cargo PENDIENTE (RevisionPendiente=1) NO suma (null) — v2 solo suma validados', () => {
    expect(
      contribucionCargoExcluido({ RevisionPendiente: '1', CantRecEsMa: '10', PrecioEsMa: '2.5' }),
    ).toBeNull();
    expect(contribucionCargoExcluido({ RevisionPendiente: '-1', CantRecEsMa: '9' })).toBeNull();
  });

  it('"ceronulo": cantidad o precio nulos → importe 0 (que luego no altera el neto)', () => {
    expect(contribucionCargoExcluido({ RevisionPendiente: '0', CantRecEsMa: '10' })).toBe(0);
    expect(contribucionCargoExcluido({ RevisionPendiente: '0', PrecioEsMa: '5' })).toBe(0);
    expect(contribucionCargoExcluido({ RevisionPendiente: '0' })).toBe(0);
  });
});

describe('SaldoInicialEsMa.sumar (signos del saldo derivado, por maquilero)', () => {
  it('acumula +cargo/+abono y −pago/−descuento, separado POR MAQUILERO', () => {
    const saldo = new SaldoInicialEsMa(ventanaActiva, new Set());
    // Maquilero 700: cargo validado 25 + abono 10 − pago 30 − descuento 3 = 2.
    saldo.sumar(700, 25); // cargo validado (cant×precio)
    saldo.sumar(700, 10); // abono (+1)
    saldo.sumar(700, -1 * 30); // pago (signoSaldo −1)
    saldo.sumar(700, -1 * 3); // descuento (signoSaldo −1)
    // Maquilero 800: solo un pago → neto negativo.
    saldo.sumar(800, -1 * 50);

    const { asientos, netoCero } = calcularAsientosSaldoInicial(saldo);
    expect(netoCero).toBe(0);
    expect(asientos).toHaveLength(2);
    expect(asientos[0]).toMatchObject({ idMaquilero: 700, neto: 2 });
    expect(asientos[1]).toMatchObject({ idMaquilero: 800, neto: -50 });
  });

  it('un ABONO NEGATIVO ("saldo anterior" del viejo) se preserva con su signo', () => {
    const saldo = new SaldoInicialEsMa(ventanaActiva, new Set());
    saldo.sumar(700, 1 * -200); // abono de −200 (signoSaldo +1, monto negativo)
    const { asientos } = calcularAsientosSaldoInicial(saldo);
    expect(asientos[0]?.neto).toBe(-200);
  });

  it('monto 0 no crea combo, y con ventana INACTIVA el acumulador es inerte', () => {
    const saldoActivo = new SaldoInicialEsMa(ventanaActiva, new Set());
    saldoActivo.sumar(700, 0);
    expect(saldoActivo.acumulador.combos).toBe(0);

    const saldoInactivo = new SaldoInicialEsMa(ventanaInactiva, new Set());
    expect(saldoInactivo.activa).toBe(false);
    saldoInactivo.sumar(700, 123.45);
    expect(saldoInactivo.acumulador.combos).toBe(0);
    expect(calcularAsientosSaldoInicial(saldoInactivo).asientos).toHaveLength(0);
  });
});

describe('calcularAsientosSaldoInicial (parte pura de los asientos)', () => {
  it('un maquilero cuyo neto cierra en CERO no genera asiento (cuenta en netoCero)', () => {
    const saldo = new SaldoInicialEsMa(ventanaActiva, new Set());
    saldo.sumar(700, 100);
    saldo.sumar(700, -100); // pago que cancela exacto
    saldo.sumar(800, 7);
    const { asientos, netoCero } = calcularAsientosSaldoInicial(saldo);
    expect(netoCero).toBe(1);
    expect(asientos).toHaveLength(1);
    expect(asientos[0]).toMatchObject({ idMaquilero: 800, neto: 7 });
  });

  it('redondea el neto a 2 decimales (sin artefactos de coma flotante)', () => {
    const saldo = new SaldoInicialEsMa(ventanaActiva, new Set());
    saldo.sumar(700, 0.1);
    saldo.sumar(700, 0.2); // 0.1 + 0.2 = 0.30000000000000004 en flotante
    saldo.sumar(800, 10.333333);
    const { asientos } = calcularAsientosSaldoInicial(saldo);
    expect(asientos[0]?.neto).toBe(0.3);
    expect(asientos[1]?.neto).toBe(10.33);
  });

  it('conserva renglones/entradas/salidas para la traza del asiento', () => {
    const saldo = new SaldoInicialEsMa(ventanaActiva, new Set());
    saldo.sumar(700, 25);
    saldo.sumar(700, -30);
    const { asientos } = calcularAsientosSaldoInicial(saldo);
    expect(asientos[0]).toMatchObject({ renglones: 2, entradas: 25, salidas: 30, neto: -5 });
  });
});
