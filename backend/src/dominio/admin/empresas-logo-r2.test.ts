import { describe, expect, it, vi } from 'vitest';

import type { ServicioArchivos } from '../../comun/archivos.js';
import { ErrorConflicto, ErrorPermiso } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { exigirBorradoTrasElCommit } from '../../pruebas/commit-r2.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { confirmarLogo, quitarLogo } from './empresas.js';

/**
 * ⭐ 0.081(a) — **EL LOGO DE LA EMPRESA TAMBIÉN DEJABA HUÉRFANOS, y en DOS sitios.** Ninguno de los
 * dos estaba en la lista original de la fila; salieron de enumerar todos los `archivo.delete*` del
 * backend:
 *
 *  1. `quitarLogo` — borra el `Archivo` y el PNG se quedaba en el bucket.
 *  2. `confirmarLogo` — al REEMPLAZAR el logo borra el anterior (`deleteMany`), y ése también se
 *     quedaba. Es el más fácil de acumular: cada vez que alguien prueba un logo nuevo, el viejo se
 *     queda pagándose.
 *
 * Se prueba en positivo, en negativo (los caminos que NO borran fila no pueden tocar el bucket) y
 * el best-effort con aviso. Los logos son JPG en los stubs para saltarse la inspección del PNG,
 * que baja bytes de R2 y no es lo que se está probando (ver `exigirPngImprimible`).
 */

const sesionAdmin = () => sesionDePrueba({ permisos: ['empresas.administrar'] });
const sesionSinNada = () => sesionDePrueba({ permisos: [] });

const KEY_VIEJO = 'empresas/logos/3/viejo/logo.png';
const KEY_NUEVO = 'empresas/logos/3/nuevo/logo.png';

/**
 * Doble de `ServicioArchivos` en el que SOLO `eliminarObjeto` es legal: lo demás no debe llamarse.
 *
 * ⚠️ El tipo sale de la INTERFAZ (`ServicioArchivos['eliminarObjeto']`), NUNCA de un
 * `() => Promise<void>` escrito a mano. Con una firma sin argumentos, `vi.fn` infiere `mock.calls`
 * como `[][]` y ninguna prueba puede comprobar QUÉ key se borró, sólo cuántas veces — y borrar el
 * objeto EQUIVOCADO (la foto de otro modelo) es el peor fallo posible de esta fila.
 */
function archivosFalsos(eliminarObjeto: ServicioArchivos['eliminarObjeto']): ServicioArchivos {
  const prohibido = (): never => {
    throw new Error('no debe llamarse');
  };
  return {
    solicitarSubida: prohibido,
    subirContenido: prohibido,
    urlDescarga: () => Promise.reject(new Error('no debe llamarse')),
    descargarContenido: () => Promise.reject(new Error('no debe llamarse')),
    eliminarObjeto,
  };
}

/**
 * Stub de la transacción del logo. `archivo.findUnique` responde POR ID: el `Archivo` nuevo y el
 * anterior son distintos, y `confirmarLogo` los pide los dos (el nuevo para validarlo, el anterior
 * para saber qué objeto borrar).
 */
function bdParaLogo(opciones: { idArchivoLogo: string | null; borrados?: number }) {
  const archivoDeleteMany = vi.fn(() => Promise.resolve({ count: opciones.borrados ?? 1 }));
  const porId: Record<string, { key: string; nombreOriginal: string; tipoMime: string }> = {
    arch_viejo: { key: KEY_VIEJO, nombreOriginal: 'viejo.jpg', tipoMime: 'image/jpeg' },
    arch_nuevo: { key: KEY_NUEVO, nombreOriginal: 'nuevo.jpg', tipoMime: 'image/jpeg' },
  };
  const tx = {
    empresa: {
      findUnique: vi.fn(() =>
        Promise.resolve({ id: 3, nombre: 'FR Moda', idArchivoLogo: opciones.idArchivoLogo }),
      ),
      update: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)),
    },
    archivo: {
      findUnique: vi.fn((args: { where: { id: string } }) =>
        Promise.resolve(porId[args.where.id] ?? null),
      ),
      deleteMany: archivoDeleteMany,
    },
    bitacora: { create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)) },
  } as unknown as Tx;
  return { bd: { tx } as ContextoBd, tx, archivoDeleteMany };
}

