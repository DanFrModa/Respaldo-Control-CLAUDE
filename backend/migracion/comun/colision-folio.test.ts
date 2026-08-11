/**
 * Unitarias de la DECISIÓN pura del guardia de folio ocupado (`clasificarExistentePorFolio`).
 *
 * Es el corazón del arreglo: el paso 2 de la idempotencia (¿existe ya un documento con este folio?)
 * tiene que separar TRES cosas que antes se confundían en una:
 *  • la RECUPERACIÓN de una corrida cortada,
 *  • el DUPLICADO DEL ORIGEN (el Access trae dos documentos con el mismo folio — la base de v2 está
 *    bien),
 *  • la COLISIÓN CON V2 (el folio lo ocupa algo capturado en v2 — la base NO estaba limpia).
 *
 * Mapear cualquiera de los dos últimos pegaba todos los hijos del volcado (cortes, envíos, recibos,
 * cargos EsMa, costos, RC) al documento equivocado, en silencio; y reportarlos con el MISMO texto le
 * daba a Gabriel un diagnóstico falso en la mitad de los casos.
 */
import { describe, expect, it } from 'vitest';

import {
  clasificarExistentePorFolio,
  lineaColisionesV2,
  lineaDuplicadosOrigen,
  tituloColisionFolio,
  tituloDuplicadoOrigen,
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

  it('COLISIÓN CON V2: el documento lo capturó una persona en v2 (mismo folio, otro documento)', () => {
    expect(
      clasificarExistentePorFolio({
        claveVieja: '4321',
        claveViejaDueno: null,
        creadoPorId: 'usr_daniel',
      }),
    ).toBe('colisionV2');
  });

  it('COLISIÓN CON V2: sin `creadoPorId` no hay nada que acredite al ETL — ante la duda, NO se mapea', () => {
    expect(
      clasificarExistentePorFolio({
        claveVieja: '4321',
        claveViejaDueno: null,
        creadoPorId: null,
      }),
    ).toBe('colisionV2');
  });

  it('DUPLICADO DEL ORIGEN: el documento ya es de OTRA clave vieja (dos filas del Access, mismo folio)', () => {
    // Aunque lo haya creado el ETL: ya tiene dueño, y no es quien estamos migrando ahora.
    expect(
      clasificarExistentePorFolio({
        claveVieja: '4321',
        claveViejaDueno: '999',
        creadoPorId: ID_USUARIO_ETL,
      }),
    ).toBe('duplicadoOrigen');
  });

  it('el DUPLICADO DEL ORIGEN se distingue de la COLISIÓN CON V2 (no son el mismo diagnóstico)', () => {
    // MISMO síntoma (el folio ya está ocupado), causas OPUESTAS: el duplicado lo trae el Access y no
    // dice nada de la base de destino; la colisión significa que la base no estaba limpia.
    const duplicado = clasificarExistentePorFolio({
      claveVieja: '4321',
      claveViejaDueno: '999',
      creadoPorId: ID_USUARIO_ETL,
    });
    const colision = clasificarExistentePorFolio({
      claveVieja: '4321',
      claveViejaDueno: null,
      creadoPorId: 'usr_daniel',
    });
    expect(duplicado).not.toBe(colision);
    expect(duplicado).toBe('duplicadoOrigen');
    expect(colision).toBe('colisionV2');
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

describe('reporte: secciones separadas por diagnóstico', () => {
  it('cada diagnóstico tiene SU propio título (no comparten sección)', () => {
    expect(tituloColisionFolio('Orden')).not.toBe(tituloDuplicadoOrigen('Orden'));
    expect(tituloColisionFolio('Orden')).toContain('Orden');
    expect(tituloDuplicadoOrigen('Orden')).toContain('Orden');
  });

  it('el duplicado de origen NO acusa a la base de v2; la colisión SÍ', () => {
    expect(tituloDuplicadoOrigen('OrdenCompra')).toContain('ORIGEN');
    expect(tituloDuplicadoOrigen('OrdenCompra')).toContain('NO es un problema de la base de v2');
    expect(tituloColisionFolio('OrdenCompra')).toContain('CAPTURADA EN V2');
  });
});

describe('líneas de consola', () => {
  it('sin casos NO imprimen nada (el caso normal no mete ruido)', () => {
    expect(lineaColisionesV2('Orden', 0)).toBeNull();
    expect(lineaColisionesV2('Orden', -1)).toBeNull();
    expect(lineaDuplicadosOrigen('Orden', 0, 'sus renglones')).toBeNull();
  });

  it('la colisión con v2 grita el conteo y recuerda la regla de go-live', () => {
    const linea = lineaColisionesV2('Orden', 3);
    expect(linea).toContain('3 Orden(s)');
    expect(linea).toContain('base LIMPIA');
  });

  it('el duplicado de origen dice de quién es la culpa y QUÉ se va con la fila', () => {
    const linea = lineaDuplicadosOrigen('OrdenCompra', 4, 'sus renglones y sus recepciones');
    expect(linea).toContain('4 OrdenCompra(s)');
    expect(linea).toContain('sus renglones y sus recepciones');
    expect(linea).toContain('NO es un ');
    // No debe mandar a vaciar la base: la base puede estar impecable.
    expect(linea).not.toContain('base LIMPIA');
  });
});
