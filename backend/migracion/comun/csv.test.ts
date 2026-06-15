import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { contarFilasCsv, leerCsv } from './csv.js';

/** Carpeta de fixtures de la migración (`migracion/__fixtures__/`). */
const dirFixtures = fileURLToPath(new URL('../__fixtures__', import.meta.url));

describe('migración · lector CSV (parser real + latin-1)', () => {
  /** Normaliza CRLF→LF para comparar campos multilínea sin depender del EOL del fixture. */
  const nl = (s: string | undefined): string => (s ?? '').replace(/\r\n/g, '\n');

  it('maneja campos MULTILÍNEA entre comillas sin romper las filas', () => {
    const filas = leerCsv('Multilinea.csv', dirFixtures);
    // 3 filas de datos, aunque la primera tenga un salto de línea DENTRO de un campo.
    expect(filas).toHaveLength(3);
    expect(nl(filas[0]?.Telefonos)).toBe('01718-1240-395\n01718-1240-219');
  });

  it('respeta comillas y comas dentro de campos entrecomillados', () => {
    const filas = leerCsv('Multilinea.csv', dirFixtures);
    expect(filas[2]?.Nombre).toBe('Nombre, con coma');
    expect(filas[2]?.Telefonos).toBe('tel "entre comillas"');
  });

  it('contarFilasCsv usa el parser real (NO split por líneas)', () => {
    // El archivo tiene saltos de línea internos: un split('\n') daría un conteo mayor.
    expect(contarFilasCsv('Multilinea.csv', dirFixtures)).toBe(3);
  });

  it('decodifica en latin-1 (acentos y eñes intactos)', () => {
    const filas = leerCsv('Latin1.csv', dirFixtures);
    expect(filas).toHaveLength(2);
    expect(filas[0]?.Proveedor).toBe('José Núñez');
    expect(nl(filas[0]?.Direccion)).toBe('Calle Olivar\n2da Sección');
    expect(filas[1]?.Proveedor).toBe('Compañía Ñandú');
  });

  it('contarFilasCsv devuelve 0 si el archivo no existe', () => {
    expect(contarFilasCsv('NoExiste.csv', dirFixtures)).toBe(0);
  });
});
