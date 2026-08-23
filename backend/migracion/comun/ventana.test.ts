/**
 * Unit (sin BD) de la ventana temporal del ETL (F4-E6). Helpers puros: resolución desde el entorno,
 * inclusión/exclusión por fecha y descripción legible.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { describirVentana, dentroVentana, filtrarPorVentana, resolverVentana } from './ventana.js';

let aniosPrevio: string | undefined;
let refPrevio: string | undefined;
let desdePrevio: string | undefined;

beforeEach(() => {
  aniosPrevio = process.env.ETL_VENTANA_ANIOS;
  refPrevio = process.env.ETL_VENTANA_REF;
  desdePrevio = process.env.ETL_DESDE;
  delete process.env.ETL_VENTANA_ANIOS;
  delete process.env.ETL_VENTANA_REF;
  delete process.env.ETL_DESDE;
});

afterEach(() => {
  if (aniosPrevio === undefined) delete process.env.ETL_VENTANA_ANIOS;
  else process.env.ETL_VENTANA_ANIOS = aniosPrevio;
  if (refPrevio === undefined) delete process.env.ETL_VENTANA_REF;
  else process.env.ETL_VENTANA_REF = refPrevio;
  if (desdePrevio === undefined) delete process.env.ETL_DESDE;
  else process.env.ETL_DESDE = desdePrevio;
});

describe('resolverVentana — configuración desde el entorno', () => {
  it('por defecto NO recorta (anios=0, corte=null)', () => {
    const v = resolverVentana();
    expect(v.anios).toBe(0);
    expect(v.corte).toBeNull();
  });

  it('valores inválidos de ETL_VENTANA_ANIOS → 0 (sin ventana)', () => {
    for (const malo of ['abc', '-3', '2.5', '']) {
      process.env.ETL_VENTANA_ANIOS = malo;
      expect(resolverVentana().anios).toBe(0);
    }
  });

  it('ETL_VENTANA_ANIOS=10 con ref fija calcula el corte exacto', () => {
    process.env.ETL_VENTANA_ANIOS = '10';
    process.env.ETL_VENTANA_REF = '2026-06-22';
    const v = resolverVentana();
    expect(v.anios).toBe(10);
    expect(v.corte?.toISOString().slice(0, 10)).toBe('2016-06-22');
  });

  it('ETL_VENTANA_REF inválida → ancla en HOY (no truena)', () => {
    process.env.ETL_VENTANA_ANIOS = '5';
    process.env.ETL_VENTANA_REF = 'no-es-fecha';
    const v = resolverVentana();
    expect(v.corte).not.toBeNull();
    // El corte es ~5 años atrás de hoy: el año del corte < año actual.
    expect(v.corte!.getUTCFullYear()).toBeLessThan(new Date().getUTCFullYear());
  });
});

describe('dentroVentana — inclusión/exclusión por fecha', () => {
  it('ventana desactivada (corte=null) → todo dentro', () => {
    const v = resolverVentana();
    expect(dentroVentana(new Date('1990-01-01'), v)).toBe(true);
    expect(dentroVentana(null, v)).toBe(true);
  });

  it('con corte: anterior al corte se EXCLUYE; igual/posterior se INCLUYE', () => {
    process.env.ETL_VENTANA_ANIOS = '10';
    process.env.ETL_VENTANA_REF = '2026-06-22';
    const v = resolverVentana(); // corte = 2016-06-22
    expect(dentroVentana(new Date('2010-01-01T00:00:00Z'), v)).toBe(false);
    expect(dentroVentana(new Date('2016-06-22T00:00:00Z'), v)).toBe(true); // límite inclusivo
    expect(dentroVentana(new Date('2020-01-01T00:00:00Z'), v)).toBe(true);
  });

  it('fecha nula con ventana activa → DENTRO (no se excluye por edad lo que no tiene fecha)', () => {
    process.env.ETL_VENTANA_ANIOS = '10';
    process.env.ETL_VENTANA_REF = '2026-06-22';
    expect(dentroVentana(null, resolverVentana())).toBe(true);
  });
});

describe('describirVentana — texto para el reporte', () => {
  it('desactivada lo dice explícito', () => {
    expect(describirVentana(resolverVentana())).toContain('DESACTIVADA');
  });
  it('activa muestra años, ref y corte', () => {
    process.env.ETL_VENTANA_ANIOS = '10';
    process.env.ETL_VENTANA_REF = '2026-06-22';
    const txt = describirVentana(resolverVentana());
    expect(txt).toContain('10 años');
    expect(txt).toContain('2016-06-22');
  });
});

describe('ETL_DESDE (§Post-F9.24 — la migración lleva solo 2025-2026)', () => {
  it('fija el corte al 1 de enero de ese año, sin depender de cuándo se corra', () => {
    process.env.ETL_DESDE = '2025';
    const v = resolverVentana();
    expect(v.desdeAnio).toBe(2025);
    expect(v.corte?.toISOString().slice(0, 10)).toBe('2025-01-01');
    expect(dentroVentana(new Date('2024-12-31T00:00:00Z'), v)).toBe(false);
    expect(dentroVentana(new Date('2025-01-01T00:00:00Z'), v)).toBe(true);
    expect(dentroVentana(new Date('2026-06-01T00:00:00Z'), v)).toBe(true);
    expect(describirVentana(v)).toMatch(/SOLO de 2025 en adelante/);
  });

  it('gana sobre ETL_VENTANA_ANIOS (una fecha explícita manda sobre una relativa)', () => {
    process.env.ETL_DESDE = '2025';
    process.env.ETL_VENTANA_ANIOS = '10';
    expect(resolverVentana().corte?.toISOString().slice(0, 10)).toBe('2025-01-01');
  });

  it('un año inválido no recorta por accidente', () => {
    process.env.ETL_DESDE = 'el año pasado';
    expect(resolverVentana().corte).toBeNull();
  });
});

describe('filtrarPorVentana', () => {
  /** Reporte mínimo: solo necesita `agregar` para esta prueba. */
  function reporteFalso() {
    const filas: string[] = [];
    return {
      espia: filas,
      agregar: (grupo: string, detalle: string) => filas.push(`${grupo} :: ${detalle}`),
    };
  }

  const filas = [
    { Id: '1', Fecha: '15/03/2026 10:00:00' },
    { Id: '2', Fecha: '15/03/2019 10:00:00' },
    { Id: '3', Fecha: '' },
  ];

  it('deja pasar lo de la ventana, reporta lo que excluye', () => {
    process.env.ETL_DESDE = '2025';
    const r = reporteFalso();
    const res = filtrarPorVentana(
      filas,
      'Fecha',
      resolverVentana(),
      r as unknown as Parameters<typeof filtrarPorVentana>[3],
      'Órdenes',
      (f) => `Id=${f.Id ?? '?'}`,
    );
    expect(res.dentro.map((f) => f.Id)).toEqual(['1', '3']);
    expect(res.fuera).toBe(1);
    expect(r.espia).toHaveLength(1);
    expect(r.espia[0]).toMatch(/Órdenes.*2025-01-01.* :: Id=2 · 15\/03\/2019/);
  });

  it('un DOCUMENTO sin fecha legible se QUEDA (al revés que un proveedor dudoso)', () => {
    process.env.ETL_DESDE = '2025';
    const r = reporteFalso();
    const res = filtrarPorVentana(
      [{ Id: '3', Fecha: '' }],
      'Fecha',
      resolverVentana(),
      r as unknown as Parameters<typeof filtrarPorVentana>[3],
      'Órdenes',
      (f) => `Id=${f.Id ?? '?'}`,
    );
    expect(res.dentro).toHaveLength(1);
    expect(res.fuera).toBe(0);
  });

  it('sin ventana no toca nada ni reporta', () => {
    delete process.env.ETL_DESDE;
    const r = reporteFalso();
    const res = filtrarPorVentana(
      filas,
      'Fecha',
      resolverVentana(),
      r as unknown as Parameters<typeof filtrarPorVentana>[3],
      'Órdenes',
      (f) => `Id=${f.Id ?? '?'}`,
    );
    expect(res.dentro).toHaveLength(3);
    expect(res.fuera).toBe(0);
    expect(r.espia).toHaveLength(0);
  });
});
