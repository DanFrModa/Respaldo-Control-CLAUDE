/**
 * Pruebas del DESVÍO de compra (V1-E3u, §Post-F9.89(a)).
 *
 * 🔴 La aserción que de verdad importa no es "detecta el desvío": es que **el desvío AVISA y NO
 * BLOQUEA**. Este módulo no puede lanzar nunca — si algún día alguien le mete un `throw`, estas
 * pruebas se ponen rojas.
 */
import { describe, expect, it } from 'vitest';

import {
  avisoDeDesvio,
  desvioPasaUmbral,
  PCT_DESVIO_COMPRA_DEFECTO,
  porcentajeDeDesvio,
} from './desvio-de-compra.js';

describe('porcentajeDeDesvio', () => {
  it('mide de MÁS con signo positivo', () => {
    expect(porcentajeDeDesvio(100, 130)).toBeCloseTo(30, 9);
  });

  it('mide de MENOS con signo negativo (comprar de menos también es desvío)', () => {
    expect(porcentajeDeDesvio(100, 80)).toBeCloseTo(-20, 9);
  });

  it('sin propuesta devuelve NULL, no cero — "no se sabe" no es "no hubo desvío"', () => {
    expect(porcentajeDeDesvio(null, 500)).toBeNull();
    expect(porcentajeDeDesvio(undefined, 500)).toBeNull();
    expect(porcentajeDeDesvio(0, 500)).toBeNull();
  });
});

describe('desvioPasaUmbral', () => {
  it('el default de la empresa es 10 %', () => {
    expect(PCT_DESVIO_COMPRA_DEFECTO).toBe(10);
  });

  it('justo EN el umbral no avisa; arriba sí', () => {
    expect(desvioPasaUmbral(100, 110, 10)).toBe(false);
    expect(desvioPasaUmbral(100, 110.01, 10)).toBe(true);
  });

  it('avisa también por debajo (−12 % con umbral 10)', () => {
    expect(desvioPasaUmbral(100, 88, 10)).toBe(true);
  });

  it('sin propuesta NO avisa (no hay contra qué medir)', () => {
    expect(desvioPasaUmbral(null, 9999, 10)).toBe(false);
  });
});

describe('avisoDeDesvio', () => {
  const base = { material: 'Felpa 280', unidad: 'KG', pctUmbral: 10 };

  it('NO devuelve aviso dentro del umbral (y NUNCA lanza: avisa, no bloquea)', () => {
    expect(avisoDeDesvio({ ...base, propuesta: 100, capturada: 105 })).toBeNull();
    // La prueba de que no bloquea: llamarlo con un desvío enorme devuelve texto, no una excepción.
    expect(() => avisoDeDesvio({ ...base, propuesta: 100, capturada: 100000 })).not.toThrow();
  });

  it('nombra el material, las dos cantidades, el porcentaje y de qué lado se fue', () => {
    const aviso = avisoDeDesvio({ ...base, propuesta: 100, capturada: 130 });
    expect(aviso).not.toBeNull();
    expect(aviso).toContain('Felpa 280');
    expect(aviso).toContain('130');
    expect(aviso).toContain('100');
    expect(aviso).toContain('30%');
    expect(aviso).toContain('MÁS');
    // Y dice explícitamente que no impide autorizar (§Post-F9.64: guía, no jaula).
    expect(aviso).toContain('No impide autorizar');
  });

  it('dice MENOS cuando se compró de menos', () => {
    const aviso = avisoDeDesvio({ ...base, propuesta: 100, capturada: 50 });
    expect(aviso).toContain('MENOS');
    expect(aviso).toContain('50%');
  });

  it('sin propuesta no hay aviso (una línea capturada a mano no se compara con nada)', () => {
    expect(avisoDeDesvio({ ...base, propuesta: null, capturada: 5000 })).toBeNull();
  });
});
