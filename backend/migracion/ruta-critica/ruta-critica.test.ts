/**
 * Pruebas UNITARIAS (sin BD) de la lógica pura del ETL de Ruta Crítica (F5-E7, Pieza B):
 *  • `flag` — interpretación de las banderas del viejo (`"1"`/`"-1"`/`""`).
 *  • `checklistDe` — despivote de los checks de IP3/IP4 a ítems de checklist (9 por renglón con IP).
 *  • `CODIGOS_PROCESO_POR_POSICION` — el puente de posición a código kebab (26, en orden de E1).
 */
import { describe, expect, it } from 'vitest';

import { CODIGOS_PROCESO_POR_POSICION } from './comun.js';
import { checklistDe, flag } from './ruta-orden.js';

describe('flag (banderas del viejo)', () => {
  it('interpreta 1/-1 como true y 0/"" como false', () => {
    expect(flag('1')).toBe(true);
    expect(flag('-1')).toBe(true);
    expect(flag('0')).toBe(false);
    expect(flag('')).toBe(false);
    expect(flag(undefined)).toBe(false);
    expect(flag('   ')).toBe(false);
    expect(flag('abc')).toBe(false);
  });
});

describe('checklistDe (despivote IP3/IP4)', () => {
  it('sin IP3 ni IP4 → checklist vacío', () => {
    expect(checklistDe(undefined, undefined)).toEqual([]);
  });

  it('solo IP3 → 6 ítems con orden 0..5 y hecho según la bandera', () => {
    const ip3 = {
      Moldes: '1',
      MuestraFisica: '0',
      FichaTecnica: '1',
      Digitalizacion: '0',
      Graduacion: '0',
      MandarModelo: '0',
    };
    const items = checklistDe(ip3, undefined);
    expect(items).toHaveLength(6);
    expect(items.map((i) => i.orden)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(items[0]).toMatchObject({ descripcion: 'Moldes', hecho: true });
    expect(items[1]).toMatchObject({ descripcion: 'Muestra física', hecho: false });
    expect(items[2]).toMatchObject({ descripcion: 'Ficha técnica', hecho: true });
  });

  it('IP3 + IP4 → 9 ítems con orden continuo 0..8', () => {
    const ip3 = {
      Moldes: '0',
      MuestraFisica: '0',
      FichaTecnica: '0',
      Digitalizacion: '0',
      Graduacion: '0',
      MandarModelo: '0',
    };
    const ip4 = { CorteIP4: '1', AsignadaIP4: '0', AprobadaIP4: '1' };
    const items = checklistDe(ip3, ip4);
    expect(items).toHaveLength(9);
    expect(items.map((i) => i.orden)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(items[6]).toMatchObject({ descripcion: 'Corte', hecho: true });
    expect(items[8]).toMatchObject({ descripcion: 'Aprobada', hecho: true });
  });
});

describe('CODIGOS_PROCESO_POR_POSICION (puente de E1)', () => {
  it('tiene 26 códigos kebab, sin huecos ni duplicados', () => {
    expect(CODIGOS_PROCESO_POR_POSICION).toHaveLength(26);
    expect(new Set(CODIGOS_PROCESO_POR_POSICION).size).toBe(26);
    for (const c of CODIGOS_PROCESO_POR_POSICION) {
      expect(c).toMatch(/^[a-z0-9-]+$/);
    }
    // El primero y el último son anclas conocidas (revision-orden / aceptacion-cliente).
    expect(CODIGOS_PROCESO_POR_POSICION[0]).toBe('revision-orden');
    expect(CODIGOS_PROCESO_POR_POSICION[25]).toBe('aceptacion-cliente');
  });
});
