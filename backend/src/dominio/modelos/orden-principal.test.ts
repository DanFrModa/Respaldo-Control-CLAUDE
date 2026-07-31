/**
 * Unit del cálculo de "marcar como PRINCIPAL" (jul-2026, petición de Daniel). Es la parte PURA que
 * comparten la foto principal del modelo y el arte principal del BOM: mover el elegido al primer
 * lugar, reindexar el resto conservando su orden relativo y escribir SOLO lo que cambia.
 */
import { describe, expect, it } from 'vitest';

import { reordenarComoPrincipal, type RenglonOrdenado } from './orden-principal.js';

/** Aplica los cambios calculados sobre el estado actual (simula lo que escribe la transacción). */
function aplicar(
  actuales: RenglonOrdenado<number>[],
  cambios: RenglonOrdenado<number>[],
): RenglonOrdenado<number>[] {
  const nuevoOrden = new Map(cambios.map((c) => [c.clave, c.orden]));
  return [...actuales]
    .map((r) => ({ clave: r.clave, orden: nuevoOrden.get(r.clave) ?? r.orden }))
    .sort((a, b) => a.orden - b.orden || a.clave - b.clave);
}

describe('reordenarComoPrincipal', () => {
  it('mueve la elegida al primer lugar y reindexa el resto conservando su orden relativo', () => {
    const actuales = [
      { clave: 10, orden: 0 },
      { clave: 20, orden: 1 },
      { clave: 30, orden: 2 },
    ];

    const { cambios, resultado } = reordenarComoPrincipal(actuales, 30);

    expect(resultado).toEqual([30, 10, 20]);
    // Solo se escriben los tres renglones que de verdad cambian de posición.
    expect(cambios).toEqual([
      { clave: 30, orden: 0 },
      { clave: 10, orden: 1 },
      { clave: 20, orden: 2 },
    ]);
    expect(aplicar(actuales, cambios).map((r) => r.clave)).toEqual([30, 10, 20]);
  });

  it('es IDEMPOTENTE: marcar dos veces la misma no produce cambios la segunda vez', () => {
    const actuales = [
      { clave: 10, orden: 0 },
      { clave: 20, orden: 1 },
      { clave: 30, orden: 2 },
    ];

    const primera = reordenarComoPrincipal(actuales, 20);
    expect(primera.cambios.length).toBeGreaterThan(0);

    const segunda = reordenarComoPrincipal(aplicar(actuales, primera.cambios), 20);
    expect(segunda.cambios).toEqual([]);
    expect(segunda.resultado).toEqual([20, 10, 30]);
  });

  it('marcar la que YA era la primera con el orden compacto no escribe nada', () => {
    const { cambios, resultado } = reordenarComoPrincipal(
      [
        { clave: 7, orden: 0 },
        { clave: 8, orden: 1 },
      ],
      7,
    );
    expect(cambios).toEqual([]);
    expect(resultado).toEqual([7, 8]);
  });

  it('COMPACTA los órdenes con huecos o empates (el histórico entra todo en 0)', () => {
    // Caso real del histórico: todos los renglones en `orden` 0, el desempate lo da la lectura.
    const actuales = [
      { clave: 1, orden: 0 },
      { clave: 2, orden: 0 },
      { clave: 3, orden: 0 },
    ];

    const { cambios, resultado } = reordenarComoPrincipal(actuales, 2);

    expect(resultado).toEqual([2, 1, 3]);
    // El elegido ya valía 0, así que solo se reindexan los otros dos (1 y 2, sin empates).
    expect(cambios).toEqual([
      { clave: 1, orden: 1 },
      { clave: 3, orden: 2 },
    ]);
    expect(aplicar(actuales, cambios).map((r) => r.orden)).toEqual([0, 1, 2]);
  });

  it('con un solo renglón no hay nada que mover (ya es el principal por definición)', () => {
    expect(reordenarComoPrincipal([{ clave: 5, orden: 0 }], 5)).toEqual({
      cambios: [],
      resultado: [5],
    });
  });

  it('una clave que no está en la lista no altera nada (el llamador ya la validó)', () => {
    const actuales = [
      { clave: 1, orden: 0 },
      { clave: 2, orden: 1 },
    ];
    expect(reordenarComoPrincipal(actuales, 99)).toEqual({ cambios: [], resultado: [1, 2] });
  });
});
