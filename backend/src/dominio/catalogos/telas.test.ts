import { describe, expect, it, vi } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  crearTela,
  crearTelaCategoria,
  desactivarTela,
  listarTelas,
  listarTelasCategorias,
} from './telas.js';

/**
 * Unit del dominio de Telas (F1-E3) — SIN Postgres. Cubre lo que NO necesita la base: el
 * guard de permisos (deny-by-default, §9.2) y la validación de captura que se rechaza
 * ANTES de tocar la base (Zod dentro de `validarEntrada`: nombre vacío, precio negativo,
 * color repetido en la misma tela). La integridad transaccional real (tela+colores
 * todo-o-nada, unicidad de nombre, idCategoria inexistente/inactiva, diff de precios,
 * borrado suave, categoría en uso) se prueba contra Postgres en `telas.int.test.ts` (CI).
 *
 * Para las rutas que llegan a la base con permiso correcto, se usa un `tx` STUB envuelto
 * en `ContextoBd` (igual que el unit de Bordados): así se verifica la regla sin Postgres.
 */

const sesionAdmin = () => sesionDePrueba({ permisos: ['telas.ver', 'telas.administrar'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['telas.ver'] });
const sesionSinPermisos = () => sesionDePrueba();

describe('dominio Telas — permisos (deny-by-default, §9.2)', () => {
  it('crear tela sin permiso administrar → ErrorPermiso (no toca la base)', async () => {
    await expect(
      crearTela(sesionSoloVer(), { nombre: 'Felpa', unidadMedida: 'KG', colores: [] }, {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('sin ningún permiso no se puede ni listar telas ni categorías', async () => {
    await expect(listarTelas(sesionSinPermisos(), {}, {})).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(listarTelasCategorias(sesionSinPermisos(), {}, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('crear categoría de tela sin permiso administrar → ErrorPermiso', async () => {
    await expect(
      crearTelaCategoria(sesionSoloVer(), { nombre: 'Felpa' }, {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('desactivar tela sin permiso administrar → ErrorPermiso', async () => {
    await expect(desactivarTela(sesionSoloVer(), 1, {})).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('dominio Telas — validación de captura (rechazada antes de tocar la base)', () => {
  // `validarEntrada` corre ANTES de abrir transacción: estas entradas inválidas lanzan
  // ErrorValidacion sin que el `bd` (ausente) se use jamás.
  it('crear tela con nombre vacío → ErrorValidacion', async () => {
    await expect(
      crearTela(sesionAdmin(), { unidadMedida: 'KG', nombre: '   ' }, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear tela con un color repetido en el grid → ErrorValidacion (Zod refine)', async () => {
    await expect(
      crearTela(
        sesionAdmin(),
        {
          nombre: 'Repe',
          unidadMedida: 'KG',
          colores: [
            { idColor: 4, precio: 1 },
            { idColor: 4, precio: 2 },
          ],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear tela con precio de color negativo → ErrorValidacion', async () => {
    await expect(
      crearTela(
        sesionAdmin(),
        { nombre: 'X', unidadMedida: 'KG', colores: [{ idColor: 1, precio: -5 }] },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear categoría con nombre vacío → ErrorValidacion', async () => {
    await expect(crearTelaCategoria(sesionAdmin(), { nombre: '  ' }, {})).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });
});

describe('dominio Telas — colores inexistentes/inactivos (tx stub, sin Postgres)', () => {
  /**
   * Stub mínimo de transacción para un ALTA de tela: nombre libre, sin categoría, y el
   * `color.findMany` devuelve lo que el caso necesite (para simular color inexistente o
   * inactivo). `bd` envuelve el `tx` para que `enTransaccion` lo reutilice (no abre una real).
   */
  function bdParaAlta(colores: { id: number; nombre: string; activo: boolean }[]): {
    bd: ContextoBd;
    telaCreate: ReturnType<typeof vi.fn>;
  } {
    const telaCreate = vi.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 1, ...args.data }),
    );
    const tx = {
      tela: {
        findFirst: vi.fn(() => Promise.resolve(null)), // nombre libre
        create: telaCreate,
        findUniqueOrThrow: vi.fn(() => Promise.resolve({ id: 1, colores: [], categoria: null })),
      },
      color: { findMany: vi.fn(() => Promise.resolve(colores)) },
      telaColor: { findMany: vi.fn(() => Promise.resolve([])), createMany: vi.fn() },
      bitacora: { create: vi.fn(() => Promise.resolve({})) },
    } as unknown as Tx;
    return { bd: { tx }, telaCreate };
  }

  it('rechaza un color inexistente → ErrorValidacion (el findMany no lo devuelve)', async () => {
    // Se piden 2 colores pero la base solo conoce 1 ⇒ "no existen".
    const { bd, telaCreate } = bdParaAlta([{ id: 1, nombre: 'Negro', activo: true }]);
    await expect(
      crearTela(
        sesionAdmin(),
        {
          nombre: 'Con color fantasma',
          unidadMedida: 'KG',
          colores: [{ idColor: 1 }, { idColor: 999 }],
        },
        bd,
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // La tela se creó pero el set de colores falló: en Postgres real la tx revierte todo;
    // aquí basta con verificar que el error se lanzó (la atomicidad la cubre el int test).
    expect(telaCreate).toHaveBeenCalledTimes(1);
  });

  it('rechaza un color DESACTIVADO → ErrorValidacion', async () => {
    const { bd } = bdParaAlta([{ id: 1, nombre: 'Negro', activo: false }]);
    await expect(
      crearTela(
        sesionAdmin(),
        { nombre: 'Con color inactivo', unidadMedida: 'KG', colores: [{ idColor: 1 }] },
        bd,
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
