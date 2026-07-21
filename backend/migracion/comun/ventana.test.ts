/**
 * Unit (sin BD) de la ventana temporal del ETL (F4-E6). Helpers puros: resolución desde el entorno,
 * inclusión/exclusión por fecha y descripción legible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  describirVentana,
  dentroVentana,
  ErrorEtlDesdeInvalida,
  parsearEtlDesde,
  resolverVentana,
} from './ventana.js';

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

describe('resolverVentana — ETL_DESDE (fecha de corte directa)', () => {
  it('ETL_DESDE válida activa la ventana con esa fecha exacta de corte', () => {
    process.env.ETL_DESDE = '2025-01-01';
    const v = resolverVentana();
    expect(v.corte?.toISOString().slice(0, 10)).toBe('2025-01-01');
    expect(v.desde?.toISOString().slice(0, 10)).toBe('2025-01-01');
  });

  it('ETL_DESDE GANA sobre ETL_VENTANA_ANIOS/REF cuando ambas vienen', () => {
    process.env.ETL_VENTANA_ANIOS = '10';
    process.env.ETL_VENTANA_REF = '2026-06-22';
    process.env.ETL_DESDE = '2025-01-01';
    const v = resolverVentana();
    expect(v.corte?.toISOString().slice(0, 10)).toBe('2025-01-01'); // no 2016-06-22
  });

  it('ETL_DESDE vacía/ausente → sin ventana (como siempre)', () => {
    for (const vacia of ['', '   ']) {
      process.env.ETL_DESDE = vacia;
      const v = resolverVentana();
      expect(v.corte).toBeNull();
      expect(v.desde ?? null).toBeNull();
    }
  });

  it('parsearEtlDesde: NO-vacía mal formada → ErrorEtlDesdeInvalida (nunca se ignora)', () => {
    for (const malo of ['no-es-fecha', '2025-13-45', '2025-1-1', '01-01-2025', '2025-02-30']) {
      expect(() => parsearEtlDesde(malo)).toThrow(ErrorEtlDesdeInvalida);
    }
    expect(parsearEtlDesde('')).toBeNull(); // vacía = sin ventana, no es error
    expect(parsearEtlDesde('2025-01-01')?.toISOString().slice(0, 10)).toBe('2025-01-01');
  });

  it('resolverVentana con ETL_DESDE mal formada ABORTA (console.error + exit 1)', () => {
    process.env.ETL_DESDE = '2025-1-1'; // typo real: le faltan los ceros
    const centinela = new Error('exit-1');
    const salir = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw centinela; // en test no salimos de verdad: verificamos que SE INTENTÓ abortar
    });
    const errores = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => resolverVentana()).toThrow(centinela);
      expect(salir).toHaveBeenCalledWith(1);
      expect(errores).toHaveBeenCalledWith(expect.stringContaining('ETL_DESDE inválida'));
    } finally {
      salir.mockRestore();
      errores.mockRestore();
    }
  });

  it('dentroVentana respeta el corte de ETL_DESDE (límite inclusivo)', () => {
    process.env.ETL_DESDE = '2025-01-01';
    const v = resolverVentana();
    expect(dentroVentana(new Date('2024-12-31T00:00:00Z'), v)).toBe(false);
    expect(dentroVentana(new Date('2025-01-01T00:00:00Z'), v)).toBe(true);
    expect(dentroVentana(null, v)).toBe(true); // fecha nula = dentro, como siempre
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
  it('con ETL_DESDE muestra la fecha de corte directa', () => {
    process.env.ETL_DESDE = '2025-01-01';
    const txt = describirVentana(resolverVentana());
    expect(txt).toContain('ETL_DESDE=2025-01-01');
    expect(txt).toContain('2025-01-01');
  });
});
