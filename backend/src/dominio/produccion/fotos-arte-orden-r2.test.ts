/**
 * ⭐⭐ 0.081(a) — **LA PUERTA A R2 QUE NACIÓ DESPUÉS Y SE QUEDÓ SIN GUARDIÁN.**
 *
 * `quitarFotoArteOrden` borra un objeto de Cloudflare R2. Es una puerta más, con la MISMA invariante
 * estrella que las siete de la 0.081(a): **el borrado del objeto corre DESPUÉS del commit, nunca
 * dentro de la transacción**. Pero nació con la 0.083 (§Post-F9.177), o sea *después* de que se
 * repartieran aquellos guardianes, y se quedó fuera del reparto.
 *
 * 🔴 **Y por qué eso importa de verdad, medido:** el guardián de hard-delete de la fila 0.091
 * (`comun/archivos-huerfanos.test.ts`) **no cubre esto**. Se comprobó reintroduciendo la fuga
 * gemela en `receta-orden.ts`: el guardián de hard-delete siguió **en verde**, y quien la mató fue
 * la prueba de commit. Una puerta a R2 sin esta prueba no está protegida por nada.
 *
 * ⚠️ **Medido antes de escribir una línea: la puerta YA LIBERA CORRECTAMENTE.** `quitarFotoArteOrden`
 * cierra su `enTransaccion` y sólo entonces llama a `eliminarObjetosBestEffort` — no hay defecto que
 * arreglar aquí, sólo un guardián que faltaba. Lo que esta prueba impide es la REGRESIÓN: mover esa
 * llamada dentro de la transacción hoy no rompería ninguna prueba.
 *
 * ⚠️ **Y por qué no basta con la prueba que ya existe.** `fotos-arte-orden.test.ts` cubre esta puerta
 * con `bd = { tx }`, y ahí `enTransaccion` toma el atajo `fn(bd.tx)`: **no hay commit que observar**,
 * así que esa prueba no puede distinguir «antes» de «después» de un commit que nunca ocurre. Ésta
 * pasa por `cliente.$transaction` de verdad y fotografía el bucket justo en el punto de commit.
 *
 * ⚠️ Los cuatro `adjuntos-*` siguen FUERA a propósito: ésos son la deuda que la 0.081(a) aparcó
 * explícitamente, y no se tocan aquí.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ServicioArchivos } from '../../comun/archivos.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { exigirBorradoTrasElCommit } from '../../pruebas/commit-r2.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { quitarFotoArteOrden } from './fotos-arte-orden.js';

const ID_ORDEN = 1;
const ID_RENGLON = 10;
const ID_FOTO = 900;
const KEY = 'orden-arte/arch-1.jpg';

const sesionAdmin = (): ReturnType<typeof sesionDePrueba> =>
  sesionDePrueba({ permisos: ['ordenes.ver', 'desarrollo.ver', 'desarrollo.administrar'] });

/**
 * Doble de `ServicioArchivos` en el que SOLO `eliminarObjeto` es legal.
 *
 * ⚠️ El tipo sale de la INTERFAZ (`ServicioArchivos['eliminarObjeto']`), nunca de un
 * `() => Promise<void>` a mano: con una firma sin argumentos `vi.fn` infiere `mock.calls` como
 * `[][]` y ninguna aserción podría comprobar QUÉ key se borró — y borrar la key equivocada (la foto
 * de otra OP) es el peor fallo posible de esta familia.
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

/** Lo mínimo que recorre `quitarFotoArteOrden`: el renglón, su foto propia, el borrado y el rastro. */
function bdParaQuitarFoto() {
  const archivoDelete = vi.fn(() => Promise.resolve({}));
  const bitacoraCreate = vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve(args));
  const tx = {
    ordenArte: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          id: ID_RENGLON,
          idModeloArte: 500,
          orden: { estado: 'capturada' },
        }),
      ),
    },
    ordenArteFoto: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          idArchivo: 'arch-1',
          archivo: { key: KEY, nombreOriginal: 'arch-1.jpg' },
        }),
      ),
    },
    archivo: { delete: archivoDelete },
    bitacora: { create: bitacoraCreate },
  } as unknown as Tx;
  return { bd: { tx } as ContextoBd, tx, archivoDelete, bitacoraCreate };
}

describe('quitarFotoArteOrden — el objeto de R2 y el commit (0.081a)', () => {
  it('🔴🔴 GUARDIÁN: el objeto se borra DESPUÉS del commit, jamás dentro de la transacción', async () => {
    // Si esto fallara: `DeleteObject` no participa de la transacción, así que un rollback del
    // llamador dejaría el objeto BORRADO y su fila `Archivo` VIVA — el huérfano al revés, y peor
    // que el que la fila vino a arreglar, porque el registro apunta a la nada y el archivo ya no
    // se puede recuperar.
    const { tx } = bdParaQuitarFoto();

    await exigirBorradoTrasElCommit(tx, [KEY], (bd, eliminarObjeto) =>
      quitarFotoArteOrden(
        sesionAdmin(),
        ID_ORDEN,
        ID_RENGLON,
        ID_FOTO,
        bd,
        archivosFalsos(eliminarObjeto),
      ),
    );
  });

  it('🔴 BEST-EFFORT: si R2 falla, la operación NO revierte lo que la base ya cerró', async () => {
    // La otra mitad de la invariante: el registro ya está borrado y comiteado. Reventar aquí no
    // desharía nada —la transacción cerró— y sólo le devolvería un 500 a quien sí logró su cambio;
    // el objeto huérfano se anota en el log y se vive con él.
    const { bd, archivoDelete } = bdParaQuitarFoto();
    const eliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() =>
      Promise.reject(new Error('R2 caído')),
    );
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await expect(
        quitarFotoArteOrden(
          sesionAdmin(),
          ID_ORDEN,
          ID_RENGLON,
          ID_FOTO,
          bd,
          archivosFalsos(eliminarObjeto),
        ),
      ).resolves.toBeUndefined();

      expect(archivoDelete).toHaveBeenCalledWith({ where: { id: 'arch-1' } });
      // Y NO se traga el problema en silencio: el objeto que quedó pagándose deja rastro con su key.
      expect(avisos).toHaveBeenCalled();
      expect(JSON.stringify(avisos.mock.calls)).toContain(KEY);
    } finally {
      avisos.mockRestore();
    }
  });
});
