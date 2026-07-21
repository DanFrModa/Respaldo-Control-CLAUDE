/**
 * Unit de `MuestraAgregada` (bucket agregado con muestra acotada, ventana F5/F6/F7) — sin BD.
 */
import { describe, expect, it } from 'vitest';

import { MuestraAgregada } from './muestra.js';
import { Reporte } from './reporte.js';

describe('MuestraAgregada', () => {
  it('sin acumulaciones NO toca el reporte (invariante con ventana inactiva)', () => {
    const reporte = new Reporte();
    new MuestraAgregada().volcar(reporte, 'Bucket vacío');
    expect(reporte.tieneIncidencias).toBe(false);
  });

  it('acota la muestra pero el conteo total siempre sale completo', () => {
    const bucket = new MuestraAgregada(3);
    for (let i = 1; i <= 25; i += 1) {
      bucket.agregar(`Id=${String(i)}`);
    }
    expect(bucket.conteo).toBe(25);

    const reporte = new Reporte();
    bucket.volcar(reporte, 'Órdenes no migradas');
    const secciones = reporte.obtenerSecciones();
    expect(secciones).toHaveLength(1);
    // 1 renglón de total + 3 de muestra (NO 25).
    expect(secciones[0]?.renglones).toHaveLength(4);
    expect(secciones[0]?.renglones[0]).toContain('TOTAL = 25');
    expect(secciones[0]?.renglones[1]).toBe('muestra: Id=1');
    expect(secciones[0]?.renglones[3]).toBe('muestra: Id=3');
  });

  it('default de muestra ≈ 10', () => {
    const bucket = new MuestraAgregada();
    for (let i = 0; i < 100; i += 1) {
      bucket.agregar(`x${String(i)}`);
    }
    const reporte = new Reporte();
    bucket.volcar(reporte, 'T');
    expect(reporte.obtenerSecciones()[0]?.renglones).toHaveLength(11); // total + 10 muestras
  });
});
