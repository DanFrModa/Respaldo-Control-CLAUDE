import { describe, expect, it, vi } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  crearTela,
  crearTelaCategoria,
  crearTelaMigracion,
  desactivarTela,
  listarTelas,
  listarTelasCategorias,
} from './telas.js';

/**
 * Unit del dominio de Telas (F1-E3) — SIN Postgres. Cubre lo que NO necesita la base: el
 * guard de permisos (deny-by-default, §9.2) y la validación de captura que se rechaza
 * ANTES de tocar la base (Zod dentro de `validarEntrada`: nombre vacío, precio negativo,
 * NOMBRE de color repetido en la misma tela — §Post-F9.11: los colores son HIJOS de la
 * tela, no catálogo global). La integridad transaccional real (tela+colores todo-o-nada,
 * unicidad de nombre, idCategoria inexistente/inactiva, diff por nombre, borrado suave,
 * categoría en uso) se prueba contra Postgres en `telas.int.test.ts` (CI).
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
      crearTela(
        sesionSoloVer(),
        { nombre: 'Felpa', unidadMedida: 'KG', idProveedor: 1, colores: [] },
        {},
      ),
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
      crearTela(sesionAdmin(), { unidadMedida: 'KG', nombre: '   ', idProveedor: 1 }, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear tela con NOMBRE de color repetido (aun cambiando mayúsculas) → ErrorValidacion', async () => {
    await expect(
      crearTela(
        sesionAdmin(),
        {
          nombre: 'Repe',
          unidadMedida: 'KG',
          idProveedor: 1,
          colores: [
            { nombre: 'Negro', precio: 1 },
            { nombre: 'NEGRO', precio: 2 },
          ],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear tela con precio de color negativo o nombre de color vacío → ErrorValidacion', async () => {
    await expect(
      crearTela(
        sesionAdmin(),
        {
          nombre: 'X',
          unidadMedida: 'KG',
          idProveedor: 1,
          colores: [{ nombre: 'Negro', precio: -5 }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    await expect(
      crearTela(
        sesionAdmin(),
        { nombre: 'X', unidadMedida: 'KG', idProveedor: 1, colores: [{ nombre: '   ' }] },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear tela SIN proveedor → ErrorValidacion (el contrato lo exige, §Post-F9.11)', async () => {
    await expect(
      // El TIPO estricto ya lo caza (H8); se fuerza para probar el rechazo en runtime.
      crearTela(
        sesionAdmin(),
        { nombre: 'Sin dueño', unidadMedida: 'KG', colores: [] } as never,
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

describe('dominio Telas — invariantes con tx stub (sin Postgres)', () => {
  /**
   * Stub mínimo de transacción para un ALTA de tela: nombre libre, sin categoría, proveedor
   * activo. `bd` envuelve el `tx` para que `enTransaccion` lo reutilice (no abre una real).
   */
  function bdParaAlta(): { bd: ContextoBd; telaCreate: ReturnType<typeof vi.fn> } {
    const telaCreate = vi.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 1, nombreComplemento: null, ...args.data }),
    );
    const tx = {
      tela: {
        findFirst: vi.fn(() => Promise.resolve(null)), // nombre libre
        create: telaCreate,
        findUniqueOrThrow: vi.fn(() =>
          Promise.resolve({
            id: 1,
            colores: [],
            categoria: null,
            composicion: null,
            proveedor: null,
          }),
        ),
      },
      proveedor: {
        findUnique: vi.fn(() => Promise.resolve({ nombre: 'Alsatex', activo: true })),
      },
      telaColor: { findMany: vi.fn(() => Promise.resolve([])), createMany: vi.fn() },
      bitacora: { create: vi.fn(() => Promise.resolve({})) },
    } as unknown as Tx;
    return { bd: { tx }, telaCreate };
  }

  // H2 (invariante A1): el precio del complemento SOLO existe si la tela lo lleva.
  it('rechaza precio de complemento en el ALTA si la tela NO lleva complemento', async () => {
    const { bd, telaCreate } = bdParaAlta();
    await expect(
      crearTela(
        sesionAdmin(),
        {
          nombre: 'Lisa',
          unidadMedida: 'KG',
          idProveedor: 7,
          colores: [{ nombre: 'Negro', precioComplemento: 55 }],
        },
        bd,
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // El rechazo es ANTES de crear nada (la coherencia se valida primero).
    expect(telaCreate).not.toHaveBeenCalled();
  });

  it('con el complemento DECLARADO, el precio del complemento sí pasa', async () => {
    const { bd, telaCreate } = bdParaAlta();
    await expect(
      crearTela(
        sesionAdmin(),
        {
          nombre: 'Felpa',
          unidadMedida: 'KG',
          idProveedor: 7,
          nombreComplemento: 'Cardigan',
          colores: [{ nombre: 'Negro', precioComplemento: 55 }],
        },
        bd,
      ),
    ).resolves.toBeTruthy();
    expect(telaCreate).toHaveBeenCalledTimes(1);
  });

  it('el modo MIGRACIÓN (`crearTelaMigracion`) permite omitir el proveedor (ETL)', async () => {
    const { bd, telaCreate } = bdParaAlta();
    await expect(
      crearTelaMigracion(
        sesionAdmin(),
        { nombre: 'FelpaAlsa100', unidadMedida: 'KG', colores: [] },
        bd,
      ),
    ).resolves.toBeTruthy();
    expect(telaCreate).toHaveBeenCalledTimes(1);
  });
});