describe('quitarLogo — el PNG se va del bucket con el registro (0.081a)', () => {
  it('⭐ borra el registro y llama eliminarObjeto con la key del logo', async () => {
    const { bd, archivoDeleteMany } = bdParaLogo({ idArchivoLogo: 'arch_viejo' });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await quitarLogo(sesionAdmin(), 3, bd, archivosFalsos(eliminarObjeto));

    expect(archivoDeleteMany).toHaveBeenCalledTimes(1);
    expect(eliminarObjeto).toHaveBeenCalledWith(KEY_VIEJO);
  });

  it('🔴🔴 GUARDIÁN: el objeto se borra DESPUÉS del commit, jamás dentro de la transacción', async () => {
    // Las demás pruebas de este archivo corren con `bd = { tx }`, y ahí `enTransaccion` toma el
    // atajo `fn(bd.tx)`: NO HAY COMMIT que observar, así que no pueden ver esta invariante. Ésta
    // pasa por `cliente.$transaction` de verdad y mira el bucket justo en el punto de commit.
    const { tx } = bdParaLogo({ idArchivoLogo: 'arch_viejo' });

    await exigirBorradoTrasElCommit(tx, [KEY_VIEJO], (bd, eliminarObjeto) =>
      quitarLogo(sesionAdmin(), 3, bd, archivosFalsos(eliminarObjeto)),
    );
  });

  it('🔴 en NEGATIVO: si la empresa no tenía logo, la tx aborta y NO se toca el bucket', async () => {
    const { bd, archivoDeleteMany } = bdParaLogo({ idArchivoLogo: null });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await expect(
      quitarLogo(sesionAdmin(), 3, bd, archivosFalsos(eliminarObjeto)),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    expect(archivoDeleteMany).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('🔴 en NEGATIVO: si otra petición se le adelantó (count 0), NO se borra el objeto', async () => {
    // La carrera que `deleteMany` ya cubría: dos "quitar" en paralelo. El segundo no borró fila,
    // así que tampoco puede borrar el objeto — lo está manejando el primero.
    const { bd } = bdParaLogo({ idArchivoLogo: 'arch_viejo', borrados: 0 });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await expect(
      quitarLogo(sesionAdmin(), 3, bd, archivosFalsos(eliminarObjeto)),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('🔴 en NEGATIVO: sin permiso no se borra nada, ni en la base ni en R2', async () => {
    const { bd, archivoDeleteMany } = bdParaLogo({ idArchivoLogo: 'arch_viejo' });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await expect(
      quitarLogo(sesionSinNada(), 3, bd, archivosFalsos(eliminarObjeto)),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    expect(archivoDeleteMany).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('🔴 en NEGATIVO: si el registro del logo ya no está, NO se inventa una key que borrar', async () => {
    // `idArchivoLogo` apunta a una fila que no existe: no hay key que borrar y el bucket no se
    // toca. Lo que esta prueba impide es que el camino devuelva un valor de relleno.
    const { bd } = bdParaLogo({ idArchivoLogo: 'arch_fantasma' });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await quitarLogo(sesionAdmin(), 3, bd, archivosFalsos(eliminarObjeto));

    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('best-effort: si R2 falla NO revienta, pero AVISA (nunca en silencio)', async () => {
    const { bd, archivoDeleteMany } = bdParaLogo({ idArchivoLogo: 'arch_viejo' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      quitarLogo(
        sesionAdmin(),
        3,
        bd,
        archivosFalsos(() => Promise.reject(new Error('R2 caído'))),
      ),
    ).resolves.toBeUndefined();

    expect(archivoDeleteMany).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('confirmarLogo — reemplazar el logo se lleva el ANTERIOR del bucket (0.081a)', () => {
  it('⭐ al REEMPLAZAR borra de R2 el logo viejo (no el nuevo, que acaba de subir)', async () => {
    const { bd, archivoDeleteMany } = bdParaLogo({ idArchivoLogo: 'arch_viejo' });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await confirmarLogo(sesionAdmin(), 3, 'arch_nuevo', bd, archivosFalsos(eliminarObjeto));

    expect(archivoDeleteMany).toHaveBeenCalledTimes(1);
    expect(eliminarObjeto).toHaveBeenCalledTimes(1);
    expect(eliminarObjeto).toHaveBeenCalledWith(KEY_VIEJO);
  });

  it('🔴🔴 GUARDIÁN: el objeto se borra DESPUÉS del commit, jamás dentro de la transacción', async () => {
    // Las demás pruebas de este archivo corren con `bd = { tx }`, y ahí `enTransaccion` toma el
    // atajo `fn(bd.tx)`: NO HAY COMMIT que observar, así que no pueden ver esta invariante. Ésta
    // pasa por `cliente.$transaction` de verdad y mira el bucket justo en el punto de commit.
    const { tx } = bdParaLogo({ idArchivoLogo: 'arch_viejo' });

    await exigirBorradoTrasElCommit(tx, [KEY_VIEJO], (bd, eliminarObjeto) =>
      confirmarLogo(sesionAdmin(), 3, 'arch_nuevo', bd, archivosFalsos(eliminarObjeto)),
    );
  });

  it('🔴 en NEGATIVO: la PRIMERA subida (no había logo) no borra nada del bucket', async () => {
    const { bd, archivoDeleteMany } = bdParaLogo({ idArchivoLogo: null });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await confirmarLogo(sesionAdmin(), 3, 'arch_nuevo', bd, archivosFalsos(eliminarObjeto));

    expect(archivoDeleteMany).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('🔴🔴 en NEGATIVO: confirmar DOS VECES el mismo archivo es idempotente y NO borra el objeto', async () => {
    // Si el borrado físico no respetara el corte idempotente, la segunda confirmación borraría de
    // R2 el logo que la empresa está usando AHORA, dejando la fila viva apuntando a la nada.
    const { bd, archivoDeleteMany } = bdParaLogo({ idArchivoLogo: 'arch_nuevo' });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await confirmarLogo(sesionAdmin(), 3, 'arch_nuevo', bd, archivosFalsos(eliminarObjeto));

    expect(archivoDeleteMany).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('🔴 en NEGATIVO: si otra confirmación borró antes el viejo (count 0), NO se toca el objeto', async () => {
    const { bd } = bdParaLogo({ idArchivoLogo: 'arch_viejo', borrados: 0 });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await confirmarLogo(sesionAdmin(), 3, 'arch_nuevo', bd, archivosFalsos(eliminarObjeto));

    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('🔴 en NEGATIVO: si el registro del logo viejo ya no está, NO se inventa una key', async () => {
    const { bd } = bdParaLogo({ idArchivoLogo: 'arch_fantasma' });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await confirmarLogo(sesionAdmin(), 3, 'arch_nuevo', bd, archivosFalsos(eliminarObjeto));

    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('best-effort: si R2 falla al borrar el viejo, el logo nuevo QUEDA confirmado', async () => {
    const { bd, archivoDeleteMany } = bdParaLogo({ idArchivoLogo: 'arch_viejo' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      confirmarLogo(
        sesionAdmin(),
        3,
        'arch_nuevo',
        bd,
        archivosFalsos(() => Promise.reject(new Error('R2 caído'))),
      ),
    ).resolves.toBeUndefined();

    expect(archivoDeleteMany).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
