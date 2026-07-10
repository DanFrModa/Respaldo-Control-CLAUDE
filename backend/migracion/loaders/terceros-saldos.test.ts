/**
 * Unit del PARSEO del CSV de saldos iniciales (F9-E6). Ejercita `parsearAperturas` (pura, sin BD)
 * sobre filas crudas: los dos modos (detalle de factura pendiente / saldo neto), la decisión de
 * origen+fiscal, las claves de idempotencia y las incidencias (nada se pierde en silencio, §7).
 */
import { describe, expect, it } from 'vitest';

import { parsearAperturas } from './terceros-saldos.js';

/** Corte fijo para las pruebas de saldo neto sin fecha. */
const CORTE = new Date('2026-06-30T00:00:00.000Z');

describe('parsearAperturas — modo DETALLE (factura pendiente)', () => {
  it('con UUID → cargo FISCAL (factura_proveedor), clave=uuid, rfc sellado', () => {
    const { filas, incidencias } = parsearAperturas([
      {
        tipo: 'proveedor',
        rfc: 'AAA010101AA1',
        nombre: 'Telas del Norte',
        fecha: '2026-01-15',
        importe: '1160.00',
        uuid: 'UUID-1',
      },
    ]);
    expect(incidencias).toHaveLength(0);
    expect(filas).toHaveLength(1);
    const m = filas[0]!.movimiento;
    expect(m.origen).toBe('factura_proveedor');
    expect(m.esFiscal).toBe(true);
    expect(m.importe).toBe(1160);
    expect(m.uuidCfdi).toBe('UUID-1');
    expect(m.rfcTercero).toBe('AAA010101AA1');
    expect(m.claveFuente).toBe('uuid:UUID-1');
    // La fecha se preserva (aging desde el día 1).
    expect(m.fecha.toISOString().slice(0, 10)).toBe('2026-01-15');
  });

  it('cliente con UUID → factura_cliente', () => {
    const { filas } = parsearAperturas([
      { tipo: 'cliente', rfc: 'XAXX010101000', fecha: '2026-02-01', importe: '500', uuid: 'U2' },
    ]);
    expect(filas[0]!.movimiento.origen).toBe('factura_cliente');
    expect(filas[0]!.movimiento.esFiscal).toBe(true);
  });

  it('sin UUID pero con folio → entrada_sin_factura NO fiscal, clave=folio:…', () => {
    const { filas, incidencias } = parsearAperturas([
      {
        tipo: 'proveedor',
        rfc: 'AAA010101AA1',
        fecha: '15/01/2026',
        importe: '250.50',
        folio: 'F-9',
      },
    ]);
    expect(incidencias).toHaveLength(0);
    const m = filas[0]!.movimiento;
    expect(m.origen).toBe('entrada_sin_factura');
    expect(m.esFiscal).toBe(false);
    expect(m.uuidCfdi).toBeNull();
    expect(m.rfcTercero).toBeNull();
    expect(m.claveFuente).toBe('folio:proveedor:AAA010101AA1:F-9');
    // Acepta el DD/MM/YYYY del sistema viejo.
    expect(m.fecha.toISOString().slice(0, 10)).toBe('2026-01-15');
  });

  it('sin UUID y sin folio → OMITIDA (sin clave de idempotencia)', () => {
    const { filas, incidencias } = parsearAperturas([
      { tipo: 'proveedor', rfc: 'AAA010101AA1', fecha: '2026-01-15', importe: '100' },
    ]);
    expect(filas).toHaveLength(0);
    expect(incidencias[0]!.motivo).toMatch(/sin clave de idempotencia/);
  });

  it('factura sin fecha → OMITIDA (el aging la necesita)', () => {
    const { filas, incidencias } = parsearAperturas([
      { tipo: 'proveedor', rfc: 'AAA010101AA1', importe: '100', folio: 'F1' },
    ]);
    expect(filas).toHaveLength(0);
    expect(incidencias[0]!.motivo).toMatch(/SIN fecha/);
  });

  it('factura con importe ≤ 0 → OMITIDA', () => {
    const { filas, incidencias } = parsearAperturas([
      { tipo: 'proveedor', rfc: 'AAA010101AA1', fecha: '2026-01-15', importe: '0', folio: 'F1' },
    ]);
    expect(filas).toHaveLength(0);
    expect(incidencias[0]!.motivo).toMatch(/≤ 0/);
  });
});

