/**
 * Tests UNITARIOS de los esquemas Zod de las etapas (F3-E2). Validan la captura (UX) que el
 * backend re-valida; aquí solo se comprueba que los esquemas aceptan/rechazan lo esperado.
 */
import { describe, expect, it } from 'vitest';

import { esquemaCorteCrear, esquemaEnvioCrear, esquemaEtapaCancelarCuerpo } from './etapa.js';

describe('esquemaCorteCrear (F3-E2)', () => {
  const valido = {
    idOrden: 1,
    idCortador: 2,
    fecha: '2026-06-18',
    lineas: [{ idColor: 3, tallas: [{ idTalla: 4, cantidad: 10 }] }],
  };

  it('acepta un corte válido', () => {
    expect(esquemaCorteCrear.safeParse(valido).success).toBe(true);
  });

  it('rechaza una matriz vacía', () => {
    expect(esquemaCorteCrear.safeParse({ ...valido, lineas: [] }).success).toBe(false);
  });

  it('rechaza cantidades negativas', () => {
    const r = esquemaCorteCrear.safeParse({
      ...valido,
      lineas: [{ idColor: 3, tallas: [{ idTalla: 4, cantidad: -1 }] }],
    });
    expect(r.success).toBe(false);
  });

  it('acepta cantidad 0 (sobre-corte libre: el dominio filtra ceros)', () => {
    const r = esquemaCorteCrear.safeParse({
      ...valido,
      lineas: [{ idColor: 3, tallas: [{ idTalla: 4, cantidad: 0 }] }],
    });
    expect(r.success).toBe(true);
  });

  it('rechaza una fecha malformada', () => {
    expect(esquemaCorteCrear.safeParse({ ...valido, fecha: '18/06/2026' }).success).toBe(false);
  });
});

describe('esquemaEnvioCrear (F3-E2)', () => {
  const valido = {
    idOrden: 1,
    idTipoProceso: 5,
    idMaquilero: 2,
    fecha: '2026-06-19',
    lineas: [{ idColor: 3, tallas: [{ idTalla: 4, cantidad: 10 }] }],
  };

  it('acepta un envío válido sin precio ni compromiso', () => {
    expect(esquemaEnvioCrear.safeParse(valido).success).toBe(true);
  });

  it('acepta precio pactado y fecha compromiso opcionales', () => {
    expect(
      esquemaEnvioCrear.safeParse({ ...valido, precioPactado: 12.5, fechaCompromiso: '2026-06-26' })
        .success,
    ).toBe(true);
  });

  it('rechaza precio pactado negativo', () => {
    expect(esquemaEnvioCrear.safeParse({ ...valido, precioPactado: -1 }).success).toBe(false);
  });

  it('exige el tipo de proceso', () => {
    const { idTipoProceso: _omitido, ...sinProceso } = valido;
    expect(esquemaEnvioCrear.safeParse(sinProceso).success).toBe(false);
  });
});

describe('esquemaEtapaCancelarCuerpo (F3-E2)', () => {
  it('exige un motivo de al menos 3 caracteres', () => {
    expect(esquemaEtapaCancelarCuerpo.safeParse({ motivo: 'ab' }).success).toBe(false);
    expect(esquemaEtapaCancelarCuerpo.safeParse({ motivo: 'error de captura' }).success).toBe(true);
  });
});
