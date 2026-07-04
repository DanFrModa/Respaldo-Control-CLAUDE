/**
 * Tests UNITARIOS (sin BD) de la SUGERENCIA AQL de las auditorías (F6-E2, decisión (a)). El cálculo
 * por nivel es PURO: Σ fallas por nivel vs el Ac/Re del plan, niveles distintos NO se suman entre sí,
 * y la sugerencia es INFORMATIVA (no determina el resultado, que es manual). Casos límite incluidos
 * (fallas = Ac → aprobar; = Re → reprobar).
 */
import { describe, expect, it } from 'vitest';

import { calcularSugerenciaAql, type DefectoFallaNivel } from './auditorias.js';
import type { RenglonPlanResuelto } from './planes-aql.js';

/** Renglón de plan de prueba con los 3 niveles (Ac/Re de ISO 2859 para una muestra mediana). */
const renglon: RenglonPlanResuelto = {
  idPlan: 1,
  nombrePlan: 'Plan prueba',
  tamanoLote: 200,
  tamanoMuestra: 32,
  niveles: [
    { nivelAQL: 1, aceptar: 1, rechazar: 2 },
    { nivelAQL: 2.5, aceptar: 2, rechazar: 3 },
    { nivelAQL: 10, aceptar: 7, rechazar: 8 },
  ],
};

describe('calcularSugerenciaAql (informativa, no vinculante)', () => {
  it('sin plan resoluble devuelve resoluble:false y sin niveles', () => {
    const s = calcularSugerenciaAql([{ nivelAQL: 1, numFallas: 99 }], null, 200);
    expect(s.resoluble).toBe(false);
    expect(s.niveles).toHaveLength(0);
    expect(s.sugerenciaGlobal).toBeNull();
    expect(s.mensaje).not.toBeNull();
  });

  it('fallas = Ac sugiere APROBAR; fallas = Re sugiere REPROBAR (caso límite)', () => {
    // Nivel 1: Ac=1, Re=2.
    const enAc = calcularSugerenciaAql([{ nivelAQL: 1, numFallas: 1 }], renglon, 200);
    const nivel1Ac = enAc.niveles.find((n) => n.nivelAQL === 1);
    expect(nivel1Ac?.sugerencia).toBe('aprobar');

    const enRe = calcularSugerenciaAql([{ nivelAQL: 1, numFallas: 2 }], renglon, 200);
    const nivel1Re = enRe.niveles.find((n) => n.nivelAQL === 1);
    expect(nivel1Re?.sugerencia).toBe('reprobar');
    expect(enRe.sugerenciaGlobal).toBe('reprobar');
  });

  it('niveles distintos NO se suman entre sí', () => {
    // 5 fallas todas de nivel 1: el nivel 2.5 (Ac=2) y el 10 (Ac=7) NO acumulan esas 5.
    const s = calcularSugerenciaAql([{ nivelAQL: 1, numFallas: 5 }], renglon, 200);
    expect(s.niveles.find((n) => n.nivelAQL === 1)?.totalFallas).toBe(5);
    expect(s.niveles.find((n) => n.nivelAQL === 2.5)?.totalFallas).toBe(0);
    expect(s.niveles.find((n) => n.nivelAQL === 10)?.totalFallas).toBe(0);
    // Nivel 1 reprueba (5 > Ac 1); los otros aprueban → global reprobar.
    expect(s.niveles.find((n) => n.nivelAQL === 2.5)?.sugerencia).toBe('aprobar');
    expect(s.sugerenciaGlobal).toBe('reprobar');
  });

  it('varios defectos del MISMO nivel SÍ suman sus fallas', () => {
    const defectos: DefectoFallaNivel[] = [
      { nivelAQL: 2.5, numFallas: 1 },
      { nivelAQL: 2.5, numFallas: 1 },
      { nivelAQL: 2.5, numFallas: 1 },
    ];
    const s = calcularSugerenciaAql(defectos, renglon, 200);
    const nivel = s.niveles.find((n) => n.nivelAQL === 2.5);
    expect(nivel?.totalFallas).toBe(3); // 1+1+1
    expect(nivel?.sugerencia).toBe('reprobar'); // 3 ≥ Re 3
  });

  it('todo dentro de Ac → sugerencia global aprobar', () => {
    const s = calcularSugerenciaAql(
      [
        { nivelAQL: 1, numFallas: 1 },
        { nivelAQL: 2.5, numFallas: 2 },
        { nivelAQL: 10, numFallas: 7 },
      ],
      renglon,
      200,
    );
    expect(s.sugerenciaGlobal).toBe('aprobar');
    expect(s.resoluble).toBe(true);
    expect(s.tamanoMuestra).toBe(32);
  });
});