describe('parsearAperturas — modo SALDO NETO', () => {
  it('saldo positivo → entrada_sin_factura (cargo), clave=neto:…, fecha=corte', () => {
    const { filas } = parsearAperturas(
      [{ tipo: 'proveedor', rfc: 'AAA010101AA1', saldo: '3000' }],
      { corte: CORTE },
    );
    const m = filas[0]!.movimiento;
    expect(m.origen).toBe('entrada_sin_factura');
    expect(m.importe).toBe(3000);
    expect(m.esFiscal).toBe(false);
    expect(m.claveFuente).toBe('neto:proveedor:AAA010101AA1');
    expect(m.fecha.toISOString().slice(0, 10)).toBe('2026-06-30');
  });

  it('saldo negativo → abono, importe = |saldo|', () => {
    const { filas } = parsearAperturas(
      [{ tipo: 'cliente', nombre: 'Cliente X', saldo: '-1200.75' }],
      { corte: CORTE },
    );
    const m = filas[0]!.movimiento;
    expect(m.origen).toBe('abono');
    expect(m.importe).toBe(1200.75);
    // Sin RFC → clave por nombre normalizado.
    expect(m.claveFuente).toBe('neto:cliente:n:cliente x');
  });

  it('saldo = 0 → OMITIDO (nada que abrir)', () => {
    const { filas, incidencias } = parsearAperturas([{ tipo: 'cliente', rfc: 'X', saldo: '0' }]);
    expect(filas).toHaveLength(0);
    expect(incidencias[0]!.motivo).toMatch(/nada que abrir/);
  });

  it('saldo neto SIN saldoEsperado explícito → saldoEsperado null (NO se rellena con el saldo)', () => {
    // Regresión: un abono neto NO debe rellenar el esperado del tercero; si lo hiciera, PISARÍA el
    // saldoEsperado declarado en otro renglón del mismo tercero (bug del cuadran=2 del cuadre).
    const { filas } = parsearAperturas([{ tipo: 'cliente', rfc: 'X', saldo: '-300' }], {
      corte: CORTE,
    });
    expect(filas[0]!.saldoEsperado).toBeNull();
  });

  it('saldo neto CON saldoEsperado explícito → lo conserva', () => {
    const { filas } = parsearAperturas([
      { tipo: 'proveedor', rfc: 'A', saldo: '2000', saldoEsperado: '2000' },
    ]);
    expect(filas[0]!.saldoEsperado).toBe(2000);
  });
});

describe('parsearAperturas — validaciones de renglón', () => {
  it('tipo inválido → incidencia', () => {
    const { incidencias } = parsearAperturas([{ tipo: 'x', rfc: 'A', saldo: '1' }]);
    expect(incidencias[0]!.motivo).toMatch(/Tipo de tercero/);
  });

  it('sin RFC ni nombre → incidencia', () => {
    const { incidencias } = parsearAperturas([{ tipo: 'proveedor', saldo: '1' }]);
    expect(incidencias[0]!.motivo).toMatch(/sin RFC ni nombre/);
  });

  it('encabezados case-insensitive + alias (Tipo/RFC/Monto/Factura)', () => {
    const { filas, incidencias } = parsearAperturas([
      {
        Tipo: 'Proveedor',
        RFC: 'AAA010101AA1',
        Fecha: '2026-01-15',
        Monto: '99',
        Factura: 'FAC-1',
      },
    ]);
    expect(incidencias).toHaveLength(0);
    expect(filas[0]!.movimiento.importe).toBe(99);
    expect(filas[0]!.movimiento.claveFuente).toBe('folio:proveedor:AAA010101AA1:FAC-1');
  });

  it('acepta el tipo abreviado (p/c) y captura saldoEsperado para el cuadre', () => {
    const { filas } = parsearAperturas([
      { tipo: 'p', rfc: 'AAA010101AA1', saldo: '500', saldoEsperado: '500' },
    ]);
    expect(filas[0]!.tipoTercero).toBe('proveedor');
    expect(filas[0]!.saldoEsperado).toBe(500);
  });
});
