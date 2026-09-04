/**
 * Tests UNITARIOS de los esquemas Zod de las etapas (F3-E2). Validan la captura (UX) que el
 * backend re-valida; aquí solo se comprueba que los esquemas aceptan/rechazan lo esperado.
 */
import { describe, expect, it } from 'vitest';

import {
  esquemaCorteCrear,
  esquemaEmpaqueCrear,
  esquemaEnvioCrear,
  esquemaEtapaCancelarCuerpo,
} from './etapa.js';

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

  // ── 0.114: el corte es PAGABLE ────────────────────────────────────────────────────────────────
  it('⭐ acepta el PRECIO PACTADO con el cortador (0.114)', () => {
    expect(esquemaCorteCrear.safeParse({ ...valido, precioPactado: 3.5 }).success).toBe(true);
  });

  it('sigue aceptando un corte SIN precio (es opcional: se teclea al validar el cargo)', () => {
    expect(esquemaCorteCrear.safeParse(valido).success).toBe(true);
    expect(esquemaCorteCrear.safeParse({ ...valido, precioPactado: null }).success).toBe(true);
  });

  it('rechaza un precio NEGATIVO', () => {
    expect(esquemaCorteCrear.safeParse({ ...valido, precioPactado: -1 }).success).toBe(false);
  });

  it('rechaza un precio con MÁS DE 2 DECIMALES (la columna es Decimal(12,2))', () => {
    // Sin este tope, un 3.456 se guardaría redondeado en silencio y el cargo diría otro número.
    expect(esquemaCorteCrear.safeParse({ ...valido, precioPactado: 3.456 }).success).toBe(false);
    // Y los dos decimales legítimos SÍ pasan (el tope no puede cerrarse de más).
    expect(esquemaCorteCrear.safeParse({ ...valido, precioPactado: 12.34 }).success).toBe(true);
    expect(esquemaCorteCrear.safeParse({ ...valido, precioPactado: 0 }).success).toBe(true);
  });
});

describe('esquemaEmpaqueCrear (0.114 — servicio sobre la orden, hermano del corte)', () => {
  const valido = {
    idOrden: 1,
    idEmpacador: 2,
    fecha: '2026-09-04',
    lineas: [{ idColor: 3, tallas: [{ idTalla: 4, cantidad: 10 }] }],
  };

  it('acepta un empaque válido (sin precio: es opcional)', () => {
    expect(esquemaEmpaqueCrear.safeParse(valido).success).toBe(true);
  });

  it('acepta precio pactado y observaciones', () => {
    expect(
      esquemaEmpaqueCrear.safeParse({
        ...valido,
        precioPactado: 1.25,
        observaciones: 'Cajas de 12',
      }).success,
    ).toBe(true);
  });

  it('exige el EMPACADOR (es quien cobra el servicio)', () => {
    const { idEmpacador: _quitado, ...sinEmpacador } = valido;
    expect(esquemaEmpaqueCrear.safeParse(sinEmpacador).success).toBe(false);
  });

  it('rechaza una matriz vacía', () => {
    expect(esquemaEmpaqueCrear.safeParse({ ...valido, lineas: [] }).success).toBe(false);
  });

  it('rechaza cantidades negativas', () => {
    expect(
      esquemaEmpaqueCrear.safeParse({
        ...valido,
        lineas: [{ idColor: 3, tallas: [{ idTalla: 4, cantidad: -1 }] }],
      }).success,
    ).toBe(false);
  });

  it('rechaza un precio negativo o con más de 2 decimales', () => {
    expect(esquemaEmpaqueCrear.safeParse({ ...valido, precioPactado: -0.5 }).success).toBe(false);
    expect(esquemaEmpaqueCrear.safeParse({ ...valido, precioPactado: 1.005 }).success).toBe(false);
  });

  it('NO admite `idTipoProceso`: el empaque no es maquila (esa es su marca)', () => {
    const r = esquemaEmpaqueCrear.safeParse({ ...valido, idTipoProceso: 5 });
    // Zod por defecto ignora las claves de más; lo que importa es que el dato NO viaja al dominio.
    expect(r.success).toBe(true);
    expect(r.success && 'idTipoProceso' in r.data).toBe(false);
  });

  it('NO admite `fechaCompromiso`: no hay a quién esperarle (no va y viene)', () => {
    const r = esquemaEmpaqueCrear.safeParse({ ...valido, fechaCompromiso: '2026-09-30' });
    expect(r.success && 'fechaCompromiso' in r.data).toBe(false);
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
