import { describe, expect, it } from 'vitest';

import { unicidadDeCampo } from './prisma-errores.js';

/**
 * El helper vivía SIN una sola prueba, y por eso nadie notó que miraba en el lugar equivocado:
 * la documentación de Prisma habla de `meta.target`, pero con el driver adapter (`@prisma/adapter-pg`)
 * el P2002 manda las columnas en `meta.driverAdapterError.cause.constraint.fields`.
 *
 * ⚠️ Los `meta` de abajo NO están inventados: son la forma REAL que imprimió el reviewer de
 * V1-E3f pieza B provocando la violación contra Postgres. Fabricar el error con la forma que uno
 * SUPONE es exactamente el defecto que estas pruebas existen para impedir — una prueba así confirma
 * la suposición de quien la escribió en vez de cazarla.
 */
describe('unicidadDeCampo', () => {
  const conDriverAdapter = (fields: string[]) => ({
    code: 'P2002',
    meta: { driverAdapterError: { cause: { constraint: { fields } } } },
  });

  it('⭐ reconoce la forma del DRIVER ADAPTER (la que llega hoy)', () => {
    expect(unicidadDeCampo(conDriverAdapter(['nombre_corto']), 'nombre_corto')).toBe(true);
  });

  it('⭐ reconoce el índice FUNCIONAL, que llega recortado y sin cerrar', () => {
    // Postgres reporta `lower(nombre_corto` — con paréntesis abierto y sin cerrar.
    expect(unicidadDeCampo(conDriverAdapter(['lower(nombre_corto']), 'nombre_corto')).toBe(true);
  });

  it('NO culpa al campo equivocado cuando el choque fue de otro único', () => {
    expect(unicidadDeCampo(conDriverAdapter(['nombre']), 'nombre_corto')).toBe(false);
    expect(unicidadDeCampo(conDriverAdapter(['lower(nombre']), 'nombre_corto')).toBe(false);
  });

  it('sigue reconociendo la forma documentada `meta.target`', () => {
    expect(
      unicidadDeCampo({ code: 'P2002', meta: { target: ['nombre_corto'] } }, 'nombre_corto'),
    ).toBe(true);
    expect(
      unicidadDeCampo({ code: 'P2002', meta: { target: 'nombre_corto' } }, 'nombre_corto'),
    ).toBe(true);
  });

  it('devuelve false —mensaje genérico, nunca uno específico equivocado— si no viene ninguna forma', () => {
    expect(unicidadDeCampo({ code: 'P2002', meta: {} }, 'nombre_corto')).toBe(false);
    expect(unicidadDeCampo({ code: 'P2002' }, 'nombre_corto')).toBe(false);
    expect(unicidadDeCampo(null, 'nombre_corto')).toBe(false);
    expect(unicidadDeCampo('P2002', 'nombre_corto')).toBe(false);
  });

  it('acepta varias columnas y acierta si alguna coincide', () => {
    expect(unicidadDeCampo(conDriverAdapter(['nombre_corto']), 'nombre', 'nombre_corto')).toBe(
      true,
    );
  });
});
