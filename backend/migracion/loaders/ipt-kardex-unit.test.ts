/**
 * Unit (sin BD) de los helpers PUROS del loader de kardex IPT (F3-E6 Pieza B):
 *  • `tipoDestino`: decisión del código de tipo de movimiento a partir de IdIPT_TipoMov + EnSa.
 *  • `construirObservaciones`: obs + referencia + IdRecibos (traza, no FK).
 *  • El ACUMULADOR de saldos iniciales de la ventana temporal (`comun/saldo-inicial.ts`) y sus
 *    claves por combo: neto entradas−salidas, combos separados, neto negativo, y que con ventana
 *    INACTIVA (default) `esPreCorte` nunca condensa nada (comportamiento actual intacto).
 */
import { describe, expect, it } from 'vitest';

import { AcumuladorSaldos, esPreCorte } from '../comun/saldo-inicial.js';
import type { ConfigVentana } from '../comun/ventana.js';
import {
  claveComboIpt,
  construirObservaciones,
  origenIdSaldoInicialIpt,
  tipoDestino,
  type ComboIpt,
  type MovCrudo,
} from './ipt-kardex.js';

describe('tipoDestino — mapeo IdIPT_TipoMov + EnSa → código de v2', () => {
  it('tipo conocido cuya dirección casa con EnSa → su código (caso normal)', () => {
    // 1 = inventario-inicial (entrada), EnSa 1.
    expect(tipoDestino(1, 1)).toEqual({
      codigo: 'inventario-inicial',
      discordante: false,
      vacio: false,
    });
    // 5 = entrega-cliente (salida), EnSa 2.
    expect(tipoDestino(5, 2)).toEqual({
      codigo: 'entrega-cliente',
      discordante: false,
      vacio: false,
    });
  });

  it('tipo 0/vacío → Otras Entradas/Salidas según EnSa (vacio=true)', () => {
    expect(tipoDestino(0, 1)).toEqual({
      codigo: 'otras-entradas',
      discordante: false,
      vacio: true,
    });
    expect(tipoDestino(null, 2)).toEqual({
      codigo: 'otras-salidas',
      discordante: false,
      vacio: true,
    });
  });

  it('tipo 9 (traspaso, dir 3) NO casa con EnSa → Otras por EnSa (discordante=true)', () => {
    expect(tipoDestino(9, 1)).toEqual({
      codigo: 'otras-entradas',
      discordante: true,
      vacio: false,
    });
    expect(tipoDestino(9, 2)).toEqual({ codigo: 'otras-salidas', discordante: true, vacio: false });
  });

  it('tipo desconocido (fuera de 1..19) → Otras por EnSa (discordante=true)', () => {
    expect(tipoDestino(99, 1)).toEqual({
      codigo: 'otras-entradas',
      discordante: true,
      vacio: false,
    });
  });

  it('EnSa inválido sin código de respaldo → null (irresoluble)', () => {
    expect(tipoDestino(0, 3)).toBeNull();
    expect(tipoDestino(99, null)).toBeNull();
  });

  it('error-entrada (tipo 11, dir salida) casa con EnSa 2', () => {
    expect(tipoDestino(11, 2)).toEqual({
      codigo: 'error-entrada',
      discordante: false,
      vacio: false,
    });
  });
});

describe('construirObservaciones', () => {
  const base: MovCrudo = {
    fecha: null,
    idTipoMov: 1,
    enSa: 1,
    idAlmacenV1: '1',
    referencia: null,
    obs: null,
    idRecibos: null,
  };

  it('junta obs + referencia + IdRecibos como traza', () => {
    const texto = construirObservaciones({
      ...base,
      obs: 'Inventario Inicial',
      referencia: 'Inv 2020',
      idRecibos: '555',
    });
    expect(texto).toContain('Inventario Inicial');
    expect(texto).toContain('Ref: Inv 2020');
    expect(texto).toContain('[v1 IdRecibos=555]');
  });

  it('no duplica la referencia cuando es igual a la observación', () => {
    const texto = construirObservaciones({ ...base, obs: 'igual', referencia: 'igual' });
    expect(texto).toBe('igual');
  });

  it('todo vacío → null', () => {
    expect(construirObservaciones(base)).toBeNull();
  });

  it('solo IdRecibos → solo la traza', () => {
    expect(construirObservaciones({ ...base, idRecibos: '777' })).toBe('[v1 IdRecibos=777]');
  });
});

// ── Acumulador de SALDOS INICIALES (ventana temporal) ───────────────────────────────────────────

/** Ventana ACTIVA con corte fijo (2025-01-01), para pruebas deterministas. */
const VENTANA_ACTIVA: ConfigVentana = {
  anios: 10,
  refMs: Date.UTC(2035, 0, 1),
  corte: new Date(Date.UTC(2025, 0, 1)),
};

/** Ventana INACTIVA (default de producción: `ETL_VENTANA_ANIOS=0` → corte null). */
const VENTANA_INACTIVA: ConfigVentana = { anios: 0, refMs: Date.UTC(2026, 0, 1), corte: null };

