/**
 * Pruebas del sembrador de datos ficticios de inventarios (las partes puras: banderas y rutas).
 *
 * La que de verdad importa aquí es la de la carpeta de los CFDI. Esos XML se rellenan con el **RFC
 * y la razón social de la empresa activa**, y este repositorio es **PÚBLICO**: si el default vuelve
 * a apuntar dentro del repo, la primera corrida hecha con el RFC capturado mete datos fiscales en
 * un archivo rastreado, y de ahí ya no salen. La prueba existe para que ese cambio no pase
 * desapercibido nunca más.
 */
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DIR_CFDI_POR_OMISION, rutaDentroDe } from './sembrar-demo-inventarios.js';

describe('carpeta por omisión de los CFDI ficticios', () => {
  it('🔴 está FUERA del repositorio (los XML llevan el RFC de la empresa)', () => {
    // `process.cwd()` es `backend/` al correr las pruebas; la raíz del repo es su padre.
    const raizRepo = resolve(process.cwd(), '..');
    expect(rutaDentroDe(DIR_CFDI_POR_OMISION, raizRepo)).toBe(false);
  });

  it('está en el temporal del sistema, que es donde se dijo que estaría', () => {
    expect(rutaDentroDe(DIR_CFDI_POR_OMISION, tmpdir())).toBe(true);
  });
});

describe('rutaDentroDe', () => {
  it('reconoce una ruta por debajo de la raíz', () => {
    expect(rutaDentroDe(`/casa/repo/backend/migracion`, '/casa/repo')).toBe(true);
  });

  it('reconoce la raíz misma', () => {
    expect(rutaDentroDe('/casa/repo', '/casa/repo')).toBe(true);
  });

  it('NO se deja engañar por un prefijo de texto compartido', () => {
    // `/casa/repositorio` empieza igual que `/casa/repo` pero NO está dentro.
    expect(rutaDentroDe('/casa/repositorio/x', '/casa/repo')).toBe(false);
  });

  it('resuelve rutas relativas antes de comparar', () => {
    const dentro = `..${sep}otro`;
    expect(rutaDentroDe(dentro, resolve(process.cwd(), '..'))).toBe(true);
    expect(rutaDentroDe(tmpdir(), resolve(process.cwd(), '..'))).toBe(false);
  });
});
