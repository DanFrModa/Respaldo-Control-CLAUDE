import { describe, expect, it } from 'vitest';

import { esquemaPrecostoLineaManualCrear } from './precosto.js';

/**
 * Contrato del alta de un renglón MANUAL de precosto. Lo que se fija aquí es la regla nueva de
 * Petición de Daniel (ago-2026): el renglón se puede LIGAR A UN AVÍO del catálogo (`idAvio`) y entonces el precio es
 * OPCIONAL (lo resuelve el dominio con la cascada amarrada); sin avío, el precio se teclea y sigue
 * siendo obligatorio.
 */
describe('esquemaPrecostoLineaManualCrear', () => {
  it('sin avío EXIGE el precio (el renglón de texto libre se sigue tecleando)', () => {
    const resultado = esquemaPrecostoLineaManualCrear.safeParse({
      idConceptoCosto: 5,
      descripcion: 'Flete de la muestra',
    });
    expect(resultado.success).toBe(false);
    expect(JSON.stringify(resultado.error?.issues)).toContain('precioUnit');
  });

  it('con avío el precio es OPCIONAL (lo resuelve el catálogo en el dominio)', () => {
    const datos = esquemaPrecostoLineaManualCrear.parse({ idConceptoCosto: 5, idAvio: 77 });
    expect(datos.idAvio).toBe(77);
    expect(datos.precioUnit).toBeUndefined();
  });

  it('con avío Y precio, el precio tecleado viaja igual (manda sobre el del catálogo)', () => {
    const datos = esquemaPrecostoLineaManualCrear.parse({
      idConceptoCosto: 5,
      idAvio: 77,
      precioUnit: 3.5,
      consumo: 2,
    });
    expect(datos.precioUnit).toBe(3.5);
    expect(datos.consumo).toBe(2);
  });

  it('sin avío y CON precio sigue siendo válido (el caso de siempre)', () => {
    const datos = esquemaPrecostoLineaManualCrear.parse({
      idConceptoCosto: 5,
      precioUnit: 4,
    });
    expect(datos.precioUnit).toBe(4);
    expect(datos.idAvio).toBeUndefined();
  });

  it('rechaza un idAvio que no sea entero positivo', () => {
    expect(
      esquemaPrecostoLineaManualCrear.safeParse({ idConceptoCosto: 5, idAvio: 0 }).success,
    ).toBe(false);
    expect(
      esquemaPrecostoLineaManualCrear.safeParse({ idConceptoCosto: 5, idAvio: 1.5 }).success,
    ).toBe(false);
  });

  it('el precio no puede ser negativo', () => {
    expect(
      esquemaPrecostoLineaManualCrear.safeParse({ idConceptoCosto: 5, precioUnit: -1 }).success,
    ).toBe(false);
  });
});