const COMBO_A: ComboIpt = { idEmpresa: 1, idAlmacen: 2, idModelo: 30 };
const COMBO_B: ComboIpt = { idEmpresa: 1, idAlmacen: 3, idModelo: 30 };

describe('AcumuladorSaldos — neto del histórico pre-corte por combo', () => {
  it('neto correcto con entradas y salidas mezcladas en un mismo combo', () => {
    const acum = new AcumuladorSaldos<ComboIpt>();
    acum.agregar(claveComboIpt(COMBO_A), COMBO_A, 'entrada', 100);
    acum.agregar(claveComboIpt(COMBO_A), COMBO_A, 'salida', 30);
    acum.agregar(claveComboIpt(COMBO_A), COMBO_A, 'entrada', 5);
    acum.agregar(claveComboIpt(COMBO_A), COMBO_A, 'salida', 25);

    expect(acum.combos).toBe(1);
    expect(acum.renglones).toBe(4);
    const [saldo] = acum.saldos();
    expect(saldo).toMatchObject({ neto: 50, entradas: 105, salidas: 55, renglones: 4 });
    expect(saldo?.datos).toEqual(COMBO_A);
  });

  it('combos distintos acumulan por separado (mismo modelo, otro almacén)', () => {
    const acum = new AcumuladorSaldos<ComboIpt>();
    acum.agregar(claveComboIpt(COMBO_A), COMBO_A, 'entrada', 10);
    acum.agregar(claveComboIpt(COMBO_B), COMBO_B, 'entrada', 7);
    acum.agregar(claveComboIpt(COMBO_B), COMBO_B, 'salida', 2);

    expect(acum.combos).toBe(2);
    const porClave = new Map(acum.saldos().map((s) => [s.clave, s.neto]));
    expect(porClave.get(claveComboIpt(COMBO_A))).toBe(10);
    expect(porClave.get(claveComboIpt(COMBO_B))).toBe(5);
  });

  it('neto NEGATIVO se preserva (más salidas que entradas — descuadre del viejo)', () => {
    const acum = new AcumuladorSaldos<ComboIpt>();
    acum.agregar(claveComboIpt(COMBO_A), COMBO_A, 'entrada', 10);
    acum.agregar(claveComboIpt(COMBO_A), COMBO_A, 'salida', 45);
    const [saldo] = acum.saldos();
    expect(saldo?.neto).toBe(-35);
  });

  it('los saldos salen ORDENADOS por clave (corridas deterministas)', () => {
    const acum = new AcumuladorSaldos<ComboIpt>();
    acum.agregar(claveComboIpt(COMBO_B), COMBO_B, 'entrada', 1);
    acum.agregar(claveComboIpt(COMBO_A), COMBO_A, 'entrada', 1);
    expect(acum.saldos().map((s) => s.clave)).toEqual(
      [claveComboIpt(COMBO_A), claveComboIpt(COMBO_B)].sort(),
    );
  });
});

describe('esPreCorte — con ventana INACTIVA no se condensa nada (comportamiento actual intacto)', () => {
  it('ventana inactiva (corte null) → SIEMPRE false, aunque la fecha sea antiquísima', () => {
    expect(esPreCorte(new Date(Date.UTC(1900, 0, 1)), VENTANA_INACTIVA)).toBe(false);
    expect(esPreCorte(new Date(Date.UTC(2020, 5, 15)), VENTANA_INACTIVA)).toBe(false);
    expect(esPreCorte(null, VENTANA_INACTIVA)).toBe(false);
  });

  it('ventana activa: fecha < corte condensa; fecha ≥ corte migra individual; null no condensa', () => {
    expect(esPreCorte(new Date(Date.UTC(2024, 11, 31)), VENTANA_ACTIVA)).toBe(true);
    expect(esPreCorte(new Date(Date.UTC(2025, 0, 1)), VENTANA_ACTIVA)).toBe(false);
    expect(esPreCorte(new Date(Date.UTC(2025, 6, 1)), VENTANA_ACTIVA)).toBe(false);
    expect(esPreCorte(null, VENTANA_ACTIVA)).toBe(false);
  });

  it('sin renglones acumulados no hay saldos que crear (ningún movimiento sintético)', () => {
    const acum = new AcumuladorSaldos<ComboIpt>();
    expect(acum.combos).toBe(0);
    expect(acum.saldos()).toEqual([]);
  });
});

describe('origenIdSaldoInicialIpt — idempotencia estable de los sintéticos', () => {
  it('clave determinista por combo, con prefijo que NO colisiona con IdIPT_MovsDet numéricos', () => {
    expect(origenIdSaldoInicialIpt(COMBO_A)).toBe('saldo-inicial:e1:a2:m30');
    expect(origenIdSaldoInicialIpt(COMBO_A)).toBe(origenIdSaldoInicialIpt({ ...COMBO_A }));
    expect(origenIdSaldoInicialIpt(COMBO_A)).not.toBe(origenIdSaldoInicialIpt(COMBO_B));
  });
});
