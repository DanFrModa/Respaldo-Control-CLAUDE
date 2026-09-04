/**
 * Unitarias del guard de ALMACÉN (`comun/almacenes.ts`) — fila 0.137.
 *
 * Lo que se prueba aquí es la REGLA, no la base: la `tx` es de mentiras (devuelve la fila que el
 * caso quiere) porque lo único que importa es qué mensaje lanza cada combinación
 * existe/activo/empresa/tipo, y en qué ORDEN gana cada verificación. Los tests de integración
 * (`*.int.test.ts` de cada escritor) prueban que el guard esté ENCHUFADO donde toca.
 */
import { describe, expect, it, vi } from 'vitest';

import { exigirAlmacen, exigirAlmacenDelTipo } from './almacenes.js';
import { ErrorNoEncontrado, ErrorValidacion } from './errores.js';
import type { Tx } from './transaccion.js';

/** Fila de `Almacen` tal como la lee el guard (los campos de su `select`). */
interface FilaAlmacen {
  activo: boolean;
  idEmpresa: number | null;
  nombre: string;
  tipo: 'PT' | 'TELA' | 'AVIO';
}

/** `tx` de mentiras cuyo `almacen.findUnique` devuelve la fila dada (o null si no existe). */
function txCon(fila: FilaAlmacen | null): { tx: Tx; findUnique: ReturnType<typeof vi.fn> } {
  const findUnique = vi.fn(() => Promise.resolve(fila));
  return { tx: { almacen: { findUnique } } as unknown as Tx, findUnique };
}

/** Un almacén usable de la empresa 7, con el tipo que se le pida. */
function usable(tipo: FilaAlmacen['tipo'], nombre = 'Naucalpan'): FilaAlmacen {
  return { activo: true, idEmpresa: 7, nombre, tipo };
}

describe('exigirAlmacenDelTipo — el tipo del almacén (fila 0.137)', () => {
  it('el tipo CORRECTO pasa sin lanzar', async () => {
    const { tx } = txCon(usable('PT', 'Primeras'));
    await expect(exigirAlmacenDelTipo(tx, 3, 'PT', 7)).resolves.toBeUndefined();
  });

  it('un almacén GLOBAL (sin empresa) del tipo correcto pasa', async () => {
    const { tx } = txCon({ activo: true, idEmpresa: null, nombre: 'Primeras', tipo: 'PT' });
    await expect(exigirAlmacenDelTipo(tx, 3, 'PT', 7)).resolves.toBeUndefined();
  });

  it('PT contra un almacén de TELA lanza, con el NOMBRE del almacén y qué guarda cada uno', async () => {
    const { tx } = txCon(usable('TELA', 'Naucalpan'));
    await expect(exigirAlmacenDelTipo(tx, 3, 'PT', 7)).rejects.toThrow(ErrorValidacion);
    await expect(exigirAlmacenDelTipo(tx, 3, 'PT', 7)).rejects.toThrow(
      /"Naucalpan" es de telas; este movimiento es de producto terminado/,
    );
  });

  it('TELA contra un almacén de PT lanza (el cruce inverso)', async () => {
    const { tx } = txCon(usable('PT', 'Primeras'));
    await expect(exigirAlmacenDelTipo(tx, 3, 'TELA', 7)).rejects.toThrow(
      /"Primeras" es de producto terminado; este movimiento es de telas/,
    );
  });

  it('AVIO contra un almacén de TELA lanza y dice qué elegir', async () => {
    const { tx } = txCon(usable('TELA', 'Naucalpan'));
    await expect(exigirAlmacenDelTipo(tx, 3, 'AVIO', 7)).rejects.toThrow(
      /es de telas; este movimiento es de avíos\. Elige un almacén de avíos\./,
    );
  });

  it('un almacén que NO existe lanza ErrorNoEncontrado (no el del tipo)', async () => {
    const { tx } = txCon(null);
    await expect(exigirAlmacenDelTipo(tx, 99, 'PT', 7)).rejects.toThrow(ErrorNoEncontrado);
  });

  it('un almacén DESACTIVADO lanza por inactivo aunque el tipo sí cuadre', async () => {
    const { tx } = txCon({ activo: false, idEmpresa: 7, nombre: 'Bodega vieja', tipo: 'PT' });
    await expect(exigirAlmacenDelTipo(tx, 3, 'PT', 7)).rejects.toThrow(
      /"Bodega vieja" está desactivado/,
    );
  });

  it('un almacén de OTRA empresa lanza por la empresa, NO por el tipo (A9 gana)', async () => {
    // Tipo equivocado Y empresa ajena a la vez: el mensaje debe ser el de la empresa. Decir "es de
    // telas" de un almacén que esta sesión no debería ni ver filtraría datos de la otra empresa.
    const { tx } = txCon({ activo: true, idEmpresa: 99, nombre: 'Bodega ajena', tipo: 'TELA' });
    await expect(exigirAlmacenDelTipo(tx, 3, 'PT', 7)).rejects.toThrow(
      /"Bodega ajena" no es de esta empresa/,
    );
  });

  it('lee el almacén UNA sola vez (no repite el findUnique por añadir el tipo)', async () => {
    const { tx, findUnique } = txCon(usable('PT'));
    await exigirAlmacenDelTipo(tx, 3, 'PT', 7);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('exigirAlmacen — sigue sin mirar el tipo', () => {
  it('acepta cualquier tipo mientras exista, esté activo y sea de la empresa', async () => {
    const { tx } = txCon(usable('TELA'));
    await expect(exigirAlmacen(tx, 3, 7)).resolves.toBeUndefined();
  });

  it('mantiene sus mensajes de siempre (no existe / desactivado / otra empresa)', async () => {
    await expect(exigirAlmacen(txCon(null).tx, 99, 7)).rejects.toThrow(ErrorNoEncontrado);
    await expect(
      exigirAlmacen(txCon({ activo: false, idEmpresa: null, nombre: 'X', tipo: 'PT' }).tx, 3, 7),
    ).rejects.toThrow(/"X" está desactivado/);
    await expect(
      exigirAlmacen(txCon({ activo: true, idEmpresa: 99, nombre: 'Y', tipo: 'PT' }).tx, 3, 7),
    ).rejects.toThrow(/"Y" no es de esta empresa/);
  });
});
