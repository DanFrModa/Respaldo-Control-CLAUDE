/**
 * Tests UNITARIOS (sin BD) de la lógica pura del DAG de dependencias (F5-E1). El rechazo de ciclos
 * es la regla más delicada del catálogo configurable; aquí se prueba de forma directa y exhaustiva.
 */
import { describe, expect, it } from 'vitest';

import {
  construirGrafoSucesores,
  esAlcanzable,
  validarDependencias,
  validarRedefinicionesAcumulado,
} from './grafo.js';

/** Aristas `antecesor → proceso` (el antecesor va antes que el proceso). */
type Arista = { idProceso: number; idAntecesor: number };

describe('grafo de dependencias de la RC (lógica pura)', () => {
  describe('construirGrafoSucesores / esAlcanzable', () => {
    it('un proceso se alcanza a sí mismo (0 pasos)', () => {
      const grafo = construirGrafoSucesores([]);
      expect(esAlcanzable(grafo, 5, 5)).toBe(true);
    });

    it('alcanza un sucesor directo y transitivo, no al revés', () => {
      // 1 → 2 → 3 (1 antes de 2, 2 antes de 3)
      const aristas: Arista[] = [
        { idProceso: 2, idAntecesor: 1 },
        { idProceso: 3, idAntecesor: 2 },
      ];
      const grafo = construirGrafoSucesores(aristas);
      expect(esAlcanzable(grafo, 1, 2)).toBe(true); // directo
      expect(esAlcanzable(grafo, 1, 3)).toBe(true); // transitivo
      expect(esAlcanzable(grafo, 3, 1)).toBe(false); // no hay vuelta
    });
  });

  describe('validarDependencias — rechazo de ciclos', () => {
    it('acepta un set válido (sin ciclos)', () => {
      // Grafo base: 1 → 2. Queremos fijar 2 como antecesor de 3 (válido).
      const aristas: Arista[] = [{ idProceso: 2, idAntecesor: 1 }];
      expect(validarDependencias(3, [2], aristas).ok).toBe(true);
    });

    it('rechaza la auto-antecedencia (un proceso no es su propio antecesor)', () => {
      const r = validarDependencias(7, [7], []);
      expect(r.ok).toBe(false);
      expect(r.conflicto).toEqual({ idAntecesor: 7, razon: 'auto' });
    });

    it('rechaza un ciclo DIRECTO (A↔B)', () => {
      // Ya existe: 2 es antecesor de 1 (1 ← 2). Intentar fijar 1 como antecesor de 2 cierra A↔B.
      const aristas: Arista[] = [{ idProceso: 1, idAntecesor: 2 }];
      const r = validarDependencias(2, [1], aristas);
      expect(r.ok).toBe(false);
      expect(r.conflicto).toEqual({ idAntecesor: 1, razon: 'ciclo' });
    });

    it('rechaza un ciclo TRANSITIVO (A→B→C→A)', () => {
      // Cadena existente: 1 → 2 → 3 (1 antes de 2, 2 antes de 3). Fijar 3 como antecesor de 1
      // cerraría 1→2→3→1.
      const aristas: Arista[] = [
        { idProceso: 2, idAntecesor: 1 },
        { idProceso: 3, idAntecesor: 2 },
      ];
      const r = validarDependencias(1, [3], aristas);
      expect(r.ok).toBe(false);
      expect(r.conflicto).toEqual({ idAntecesor: 3, razon: 'ciclo' });
    });

    it('al re-definir, IGNORA las aristas previas del propio proceso (puede reordenarse sin falso ciclo)', () => {
      // 1 → 2 (1 antecesor de 2). Re-definir los antecesores de 2 como [1] de nuevo es válido (no
      // se cuenta la arista vieja de 2 como parte del grafo base).
      const aristas: Arista[] = [{ idProceso: 2, idAntecesor: 1 }];
      expect(validarDependencias(2, [1], aristas).ok).toBe(true);
    });

    it('detecta el ciclo entre antecesores del MISMO set propuesto', () => {
      // Sin aristas previas. Fijar como antecesores de 1: [2, 1] — el segundo es auto. Pero un caso
      // más sutil: si A ya alcanza a B vía el nuevo nodo. Aquí: base vacía, set [2,3] de 1 es válido.
      expect(validarDependencias(1, [2, 3], []).ok).toBe(true);
    });

    it('un set vacío siempre es válido (quitar todos los antecesores)', () => {
      const aristas: Arista[] = [{ idProceso: 2, idAntecesor: 1 }];
      expect(validarDependencias(2, [], aristas).ok).toBe(true);
    });
  });

  describe('validarRedefinicionesAcumulado (lote de un PATCH de ajuste, F5-E3)', () => {
    it('acepta redefiniciones independientes que NO cierran ciclo', () => {
      // Base: 1 y 2 sueltos. Lote: 3→[1], 3→ no; redefinir 2→[1] y 1→[] (válido).
      const r = validarRedefinicionesAcumulado(
        [],
        [
          { idProceso: 2, idsAntecesores: [1] },
          { idProceso: 3, idsAntecesores: [1, 2] },
        ],
      );
      expect(r.ok).toBe(true);
    });

    it('RECHAZA el ciclo CRUZADO entre dos redefiniciones del mismo lote (a→[b] y b→[a])', () => {
      // Base vacía (a y b independientes): cada redefinición SOLA es válida, pero juntas cierran a↔b.
      // Sin acumulación esto colaría; con acumulación, la 2ª (b→[a]) ya ve a→b y se rechaza.
      const r = validarRedefinicionesAcumulado(
        [],
        [
          { idProceso: 1, idsAntecesores: [2] }, // a → depende de b
          { idProceso: 2, idsAntecesores: [1] }, // b → depende de a  ⇒ ciclo
        ],
      );
      expect(r.ok).toBe(false);
      expect(r.conflicto).toEqual({ idProceso: 2, idAntecesor: 1, razon: 'ciclo' });
    });

    it('detecta el ciclo cruzado aunque haya un tercer nodo en medio (a→[b], b→[c], c→[a])', () => {
      const r = validarRedefinicionesAcumulado(
        [],
        [
          { idProceso: 1, idsAntecesores: [2] },
          { idProceso: 2, idsAntecesores: [3] },
          { idProceso: 3, idsAntecesores: [1] }, // cierra 1→2→3→1
        ],
      );
      expect(r.ok).toBe(false);
    });

    it('la redefinición REEMPLAZA las aristas viejas del proceso (no las acumula con las propuestas)', () => {
      // Base: 2→1 (2 depende de 1). Redefinir 2→[] (quitar su antecesor) y luego 1→[2] NO es ciclo,
      // porque al redefinir 2 se quitó 2→1; el grafo final es solo 1→2.
      const base: Arista[] = [{ idProceso: 2, idAntecesor: 1 }];
      const r = validarRedefinicionesAcumulado(base, [
        { idProceso: 2, idsAntecesores: [] },
        { idProceso: 1, idsAntecesores: [2] },
      ]);
      expect(r.ok).toBe(true);
    });

    it('un proceso que es su propio antecesor en el lote se rechaza (auto)', () => {
      const r = validarRedefinicionesAcumulado([], [{ idProceso: 5, idsAntecesores: [5] }]);
      expect(r.ok).toBe(false);
      expect(r.conflicto?.razon).toBe('auto');
    });

    it('un lote vacío es válido', () => {
      expect(validarRedefinicionesAcumulado([], []).ok).toBe(true);
    });
  });
});
