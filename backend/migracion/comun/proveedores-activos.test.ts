/**
 * Unit (sin BD) de la depuración de proveedores (§Post-F9.23). Lee un dump de prueba con
 * `TABLAS_DIR`, así que no toca los CSV reales ni la base.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { describirProveedoresActivos, resolverProveedoresActivos } from './proveedores-activos.js';

let dir: string;
let dirPrevio: string | undefined;
let desdePrevio: string | undefined;

/** Escribe un CSV mínimo con las columnas que el módulo mira. */
function csv(nombre: string, cabecera: string, filas: string[]): void {
  writeFileSync(join(dir, nombre), [cabecera, ...filas].join('\n'), 'latin1');
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tablas-prov-'));
  dirPrevio = process.env.TABLAS_DIR;
  desdePrevio = process.env.ETL_PROVEEDORES_DESDE;
  process.env.TABLAS_DIR = dir;

  // Comercial 10 compró en 2026; el 20, solo en 2019. El "0" es el nulo del viejo.
  csv('OrdCompra.csv', 'IdProveedor,Fecha', [
    '10,15/03/2026 10:00:00',
    '20,15/03/2019 10:00:00',
    '0,15/03/2026 10:00:00',
  ]);
  csv('Corte.csv', 'IdCortadores,Fecha', ['7,01/02/2025 00:00:00', '8,01/02/2010 00:00:00']);
  // El taller 30 solo aparece por una NOTA; el 31, solo por ESTAMPADO. Ambos siguen vivos.
  csv('Entregas.csv', 'IdMaquileros,Fecha', ['33,10/10/2024 00:00:00']);
  csv('Recibos.csv', 'IdMaquileros,Fecha', ['34,10/10/2018 00:00:00']);
  csv('Notas.csv', 'IdMaquileros,FechaElaboracion', ['30,05/05/2025 09:00:00']);
  csv('EntregasEst.csv', 'IdMaquileros,Fecha', ['31,06/06/2026 00:00:00']);
  csv('RecibosEst.csv', 'IdMaquileros,Fecha', ['31,07/06/2026 00:00:00']);
});

afterEach(() => {
  if (desdePrevio === undefined) delete process.env.ETL_PROVEEDORES_DESDE;
  else process.env.ETL_PROVEEDORES_DESDE = desdePrevio;
  if (dirPrevio === undefined) delete process.env.TABLAS_DIR;
  else process.env.TABLAS_DIR = dirPrevio;
  process.env.TABLAS_DIR = dir;
});

describe('resolverProveedoresActivos', () => {
  it('sin la variable NO recorta: todos siguen vivos', () => {
    delete process.env.ETL_PROVEEDORES_DESDE;
    const cfg = resolverProveedoresActivos();
    expect(cfg.desde).toBe(0);
    expect(cfg.activo('comercial', '20')).toBe(true);
    expect(cfg.activo('estampador', 'lo-que-sea')).toBe(true);
    expect(describirProveedoresActivos(cfg)).toMatch(/SIN depuración/);
  });

  it('con año de corte deja vivo al que movió algo y fuera al que no', () => {
    process.env.ETL_PROVEEDORES_DESDE = '2025';
    const cfg = resolverProveedoresActivos();
    expect(cfg.activo('comercial', '10')).toBe(true);
    expect(cfg.activo('comercial', '20')).toBe(false);
    expect(cfg.activo('cortador', '7')).toBe(true);
    expect(cfg.activo('cortador', '8')).toBe(false);
  });

  it('el taller sigue vivo por CUALQUIERA de sus cinco documentos', () => {
    process.env.ETL_PROVEEDORES_DESDE = '2025';
    const cfg = resolverProveedoresActivos();
    expect(cfg.activo('taller', '30')).toBe(true); // solo por una nota de salida
    expect(cfg.activo('taller', '31')).toBe(true); // solo por estampado
    expect(cfg.activo('taller', '33')).toBe(false); // su última entrega fue en 2024
    expect(cfg.conteos.taller).toBe(2);
  });

  it('el "0" del viejo es un nulo, no un tercero: nunca revive', () => {
    process.env.ETL_PROVEEDORES_DESDE = '2025';
    expect(resolverProveedoresActivos().activo('comercial', '0')).toBe(false);
  });

  it('el catálogo de Estampadores queda VACÍO: ningún documento le apunta por id', () => {
    process.env.ETL_PROVEEDORES_DESDE = '2025';
    const cfg = resolverProveedoresActivos();
    expect(cfg.conteos.estampador).toBe(0);
    expect(cfg.activo('estampador', '1')).toBe(false);
    expect(describirProveedoresActivos(cfg)).toMatch(/Estampadores queda fuera/);
  });

  it('un id sin fecha legible no declara vivo a nadie', () => {
    process.env.ETL_PROVEEDORES_DESDE = '2025';
    writeFileSync(join(dir, 'Corte.csv'), 'IdCortadores,Fecha\n99,\n', 'latin1');
    expect(resolverProveedoresActivos().activo('cortador', '99')).toBe(false);
  });

  it('un año inválido se trata como "sin depuración" (no recorta por accidente)', () => {
    process.env.ETL_PROVEEDORES_DESDE = 'ayer';
    expect(resolverProveedoresActivos().desde).toBe(0);
  });
});
