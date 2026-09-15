/**
 * La TOLERANCIA del cotejo (fila 0.117, §Post-F9.232 (b)): **un peso fijo, sin porcentaje**.
 *
 * ⚠️ Estas pruebas están escritas contra la DECISIÓN, no contra el código: si alguien reintrodujera
 * el porcentaje que Daniel rechazó, «cuadra» empezaría a depender del tamaño de la factura y los
 * dos casos de escala de abajo se pondrían rojos. Una invariante por `it`.
 */
import { describe, expect, it } from 'vitest';

import { cotejoCuadra, diferenciaDeCotejo, TOLERANCIA_COTEJO_PESOS } from './cotejo-tolerancia.js';

describe('la tolerancia del cotejo', () => {
  it('es UN PESO, tal cual lo dijo Daniel', () => {
    expect(TOLERANCIA_COTEJO_PESOS).toBe(1);
  });

  it('lo exacto cuadra', () => {
    expect(cotejoCuadra(11_600, 11_600)).toBe(true);
  });

  it('un peso EXACTO de diferencia cuadra (el caso que él nombró)', () => {
    expect(cotejoCuadra(11_600, 11_599)).toBe(true);
    expect(cotejoCuadra(11_600, 11_601)).toBe(true);
  });

  it('un peso con un centavo YA NO cuadra', () => {
    expect(cotejoCuadra(11_600, 11_598.99)).toBe(false);
  });

  it('una factura sin nada aplicado nunca cuadra (el descuadre más común)', () => {
    expect(cotejoCuadra(11_600, 0)).toBe(false);
  });

  it('NO es un porcentaje: en una factura chica, dos pesos siguen sin cuadrar', () => {
    // Con el 0.5 % que se propuso como default (y Daniel descartó), 100 ± 0.5 cuadraría y esto no
    // diría nada; el punto es que la regla no mira el tamaño de la factura.
    expect(cotejoCuadra(100, 98)).toBe(false);
  });

  it('NO es un porcentaje: en una factura grande, dos pesos TAMPOCO cuadran', () => {
    // Con un 0.5 % relativo, 1,000,000 toleraría 5,000 de diferencia. Aquí no.
    expect(cotejoCuadra(1_000_000, 999_998)).toBe(false);
  });

  it('la diferencia se redondea a centavos antes de comparar (nada de residuos binarios)', () => {
    // 0.1 + 0.2 === 0.30000000000000004 en coma flotante.
    expect(diferenciaDeCotejo(0.3, 0.1 + 0.2)).toBe(0);
  });

  it('la diferencia es ABSOLUTA: facturar de más pesa igual que facturar de menos', () => {
    expect(diferenciaDeCotejo(500, 502.5)).toBe(2.5);
    expect(diferenciaDeCotejo(502.5, 500)).toBe(2.5);
  });
});
