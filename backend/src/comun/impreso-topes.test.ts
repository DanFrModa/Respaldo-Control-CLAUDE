import { describe, expect, it } from 'vitest';

import { MAX_FILAS_PDF, leyendaTruncado } from './impreso-topes.js';

/**
 * Unit del helper de topes de impresos (blindaje general de PDFs). La leyenda solo aparece cuando el
 * impreso dibujó MENOS renglones de los que cumplen el filtro; los totales del impreso siguen siendo
 * del universo completo (eso lo verifica cada impreso topado).
 */
describe('leyendaTruncado', () => {
  it('devuelve null cuando se muestran todos los renglones', () => {
    expect(leyendaTruncado(10, 10)).toBeNull();
    expect(leyendaTruncado(0, 0)).toBeNull();
    expect(leyendaTruncado(MAX_FILAS_PDF, MAX_FILAS_PDF)).toBeNull();
  });

  it('avisa "N de M" y remite al Excel cuando truncó', () => {
    const texto = leyendaTruncado(250, 3500);
    expect(texto).not.toBeNull();
    expect(texto).toContain('250');
    expect(texto).toContain('3,500');
    expect(texto).toContain('Excel');
  });
});
