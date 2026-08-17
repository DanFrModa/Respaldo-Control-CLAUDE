/**
 * Tests UNIT del GUARD de congelado del precosto (V1-E4 punto 2).
 *
 * Por qué existe: congelar es IRREVERSIBLE (la versión queda inmutable, D3) y su `costoTotal` es la
 * base literal del `costoUnit` de la lista de precios y del precio que se le cotiza al cliente. Un
 * modelo sin receta capturada produce renglones en $0.00 y el congelado los sellaba sin decir nada:
 * probado a mano "funciona" — solo miente. De ahí que la regresión viva aquí.
 */
import { describe, expect, it } from 'vitest';

import { ErrorConflicto } from '../../comun/errores.js';
import { exigirCostoCongelable } from './precostos.js';

describe('exigirCostoCongelable', () => {
  it('RECHAZA congelar en cero (la versión quedaría inmutable y sale de ahí el precio al cliente)', () => {
    expect(() => exigirCostoCongelable(0)).toThrow(ErrorConflicto);
  });

  it('el mensaje del cero dice QUÉ hacer (capturar la receta), no solo que falló', () => {
    let mensaje = '';
    try {
      exigirCostoCongelable(0);
    } catch (error) {
      mensaje = error instanceof Error ? error.message : '';
    }
    expect(mensaje).toContain('receta');
    expect(mensaje).toContain('maquila');
  });

  it('RECHAZA un total negativo (renglones mal capturados)', () => {
    expect(() => exigirCostoCongelable(-12.5)).toThrow(ErrorConflicto);
  });

  it('DEJA PASAR cualquier costo positivo, por chico que sea', () => {
    expect(() => exigirCostoCongelable(0.01)).not.toThrow();
    expect(() => exigirCostoCongelable(184.32)).not.toThrow();
  });
});
