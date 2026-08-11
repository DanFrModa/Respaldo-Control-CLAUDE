/**
 * Unitarias de la DECISIÓN pura del guardia de colisión de folio (`clasificarExistentePorFolio`).
 *
 * Es el corazón del arreglo: el paso 2 de la idempotencia (¿existe ya un documento con este folio?)
 * tiene que separar la RECUPERACIÓN de una corrida cortada de la COLISIÓN contra un documento que v2
 * capturó por su cuenta. Mapear la colisión pegaba todos los hijos del volcado (cortes, envíos,
 * recibos, cargos EsMa, costos, RC) a la orden equivocada, en silencio.
 */
import { describe, expect, it } from 'vitest';

import {
  clasificarExistentePorFolio,
  lineaColisiones,
  tituloColisionFolio,
} from './colision-folio.js';
import { ID_USUARIO_ETL } from './sesion-etl.js';

describe('clasificarExistentePorFolio', () => {
  it('RECUPERACIÓN: el documento lo creó el ETL y nadie lo reclama (corrida cortada antes de mapear)', () => {
    expect(
      clasificarExistentePorFolio({
        claveVieja: '4321',
        claveViejaDueno: null,
        creadoPorId: ID_USUARIO_ETL,
      }),
    ).toBe('recuperacion');
  });

  it('COLISIÓN: el documento lo capturó una persona en v2 (mismo folio, otro documento)', () => {
    expect(
      clasificarExistentePorFolio({
        claveVieja: '4321',
        claveViejaDueno: null,
        creadoPorId: 'usr_daniel',
      }),
    ).toBe('colision');
  });

  it('COLISIÓN: sin `creadoPorId` no hay nada que acredite al ETL — ante la duda, NO se mapea', () => {
    expect(
      clasificarExistentePorFolio({
        claveVieja: '4321',
        claveViejaDueno: null,
        creadoPorId: null,
      }),
    ).toBe('colision');
  });

  it('COLISIÓN: el documento ya es de OTRA clave vieja (dos filas del Access con el mismo folio)', () => {
    // Aunque lo haya creado el ETL: ya tiene dueño, y no es quien estamos migrando ahora.
    expect(
      clasificarExistentePorFolio({
        claveVieja: '4321',
        claveViejaDueno: '999',
        creadoPorId: ID_USUARIO_ETL,
      }),
    ).toBe('colision');
  });

  it('RECUPERACIÓN (defensivo): el documento ya es de ESTA misma clave vieja', () => {
    expect(
      clasificarExistentePorFolio({
        claveVieja: '4321',
        claveViejaDueno: '4321',
        creadoPorId: 'usr_daniel',
      }),
    ).toBe('recuperacion');
  });
});

describe('reporte de colisiones', () => {
  it('el título nombra el documento (una sección por entidad)', () => {
    expect(tituloColisionFolio('Orden')).toContain('Orden');
    expect(tituloColisionFolio('Orden')).toContain('COLISIÓN DE FOLIO');
  });

  it('sin colisiones NO imprime nada (el caso normal no mete ruido)', () => {
    expect(lineaColisiones('Orden', 0)).toBeNull();
    expect(lineaColisiones('Orden', -1)).toBeNull();
  });

  it('con colisiones grita el conteo y recuerda la regla de go-live', () => {
    const linea = lineaColisiones('Orden', 3);
    expect(linea).toContain('3 Orden(s)');
    expect(linea).toContain('base LIMPIA');
  });
});
