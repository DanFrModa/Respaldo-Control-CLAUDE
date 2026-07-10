/**
 * Tests UNITARIOS del RESUMEN OPERATIVO (rediseño R9): los helpers PUROS — ventana de semanas ISO,
 * etiqueta de barra, delta porcentual y el armado de "órdenes por vencer" (agrupación por orden,
 * compromiso, semáforo, avance, orden y tope). No tocan BD; los bloques contra datos reales
 * (conteos, sumas, permisos por bloque, A9) viven en `resumen.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  armarOrdenesPorVencer,
  deltaPorcentual,
  etiquetaSemana,
  ventanaSemanas,
  type FilaRutaPorVencer,
} from './resumen.js';

/** Miércoles 8-jul-2026 (semana ISO 28: lunes 6-jul → domingo 12-jul). */
const HOY = new Date('2026-07-08T12:00:00.000Z');

/** Fila de ruta viva mínima para el armado (todo lo no relevante con defaults). */
function fila(parcial: {
  idOrden: number;
  planeada?: string | null;
  real?: string | null;
  folio?: number;
}): FilaRutaPorVencer {
  return {
    idOrden: parcial.idOrden,
    fechaPlaneadaVigente: parcial.planeada == null ? null : new Date(parcial.planeada),
    fechaReal: parcial.real == null ? null : new Date(parcial.real),
    orden: {
      folio: BigInt(parcial.folio ?? parcial.idOrden),
      modelo: { codigo: `MOD-${String(parcial.idOrden)}`, descripcion: null },
      cliente: { nombre: 'Cliente X' },
    },
  };
}

describe('ventanaSemanas / etiquetaSemana', () => {
  it('devuelve 7 semanas ISO, de la más vieja a la ACTUAL, con su lunes', () => {
    const semanas = ventanaSemanas(HOY);
    expect(semanas).toHaveLength(7);
    // La última es la semana actual (S28 de 2026, lunes 6-jul).
    expect(semanas[6]).toEqual({
      anioSemana: '2026-W28',
      etiqueta: 'S28',
      inicioSemana: '2026-07-06',
    });
    // La primera es 6 semanas atrás (S22, lunes 25-may).
    expect(semanas[0]).toEqual({
      anioSemana: '2026-W22',
      etiqueta: 'S22',
      inicioSemana: '2026-05-25',
    });
  });

  it('cruza el año ISO sin romperse (enero toma semanas del año anterior)', () => {
    // 7-ene-2026 (miércoles) es la semana 2 de 2026; 6 semanas atrás cae en la 48 de 2025.
    const semanas = ventanaSemanas(new Date('2026-01-07T00:00:00.000Z'));
    expect(semanas[0]?.anioSemana).toBe('2025-W48');
    expect(semanas[6]?.anioSemana).toBe('2026-W02');
  });

  it('la etiqueta corta no lleva cero a la izquierda ("2026-W05" → "S5")', () => {
    expect(etiquetaSemana('2026-W05')).toBe('S5');
    expect(etiquetaSemana('2026-W27')).toBe('S27');
  });
});

describe('deltaPorcentual', () => {
  it('calcula la variación % con 1 decimal', () => {
    expect(deltaPorcentual(8120, 7500)).toBe(8.3); // (8120−7500)/7500 ≈ 8.27 → 8.3
    expect(deltaPorcentual(50, 100)).toBe(-50);
  });

  it('sin base (anterior 0) no inventa cifra: null', () => {
    expect(deltaPorcentual(100, 0)).toBeNull();
  });
});

describe('armarOrdenesPorVencer', () => {
  it('incluye la orden cuyo próximo compromiso pendiente cae dentro de 7 días, con avance y semáforo', () => {
    const filas = [
      // Orden 1: 2 procesos cumplidos + 1 pendiente que vence mañana (9-jul) → enRiesgo.
      fila({ idOrden: 1, planeada: '2026-07-01T00:00:00.000Z', real: '2026-07-01T00:00:00.000Z' }),
      fila({ idOrden: 1, planeada: '2026-07-03T00:00:00.000Z', real: '2026-07-04T00:00:00.000Z' }),
      fila({ idOrden: 1, planeada: '2026-07-09T00:00:00.000Z' }),
    ];
    const [orden] = armarOrdenesPorVencer(filas, HOY);
    expect(orden).toMatchObject({
      idOrden: 1,
      avancePct: 67, // 2 de 3 → 66.67 redondeado.
      compromiso: '2026-07-09T00:00:00.000Z',
      semaforo: 'enRiesgo',
      etapasAtrasadas: 0,
    });
  });

  it('una orden ATRASADA cuenta sus etapas vencidas y sale primero (compromiso ascendente)', () => {
    const filas = [
      // Orden 2: pendiente vencido el 5-jul + pendiente al 20-jul → atrasada, compromiso 5-jul.
      fila({ idOrden: 2, planeada: '2026-07-05T00:00:00.000Z' }),
      fila({ idOrden: 2, planeada: '2026-07-20T00:00:00.000Z' }),
      // Orden 3: pendiente al 12-jul → a 4 días (fuera del umbral de riesgo de 3 → aTiempo),
      // pero dentro de la ventana de 7 días (sí aparece).
      fila({ idOrden: 3, planeada: '2026-07-12T00:00:00.000Z' }),
    ];
    const resultado = armarOrdenesPorVencer(filas, HOY);
    expect(resultado.map((o) => o.idOrden)).toEqual([2, 3]);
    expect(resultado[0]).toMatchObject({ semaforo: 'atrasado', etapasAtrasadas: 1 });
    expect(resultado[1]).toMatchObject({ semaforo: 'aTiempo', etapasAtrasadas: 0 });
  });

  it('excluye lo que no apremia: todo cumplido, compromiso a >7 días o pendientes SIN fecha', () => {
    const filas = [
      // Orden 4: todo cumplido.
      fila({ idOrden: 4, planeada: '2026-07-01T00:00:00.000Z', real: '2026-07-02T00:00:00.000Z' }),
      // Orden 5: compromiso a 30 días.
      fila({ idOrden: 5, planeada: '2026-08-07T00:00:00.000Z' }),
      // Orden 6: pendiente sin fecha (CPM sin correr).
      fila({ idOrden: 6, planeada: null }),
    ];
    expect(armarOrdenesPorVencer(filas, HOY)).toEqual([]);
  });

  it('tope de 8 filas (la portada es un vistazo) y empate estable por folio', () => {
    const filas = Array.from({ length: 10 }, (_, i) =>
      fila({ idOrden: i + 1, folio: i + 1, planeada: '2026-07-09T00:00:00.000Z' }),
    );
    const resultado = armarOrdenesPorVencer(filas, HOY);
    expect(resultado).toHaveLength(8);
    expect(resultado.map((o) => o.folio)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
