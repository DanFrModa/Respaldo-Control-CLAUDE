import { describe, expect, it } from 'vitest';

import { filtroOrdenesCerradas } from './filtro-cerradas.js';

/**
 * ⭐ 0.227 — el `where` del filtro de cerradas. La prueba que manda es la de integración
 * (`filtro-cerradas.int.test.ts`, contra la base); ésta fija lo que no debe moverse sin que se vea:
 * el default no filtra nada, y el criterio es `cerradaEn` (nunca el `estado`, que es su espejo).
 */
describe('filtroOrdenesCerradas', () => {
  it('`incluir` no agrega nada (la consulta queda como siempre)', () => {
    expect(filtroOrdenesCerradas('incluir')).toEqual({});
  });

  it('`ocultar` pide `cerradaEn` nulo', () => {
    expect(filtroOrdenesCerradas('ocultar')).toEqual({ cerradaEn: null });
  });

  it('`solo` pide `cerradaEn` con valor', () => {
    expect(filtroOrdenesCerradas('solo')).toEqual({ cerradaEn: { not: null } });
  });

  it('nunca filtra por el `estado` (el espejo): la verdad del cierre es `cerradaEn`', () => {
    for (const valor of ['incluir', 'ocultar', 'solo'] as const) {
      expect(filtroOrdenesCerradas(valor)).not.toHaveProperty('estado');
    }
  });
});
