import { describe, expect, it, vi } from 'vitest';

import type { ServicioArchivos } from '../../comun/archivos.js';
import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { exigirBorradoTrasElCommit } from '../../pruebas/commit-r2.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { quitarFoto } from './fotos-modelo.js';

/**
 * ⭐ 0.081(a) — **QUITAR UNA FOTO TIENE QUE BORRARLA TAMBIÉN DE R2.** Antes, `quitarFoto` borraba
 * el registro `Archivo` y dejaba el OBJETO en el bucket: nadie podía verlo ni encontrarlo, y se
 * seguía pagando para siempre. Aquí se prueba el contrato completo del arreglo, SIN Postgres:
 *
 *  • **en positivo**: se llama a `eliminarObjeto` con la key del objeto, DESPUÉS del commit;
 *  • **en negativo**: si la foto no existe (la tx aborta) NO se toca el bucket — el modo de fallo
 *    realista es dejar el camino viejo debajo y borrar de R2 cosas que la base no borró;
 *  • **best-effort**: si R2 falla, la operación NO revienta (el usuario ya vio irse su foto) pero
 *    SÍ deja rastro en el log. Un fallo silencioso aquí sería el mismo defecto con otra cara.
 */

const sesionAdmin = () => sesionDePrueba({ permisos: ['modelos.ver', 'modelos.administrar'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['modelos.ver'] });

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

/** Stub de la transacción de `quitarFoto`: la foto existe (o no) y se espía el borrado. */
function bdParaQuitarFoto(opciones: { foto: { idArchivo: string } | null; key?: string | null }) {
  const archivoDelete = vi.fn(() => Promise.resolve({}));
  const tx = {
    modeloFoto: {
      findFirst: vi.fn(() =>
        Promise.resolve(opciones.foto === null ? null : { id: 5, ...opciones.foto }),
      ),
    },
    archivo: {
      findUnique: vi.fn(() =>
        Promise.resolve(opciones.key === undefined ? { key: 'modelos/7/uuid/frente.jpg' } : null),
      ),
      delete: archivoDelete,
    },
    modelo: { update: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)) },
    bitacora: { create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)) },
  } as unknown as Tx;
  return { bd: { tx } as ContextoBd, tx, archivoDelete };
}

describe('quitarFoto — el objeto de R2 se va con el registro (0.081a)', () => {
  it('⭐ borra el registro y llama eliminarObjeto con la key del objeto', async () => {
    const { bd, archivoDelete } = bdParaQuitarFoto({ foto: { idArchivo: 'arch1' } });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await quitarFoto(sesionAdmin(), 7, 5, bd, archivosFalsos(eliminarObjeto));

    expect(archivoDelete).toHaveBeenCalledTimes(1);
    expect(eliminarObjeto).toHaveBeenCalledWith('modelos/7/uuid/frente.jpg');
  });

  it('🔴🔴 GUARDIÁN: el objeto se borra DESPUÉS del commit, jamás dentro de la transacción', async () => {
    // Las demás pruebas de este archivo corren con `bd = { tx }`, y ahí `enTransaccion` toma el
    // atajo `fn(bd.tx)`: NO HAY COMMIT que observar, así que no pueden ver esta invariante. Ésta
    // pasa por `cliente.$transaction` de verdad y mira el bucket justo en el punto de commit.
    const { tx } = bdParaQuitarFoto({ foto: { idArchivo: 'arch1' } });

    await exigirBorradoTrasElCommit(tx, ['modelos/7/uuid/frente.jpg'], (bd, eliminarObjeto) =>
      quitarFoto(sesionAdmin(), 7, 5, bd, archivosFalsos(eliminarObjeto)),
    );
  });

  it('🔴 en NEGATIVO: si la foto no existe, la tx aborta y NO se toca el bucket', async () => {
    const { bd, archivoDelete } = bdParaQuitarFoto({ foto: null });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await expect(
      quitarFoto(sesionAdmin(), 7, 5, bd, archivosFalsos(eliminarObjeto)),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);

    expect(archivoDelete).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('🔴 en NEGATIVO: sin permiso no se borra nada, ni en la base ni en R2', async () => {
    const { bd, archivoDelete } = bdParaQuitarFoto({ foto: { idArchivo: 'arch1' } });
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await expect(
      quitarFoto(sesionSoloVer(), 7, 5, bd, archivosFalsos(eliminarObjeto)),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    expect(archivoDelete).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('best-effort: si R2 falla NO revierte el borrado, pero AVISA (nunca en silencio)', async () => {
    const { bd, archivoDelete } = bdParaQuitarFoto({ foto: { idArchivo: 'arch1' } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      quitarFoto(
        sesionAdmin(),
        7,
        5,
        bd,
        archivosFalsos(() => Promise.reject(new Error('R2 caído'))),
      ),
    ).resolves.toBeUndefined();

    expect(archivoDelete).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
