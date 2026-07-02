/**
 * Unit del resolvedor de maquilero de la cabecera EsMa (F6-E6) — lógica PURA, sin BD.
 * Cubre el FIX de estampado: el maquilero se resuelve PRIMERO en `mapaMaquilero` (los cargos de
 * estampado apuntan a un `Maquileros` con Proceso=1) y solo cae a `mapaEstampador` como respaldo.
 */
import { describe, expect, it } from 'vitest';

import { resolverMaquileroCabecera } from './esma-cargos.js';

const maquileros = new Map<string, number>([
  ['7', 700],
  ['8', 800],
]);
const estampadores = new Map<string, number>([['9', 900]]);

describe('resolverMaquileroCabecera', () => {
  it('resuelve por mapaMaquilero (incluye el maquilero que hace estampado, Proceso=1)', () => {
    expect(resolverMaquileroCabecera('7', maquileros, estampadores)).toBe(700);
    expect(resolverMaquileroCabecera('8', maquileros, estampadores)).toBe(800);
  });

  it('cae a mapaEstampador solo si no está en maquileros (respaldo defensivo)', () => {
    expect(resolverMaquileroCabecera('9', maquileros, estampadores)).toBe(900);
  });

  it('devuelve null para vacío, "0" o sin mapeo', () => {
    expect(resolverMaquileroCabecera('', maquileros, estampadores)).toBeNull();
    expect(resolverMaquileroCabecera('0', maquileros, estampadores)).toBeNull();
    expect(resolverMaquileroCabecera('  ', maquileros, estampadores)).toBeNull();
    expect(resolverMaquileroCabecera('123', maquileros, estampadores)).toBeNull();
  });
});
