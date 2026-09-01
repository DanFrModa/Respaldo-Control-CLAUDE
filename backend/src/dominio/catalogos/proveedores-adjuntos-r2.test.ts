import { describe, expect, it, vi } from 'vitest';

import type { ServicioArchivos } from '../../comun/archivos.js';
import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { exigirBorradoTrasElCommit } from '../../pruebas/commit-r2.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { quitarAdjuntoProveedor } from './proveedores.js';

/**
 * ⭐ 0.081(a) — **QUITAR UN ADJUNTO DEL PROVEEDOR TIENE QUE BORRARLO TAMBIÉN DE R2** (R15 §4).
 * Antes se borraba la fila y el documento se quedaba en el bucket, invisible y facturándose. Se
 * prueba en positivo (se llama a `eliminarObjeto` con la key, tras el commit), en negativo (si la
 * tx aborta NO se toca el bucket) y el modo best-effort con su aviso.
 */

const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['proveedores.ver', 'proveedores.administrar'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['proveedores.ver'] });

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

/** Stub de la transacción de `quitarAdjuntoProveedor`. */
function bdParaQuitarAdjunto(existe: boolean) {
  const archivoDelete = vi.fn(() => Promise.resolve({}));
  const tx = {
    proveedorArchivo: {
      findFirst: vi.fn(() =>
        Promise.resolve(
          existe
            ? {
                idArchivo: 'arch1',
                archivo: {
                  key: 'proveedores/4/uuid/constancia.pdf',
                  nombreOriginal: 'constancia.pdf',
                },
              }
            : null,
        ),
      ),
    },
    archivo: { delete: archivoDelete },
    bitacora: { create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args)) },
  } as unknown as Tx;
  return { bd: { tx } as ContextoBd, tx, archivoDelete };
}

describe('quitarAdjuntoProveedor — el objeto de R2 se va con el registro (0.081a)', () => {
  it('⭐ borra el registro y llama eliminarObjeto con la key del objeto', async () => {
    const { bd, archivoDelete } = bdParaQuitarAdjunto(true);
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await quitarAdjuntoProveedor(sesionAdmin(), 4, 'arch1', bd, archivosFalsos(eliminarObjeto));

    expect(archivoDelete).toHaveBeenCalledTimes(1);
    expect(eliminarObjeto).toHaveBeenCalledWith('proveedores/4/uuid/constancia.pdf');
  });

  it('🔴🔴 GUARDIÁN: el objeto se borra DESPUÉS del commit, jamás dentro de la transacción', async () => {
    // Las demás pruebas de este archivo corren con `bd = { tx }`, y ahí `enTransaccion` toma el
    // atajo `fn(bd.tx)`: NO HAY COMMIT que observar, así que no pueden ver esta invariante. Ésta
    // pasa por `cliente.$transaction` de verdad y mira el bucket justo en el punto de commit.
    const { tx } = bdParaQuitarAdjunto(true);

    await exigirBorradoTrasElCommit(
      tx,
      ['proveedores/4/uuid/constancia.pdf'],
      (bd, eliminarObjeto) =>
        quitarAdjuntoProveedor(sesionAdmin(), 4, 'arch1', bd, archivosFalsos(eliminarObjeto)),
    );
  });

  it('🔴 en NEGATIVO: si el adjunto no es de ese proveedor, la tx aborta y NO se toca el bucket', async () => {
    const { bd, archivoDelete } = bdParaQuitarAdjunto(false);
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await expect(
      quitarAdjuntoProveedor(sesionAdmin(), 4, 'arch1', bd, archivosFalsos(eliminarObjeto)),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);

    expect(archivoDelete).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('🔴 en NEGATIVO: sin permiso no se borra nada, ni en la base ni en R2', async () => {
    const { bd, archivoDelete } = bdParaQuitarAdjunto(true);
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() => Promise.resolve());

    await expect(
      quitarAdjuntoProveedor(sesionSoloVer(), 4, 'arch1', bd, archivosFalsos(eliminarObjeto)),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    expect(archivoDelete).not.toHaveBeenCalled();
    expect(eliminarObjeto).not.toHaveBeenCalled();
  });

  it('best-effort: si R2 falla NO revienta, pero AVISA (nunca en silencio)', async () => {
    const { bd, archivoDelete } = bdParaQuitarAdjunto(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      quitarAdjuntoProveedor(
        sesionAdmin(),
        4,
        'arch1',
        bd,
        archivosFalsos(() => Promise.reject(new Error('R2 caído'))),
      ),
    ).resolves.toBeUndefined();

    expect(archivoDelete).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
