/**
 * Pruebas del sembrador de datos ficticios de FINANZAS (las partes puras: rutas y concurrencia).
 *
 * La que de verdad importa aquí es la de la carpeta de los CFDI, y es la gemela de la que guarda al
 * sembrador de inventarios (`sembrar-demo-inventarios.test.ts`, fila 0.201). Estos XML los GENERA el
 * script con el **RFC y la razón social de la empresa activa** —y en los de VENTA eso va en el
 * **EMISOR**—, este repositorio es **PÚBLICO**, y la empresa de `prueba` **ya tiene su RFC real
 * capturado**: si el default vuelve a apuntar dentro del repo, la primera corrida que llegue al
 * final mete datos fiscales reales en una ruta rastreada, y de ahí ya no salen.
 *
 * O sea: esta prueba no comprueba una preferencia de estilo, comprueba que no se repita una fuga.
 */
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONCURRENCIA_FIN_POR_OMISION } from './demo/finanzas/sembrar.js';
import { DIR_CFDI_FINANZAS_POR_OMISION } from './sembrar-demo-finanzas.js';
import {
  DIR_CFDI_POR_OMISION,
  concurrenciaPedida,
  rutaDentroDe,
} from './sembrar-demo-inventarios.js';

describe('carpeta por omisión de los CFDI ficticios de finanzas', () => {
  it('🔴 está FUERA del repositorio (los XML llevan el RFC de la empresa)', () => {
    // `process.cwd()` es `backend/` al correr las pruebas; la raíz del repo es su padre.
    const raizRepo = resolve(process.cwd(), '..');
    expect(rutaDentroDe(DIR_CFDI_FINANZAS_POR_OMISION, raizRepo)).toBe(false);
  });

  it('está en el temporal del sistema, que es donde se dijo que estaría', () => {
    expect(rutaDentroDe(DIR_CFDI_FINANZAS_POR_OMISION, tmpdir())).toBe(true);
  });

  it('NO pisa la carpeta del sembrador de inventarios (se corren por separado)', () => {
    expect(resolve(DIR_CFDI_FINANZAS_POR_OMISION)).not.toBe(resolve(DIR_CFDI_POR_OMISION));
    expect(rutaDentroDe(DIR_CFDI_FINANZAS_POR_OMISION, DIR_CFDI_POR_OMISION)).toBe(false);
    expect(rutaDentroDe(DIR_CFDI_POR_OMISION, DIR_CFDI_FINANZAS_POR_OMISION)).toBe(false);
  });
});

describe('concurrenciaPedida reusada con el default de finanzas', () => {
  it('sin --concurrencia en la línea de órdenes, respeta el default que se le pasa', () => {
    // La prueba corre sin esa bandera, que es justo el caso que importa: el sembrador de finanzas
    // tiene que quedarse en SU número, no en el de inventarios.
    expect(process.argv.some((a) => a.startsWith('--concurrencia='))).toBe(false);
    expect(concurrenciaPedida(CONCURRENCIA_FIN_POR_OMISION)).toBe(CONCURRENCIA_FIN_POR_OMISION);
  });

  it('🔴 el default de finanzas es BAJO: es cuántas conexiones remotas se piden a la vez', () => {
    // Estaba en 10 (`LOTE_CATALOGOS`) y eso es lo que ahogaba al gemelo contra una base remota.
    expect(CONCURRENCIA_FIN_POR_OMISION).toBeLessThanOrEqual(4);
    expect(CONCURRENCIA_FIN_POR_OMISION).toBeGreaterThanOrEqual(1);
  });
});
