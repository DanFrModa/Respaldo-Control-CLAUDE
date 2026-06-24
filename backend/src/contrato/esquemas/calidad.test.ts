import { describe, expect, it } from 'vitest';

import {
  esquemaDefectoCrear,
  esquemaPlanAqlCrear,
  esquemaResolverPlanQuery,
  esquemaTipoProductoCrear,
} from './calidad.js';

describe('esquemaTipoProductoCrear', () => {
  it('acepta un nombre y recorta espacios', () => {
    expect(esquemaTipoProductoCrear.parse({ nombre: '  Playera  ' })).toEqual({
      nombre: 'Playera',
    });
  });
  it('rechaza nombre vacío', () => {
    expect(esquemaTipoProductoCrear.safeParse({ nombre: '' }).success).toBe(false);
  });
});

describe('esquemaDefectoCrear', () => {
  it('acepta un defecto con nivel AQL válido y default de favorito/general', () => {
    const d = esquemaDefectoCrear.parse({
      clave: 'COST-01',
      descripcion: 'Costura abierta',
      nivelAQL: 2.5,
    });
    expect(d.nivelAQL).toBe(2.5);
    expect(d.favorito).toBe(false);
    expect(d.aplicaGeneral).toBe(false);
    expect(d.severidad).toBe('menor');
    expect(d.tiposProducto).toEqual([]);
  });

  it('rechaza un nivel AQL fuera de {1, 2.5, 10}', () => {
    expect(
      esquemaDefectoCrear.safeParse({ clave: 'X', descripcion: 'X', nivelAQL: 3 }).success,
    ).toBe(false);
  });

  it('rechaza severidad fuera del enum', () => {
    expect(
      esquemaDefectoCrear.safeParse({
        clave: 'X',
        descripcion: 'X',
        nivelAQL: 1,
        severidad: 'fatal',
      }).success,
    ).toBe(false);
  });
});

describe('esquemaPlanAqlCrear', () => {
  it('acepta un plan con un renglón y sus límites', () => {
    const p = esquemaPlanAqlCrear.parse({
      nombre: 'Plan',
      renglones: [
        {
          loteMin: 281,
          loteMax: 500,
          tamanoMuestra: 50,
          limites: [{ nivelAQL: 2.5, aceptar: 3, rechazar: 4 }],
        },
      ],
    });
    expect(p.renglones[0]?.limites[0]?.rechazar).toBe(4);
  });

  it('acepta loteMax null (rango abierto)', () => {
    const r = esquemaPlanAqlCrear.safeParse({
      nombre: 'Plan',
      renglones: [
        {
          loteMin: 501,
          loteMax: null,
          tamanoMuestra: 80,
          limites: [{ nivelAQL: 1, aceptar: 2, rechazar: 3 }],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rechaza un plan sin renglones', () => {
    expect(esquemaPlanAqlCrear.safeParse({ nombre: 'Plan', renglones: [] }).success).toBe(false);
  });

  it('rechaza un renglón sin límites', () => {
    expect(
      esquemaPlanAqlCrear.safeParse({
        nombre: 'Plan',
        renglones: [{ loteMin: 1, loteMax: 10, tamanoMuestra: 2, limites: [] }],
      }).success,
    ).toBe(false);
  });
});

describe('esquemaResolverPlanQuery', () => {
  it('coacciona los parámetros de la URL (texto → número)', () => {
    const q = esquemaResolverPlanQuery.parse({ tamanoLote: '400', nivelAQL: '2.5' });
    expect(q.tamanoLote).toBe(400);
    expect(q.nivelAQL).toBe(2.5);
  });
  it('rechaza un nivel AQL inválido', () => {
    expect(esquemaResolverPlanQuery.safeParse({ tamanoLote: '10', nivelAQL: '3' }).success).toBe(
      false,
    );
  });
});
