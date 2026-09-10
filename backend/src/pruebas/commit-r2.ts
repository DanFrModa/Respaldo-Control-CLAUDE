/**
 * Guardián de la invariante estrella de la fila 0.081(a): **el borrado del objeto de R2 corre
 * DESPUÉS del commit, nunca dentro de la transacción.**
 *
 * ## Por qué hace falta un helper y no basta con el stub de siempre
 *
 * Las pruebas de dominio arman su contexto como `bd = { tx: stub }`, y con eso
 * `enTransaccion` (ver `comun/transaccion.ts`) toma el atajo `return fn(bd.tx)`: se une a la
 * transacción del llamador y **no abre ninguna**. Es decir: en ese montaje **NO EXISTE EL COMMIT**,
 * así que una prueba con `bd.tx` no puede distinguir «antes» de «después» de un commit que nunca
 * ocurre. Mover la llamada a `eliminarObjetosBestEffort` DENTRO de la transacción —la violación
 * literal que documenta `dominio/produccion/adjuntos-orden.ts`— deja las pruebas de stub
 * **enteras en verde**. Son verdes por la razón equivocada.
 *
 * Este helper cierra ese agujero pasando `bd = { cliente }` con un `$transaction` FALSO que sí
 * tiene un punto de commit observable: ejecuta la función de la transacción y, justo donde
 * Postgres commitearía, **fotografía si el bucket ya se tocó**.
 *
 * ## Por qué la invariante importa tanto como para tener guardián propio
 *
 * `DeleteObject` no participa de la transacción: si se ejecuta antes del commit y el llamador
 * revierte después, el objeto queda **borrado** y su fila `Archivo` **viva** — el huérfano al
 * revés, y peor que el que la fila vino a arreglar, porque el registro apunta a la nada y no hay
 * forma de recuperar el archivo. Hoy la garantía se sostiene sólo porque ninguna ruta pasa `bd`;
 * pero `bd?: ContextoBd` es público y **nada impide** que un llamador futuro se componga con su
 * propia `tx`. Sin este guardián, esa regresión no rompería ninguna prueba.
 */
import { expect, vi, type Mock } from 'vitest';

import type { ServicioArchivos } from '../comun/archivos.js';
import type { ContextoBd, Tx } from '../comun/transaccion.js';
import type { PrismaClient } from '../datos/index.js';

/** Espía de `eliminarObjeto` tipado desde la INTERFAZ (así `mock.calls` conserva la key). */
export type EspiaEliminarObjeto = Mock<ServicioArchivos['eliminarObjeto']>;

/**
 * Comprueba que `ejecutar` borra del bucket EXACTAMENTE `keysEsperadas` y que **ninguna** de esas
 * llamadas ocurrió antes del commit.
 *
 * Hace TRES aserciones, y las tres son necesarias:
 *
 *  1. **Hubo commit.** Prueba que la operación pasó de verdad por `cliente.$transaction` y no por
 *     el atajo `bd.tx`. Sin esto, el propio guardián se podría neutralizar en silencio con sólo
 *     pasarle un contexto equivocado: mediría un commit inexistente y aprobaría cualquier cosa.
 *  2. **El bucket no se tocó antes del commit.** La invariante.
 *  3. **Se borraron las keys esperadas.** Impide que el guardián pase VACUAMENTE: sin esto, un
 *     código que no borrara nada del bucket cumpliría (1) y (2) de calle y el guardián lo bendeciría.
 *
 * @param tx stub de transacción del módulo (el mismo que usan sus otras pruebas).
 * @param keysEsperadas keys de R2 que la operación debe borrar, EN ORDEN.
 * @param ejecutar invoca la función de dominio con el `bd` y el servicio de archivos que se le dan.
 */
export async function exigirBorradoTrasElCommit(
  tx: Tx,
  keysEsperadas: readonly string[],
  ejecutar: (bd: ContextoBd, eliminarObjeto: EspiaEliminarObjeto) => Promise<unknown>,
): Promise<void> {
  const eliminarObjeto: EspiaEliminarObjeto = vi.fn<ServicioArchivos['eliminarObjeto']>(() =>
    Promise.resolve(),
  );

  let commits = 0;
  let tocadoAntesDelCommit = false;

  // El cliente falso HEREDA la superficie del stub (`...tx`) además de traer `$transaction`:
  // algunas funciones leen fuera de la transacción con `clienteLectura(bd)`, que sin `bd.tx`
  // devuelve `bd.cliente` — y ese cliente tiene que saber responder `archivo.findUnique` igual
  // que el stub. Sin esto, el guardián reventaría con un TypeError en vez de medir la invariante.
  const cliente = {
    ...(tx as object),
    $transaction: async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
      const resultado = await fn(tx);
      // ── Aquí es donde Postgres haría COMMIT ────────────────────────────────────────────────
      // Todo lo que el bucket haya sufrido HASTA este punto ocurrió dentro de la transacción.
      if (eliminarObjeto.mock.calls.length > 0) {
        tocadoAntesDelCommit = true;
      }
      commits += 1;
      return resultado;
    },
  } as unknown as PrismaClient;

  await ejecutar({ cliente }, eliminarObjeto);

  expect(
    commits,
    'la operación no abrió transacción propia: el guardián no midió ningún commit (¿se le pasó un bd con `tx`?)',
  ).toBeGreaterThan(0);
  expect(
    tocadoAntesDelCommit,
    'se borró el objeto de R2 DENTRO de la transacción: un rollback dejaría el objeto borrado y su fila viva',
  ).toBe(false);
  expect(eliminarObjeto.mock.calls.map((llamada) => llamada[0])).toEqual([...keysEsperadas]);
}
