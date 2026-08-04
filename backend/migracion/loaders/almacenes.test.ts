/**
 * Unit (sin BD) del loader de ALMACENES — REGRESIÓN del bug "kardex PT vacío" (31-jul-2026).
 *
 * El seed de F3-E1 siembra los 3 almacenes PT como GLOBALES (`idEmpresa = null`) y el loader
 * corre DESPUÉS. Si la búsqueda de idempotencia solo mira la empresa, no ve al global, intenta
 * crearlo, el dominio lanza `ErrorConflicto` (él SÍ mira los globales), `intentarCrear` se lo
 * traga y **el mapeo `Almacen:IPT` nunca se guarda** → `etl-ipt` descarta todos sus renglones
 * y termina "OK" con CERO movimientos.
 *
 * Estos casos fijan el contrato de la decisión pura: mismo criterio de visibilidad que el
 * dominio (empresa + globales) y comparación SIN ACENTOS (el CSV dice "Transito", el seed
 * "Tránsito"; el `mode:'insensitive'` de Postgres es ILIKE: ignora mayúsculas, NO acentos).
 */
import { describe, expect, it } from 'vitest';

import { elegirAlmacenExistente, type AlmacenCandidato } from './almacenes.js';

const FR_MODA = 7;

/** Los 3 almacenes PT tal como los deja el SEED de F3-E1: globales, con acento en Tránsito. */
const SEMBRADOS_GLOBALES: AlmacenCandidato[] = [
  { id: 101, nombre: 'Primeras', idEmpresa: null },
  { id: 102, nombre: 'Segundas', idEmpresa: null },
  { id: 103, nombre: 'Tránsito', idEmpresa: null },
];

describe('elegirAlmacenExistente — regresión del kardex PT vacío', () => {
  it('un almacén GLOBAL ya sembrado se resuelve como EXISTENTE (no se intenta crear)', () => {
    for (const nombre of ['Primeras', 'Segundas']) {
      const { elegido } = elegirAlmacenExistente(SEMBRADOS_GLOBALES, FR_MODA, nombre);
      expect(elegido).not.toBeNull(); // ← antes daba null → create → ErrorConflicto → SIN MAPEO
      expect(elegido?.idEmpresa).toBeNull();
    }
  });

  it('resuelve pese al ACENTO: CSV "Transito" ↔ seed "Tránsito"', () => {
    const { elegido } = elegirAlmacenExistente(SEMBRADOS_GLOBALES, FR_MODA, 'Transito');
    expect(elegido?.id).toBe(103);
  });

  it('sigue viendo los de la EMPRESA (no solo los globales)', () => {
    const candidatos: AlmacenCandidato[] = [{ id: 200, nombre: 'Bodega 1', idEmpresa: FR_MODA }];
    expect(elegirAlmacenExistente(candidatos, FR_MODA, 'bodega 1').elegido?.id).toBe(200);
  });

  it('ignora los de OTRA empresa (no son visibles)', () => {
    const candidatos: AlmacenCandidato[] = [{ id: 300, nombre: 'Primeras', idEmpresa: 99 }];
    expect(elegirAlmacenExistente(candidatos, FR_MODA, 'Primeras').elegido).toBeNull();
  });

  it('un nombre nuevo NO matchea (se creará, como debe ser)', () => {
    expect(elegirAlmacenExistente(SEMBRADOS_GLOBALES, FR_MODA, 'Terceras').elegido).toBeNull();
  });

  it('con el DUPLICADO que dejó el bug gana el GLOBAL y el sobrante se reporta', () => {
    // Estado real de `prueba`: el global "Tránsito" del seed + el "Transito" que el loader
    // alcanzó a crear en FR Moda antes del fix.
    const conDuplicado: AlmacenCandidato[] = [
      ...SEMBRADOS_GLOBALES,
      { id: 104, nombre: 'Transito', idEmpresa: FR_MODA },
    ];
    const { elegido, duplicados } = elegirAlmacenExistente(conDuplicado, FR_MODA, 'Transito');
    expect(elegido?.id).toBe(103); // el GLOBAL canónico del seed
    expect(duplicados.map((d) => d.id)).toEqual([104]); // el sobrante, para limpieza manual
  });
});
