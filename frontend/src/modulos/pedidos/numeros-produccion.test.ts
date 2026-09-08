import { describe, expect, it } from 'vitest';

import { notaSinExpedienteDesarrollo, numerosDeProduccion } from './numeros-produccion';

/**
 * Unit de las dos reglas compartidas por las pantallas de PEDIDO: qué número enseña un renglón, y
 * qué se dice de su «Desarrollo» cuando no tiene expediente (fila 0.151).
 */
describe('numerosDeProduccion', () => {
  it('manda la lista de nº por color/OP (V1-E3), no el del modelo del renglón', () => {
    expect(
      numerosDeProduccion({ numerosProduccion: [71_001, 71_002], numeroProduccion: null }),
    ).toBe('71001 · #71002');
  });

  it('cae al del modelo sólo en el caso legado (renglón de producción todavía sin OP)', () => {
    expect(numerosDeProduccion({ numerosProduccion: [], numeroProduccion: 51_783 })).toBe('51783');
  });

  it('sin nada que enseñar devuelve vacío (cada pantalla decide cómo pinta el hueco)', () => {
    expect(numerosDeProduccion({ numerosProduccion: [], numeroProduccion: null })).toBe('');
  });
});

/**
 * 🔴 EL TEXTO QUE MENTÍA. Las tres pantallas del pedido decían *«modelo anterior al módulo de
 * Desarrollo»* cuando el renglón no traía expediente — una afirmación sobre la EDAD del modelo que
 * la pantalla no puede comprobar, y falsa justo en el caso más común de hoy: los renglones que nacen
 * del importador de OC por PDF, que se crean SIN `idDesarrollo` aunque su modelo esté en el catálogo
 * de DESARROLLO.
 */
describe('notaSinExpedienteDesarrollo', () => {
  it('un renglón CON expediente no necesita nota (el nodo se enciende)', () => {
    expect(
      notaSinExpedienteDesarrollo({
        codigoModelo: 'CYA-26-71-003',
        origenModelo: 'desarrollo',
        idDesarrollo: 5,
      }),
    ).toBeNull();
  });

  it('⭐ modelo de DESARROLLO sin expediente: dice dónde vive, NO que sea viejo', () => {
    const nota = notaSinExpedienteDesarrollo({
      codigoModelo: 'CYA-26-71-003',
      origenModelo: 'desarrollo',
      idDesarrollo: null,
    });
    expect(nota).toContain('catálogo de DESARROLLO');
    expect(nota).toContain('CYA-26-71-003');
    expect(nota).not.toContain('anterior al módulo de Desarrollo');
  });

  it('modelo de PRODUCCIÓN sin expediente: los dos hechos comprobables, y ninguno más', () => {
    const nota = notaSinExpedienteDesarrollo({
      codigoModelo: '51783',
      origenModelo: 'produccion',
      idDesarrollo: null,
    });
    expect(nota).toContain('catálogo de producción');
    expect(nota).not.toContain('anterior al módulo de Desarrollo');
  });
});
