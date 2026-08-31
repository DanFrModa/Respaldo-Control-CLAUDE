import { describe, expect, it } from 'vitest';

import { esquemaAbrirRecetaCuerpo } from './receta-orden.js';

/**
 * ⭐⭐ V1-E8z — EL CONTRATO DEL CANDADO DE COMPRA (§Post-F9.160(a)): la primera puerta, la que ni
 * siquiera deja llegar al dominio lo que no tiene sentido.
 *
 * 🔴 **Por qué el motivo es obligatorio, y por qué se prueba aquí.** Abrir la receta **congela la
 * compra de una orden entera**, y ese texto es LITERALMENTE lo que el comprador va a leer en el 409
 * cuando su orden de compra sea rechazada. Un candado anónimo se vuelve un misterio a las dos horas.
 * Dejarlo opcional «porque la pantalla ya lo pide» es el error que §Post-F9.68 nombró: hay que
 * esconder *y* bloquear, y el bloqueo vive en el servidor.
 */
describe('esquemaAbrirRecetaCuerpo — el motivo del candado (V1-E8z)', () => {
  it('acepta un motivo con texto y lo deja RECORTADO (lo que se guarda es lo que se lee)', () => {
    const r = esquemaAbrirRecetaCuerpo.safeParse({ motivo: '  el cliente cambió el cierre  ' });
    expect(r.success).toBe(true);
    expect(r.data?.motivo).toBe('el cliente cambió el cierre');
  });

  it('🔴 rechaza el cuerpo SIN motivo', () => {
    expect(esquemaAbrirRecetaCuerpo.safeParse({}).success).toBe(false);
  });

  it('🔴 y rechaza un motivo que sólo son ESPACIOS (recortar primero, exigir después)', () => {
    // Sin el `.trim()` antes del `.min(1)`, «   » pasaría: el candado quedaría puesto con un motivo
    // en blanco, que es exactamente lo mismo que sin motivo pero más difícil de detectar.
    expect(esquemaAbrirRecetaCuerpo.safeParse({ motivo: '     ' }).success).toBe(false);
  });

  it('rechaza un motivo absurdamente largo (defensa del cuerpo, no regla de negocio)', () => {
    expect(esquemaAbrirRecetaCuerpo.safeParse({ motivo: 'x'.repeat(2001) }).success).toBe(false);
  });
});
