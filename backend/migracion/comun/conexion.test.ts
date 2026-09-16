/**
 * Pruebas de `comun/conexion.ts` — la robustez de CONEXIÓN de los scripts que se corren a mano
 * contra la base remota de `prueba`.
 *
 * Lo que se asegura aquí es, sobre todo, que **no se reintente lo que no se debe**: un error de
 * negocio (un nombre repetido, una validación) tiene que salir a la primera, sin esperas ni
 * reintentos que lo disfracen de problema de red.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../src/datos/index.js';

import {
  conReintentoConexion,
  diagnosticoConexiones,
  esErrorDeConexion,
  hayColgadas,
  textoAyudaConexion,
  textoDiagnostico,
  type DiagnosticoConexiones,
} from './conexion.js';

/** Un error con `code`, como los que lanza Prisma. */
function errorConCodigo(code: string): Error {
  return Object.assign(new Error(`fallo ${code}`), { code });
}

describe('esErrorDeConexion', () => {
  it.each(['P2028', 'P2037', 'P1001', 'P1002', 'P1017'])('reconoce %s', (code) => {
    expect(esErrorDeConexion(errorConCodigo(code))).toBe(true);
  });

  it('reconoce un corte transitorio del enlace (sin código de Prisma)', () => {
    expect(esErrorDeConexion(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(esErrorDeConexion(errorConCodigo('ECONNRESET'))).toBe(true);
  });

  it('NO confunde un error de negocio con uno de conexión', () => {
    expect(esErrorDeConexion(new Error('Ya existe un proveedor llamado "DEMO-Telas"'))).toBe(false);
    // P2002 es unicidad: es un conflicto de DATOS y debe salir a la primera.
    expect(esErrorDeConexion(errorConCodigo('P2002'))).toBe(false);
    expect(esErrorDeConexion(null)).toBe(false);
    expect(esErrorDeConexion('vacío')).toBe(false);
  });
});

describe('conReintentoConexion', () => {
  it('devuelve el valor sin reintentar cuando todo va bien', async () => {
    const accion = vi.fn(() => Promise.resolve(42));
    await expect(conReintentoConexion(accion, { baseMs: 1 })).resolves.toBe(42);
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it('reintenta ante un error de conexión y acaba pasando', async () => {
    const accion = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(errorConCodigo('P2028'))
      .mockRejectedValueOnce(errorConCodigo('P2037'))
      .mockResolvedValue('listo');
    await expect(conReintentoConexion(accion, { baseMs: 1 })).resolves.toBe('listo');
    expect(accion).toHaveBeenCalledTimes(3);
  });

  it('se rinde tras `maxIntentos` y relanza el último error', async () => {
    const accion = vi.fn(() => Promise.reject(errorConCodigo('P2028')));
    await expect(conReintentoConexion(accion, { maxIntentos: 3, baseMs: 1 })).rejects.toMatchObject(
      {
        code: 'P2028',
      },
    );
    expect(accion).toHaveBeenCalledTimes(3);
  });

  it('NO reintenta un error de negocio: sale a la primera', async () => {
    const accion = vi.fn(() =>
      Promise.reject(new Error('El proveedor debe tener al menos un rol')),
    );
    await expect(conReintentoConexion(accion, { baseMs: 1 })).rejects.toThrow(/al menos un rol/);
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it('avisa de cada reintento con una espera CRECIENTE', async () => {
    const avisos: number[] = [];
    const accion = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(errorConCodigo('P2028'))
      .mockRejectedValueOnce(errorConCodigo('P2028'))
      .mockResolvedValue(1);
    await conReintentoConexion(accion, {
      baseMs: 2,
      alReintentar: (i) => avisos.push(i.esperaMs),
    });
    expect(avisos).toEqual([2, 4]);
  });
});

describe('diagnóstico del cupo', () => {
  const d: DiagnosticoConexiones = {
    maximo: 40,
    total: 38,
    porEstado: [
      { estado: 'active', cuantas: 30 },
      { estado: 'idle', cuantas: 5 },
      { estado: 'idle in transaction', cuantas: 3 },
    ],
  };

  it('resume el cupo en una línea legible', () => {
    expect(textoDiagnostico(d)).toBe(
      'Conexiones a la base: 38 ocupadas de 40 (30 active, 5 idle, 3 idle in transaction).',
    );
  });

  it('cuenta las conexiones colgadas en transacción', () => {
    expect(hayColgadas(d)).toBe(3);
    expect(hayColgadas({ maximo: 10, total: 1, porEstado: [{ estado: 'idle', cuantas: 1 }] })).toBe(
      0,
    );
  });

  it('lee el cupo de la base', async () => {
    const cliente = {
      $queryRaw: vi
        .fn<() => Promise<unknown>>()
        .mockResolvedValueOnce([{ maximo: 40 }])
        .mockResolvedValueOnce([{ estado: 'active', cuantas: 2 }]),
    } as unknown as PrismaClient;
    await expect(diagnosticoConexiones(cliente)).resolves.toEqual({
      maximo: 40,
      total: 2,
      porEstado: [{ estado: 'active', cuantas: 2 }],
    });
  });

  it('nunca tumba la corrida: si no se puede leer el cupo, devuelve null', async () => {
    const cliente = {
      $queryRaw: vi.fn(() => Promise.reject(new Error('permiso denegado'))),
    } as unknown as PrismaClient;
    await expect(diagnosticoConexiones(cliente)).resolves.toBeNull();
  });
});

describe('textoAyudaConexion', () => {
  const base = { comando: 'npx tsx migracion/sembrar-demo-inventarios.ts', concurrencia: 4 };

  it('dice qué hacer, en español y sin jerga de Prisma', () => {
    const t = textoAyudaConexion({ ...base, diagnostico: null });
    expect(t).toContain('NO SE PUDO CONECTAR');
    expect(t).toContain('--concurrencia=1');
    expect(t).toContain('Vuelve a correrlo');
    // Nada de nombres de error crudos en el mensaje del usuario.
    expect(t).not.toContain('P2028');
    expect(t).not.toContain('PrismaClient');
  });

  it('señala las conexiones colgadas cuando las hay', () => {
    const t = textoAyudaConexion({
      ...base,
      diagnostico: {
        maximo: 20,
        total: 20,
        porEstado: [{ estado: 'idle in transaction', cuantas: 4 }],
      },
    });
    expect(t).toContain('idle in transaction');
    expect(t).toContain('4');
  });

  it('repite la concurrencia con la que se corrió, para poder bajarla', () => {
    expect(textoAyudaConexion({ ...base, concurrencia: 8, diagnostico: null })).toContain(
      'ahora iba en 8',
    );
  });
});
