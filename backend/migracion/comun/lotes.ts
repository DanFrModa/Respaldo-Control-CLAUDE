/**
 * Concurrencia ACOTADA para el ETL (F1-E6).
 *
 * Contra la BD remota de `prueba` (Railway, proxy público) cada operación es un round-trip
 * por internet (~1/seg en serie). Para que la carga Y el re-chequeo de idempotencia de
 * miles de filas INDEPENDIENTES (telas-colores 4566, bordados 2964, telas 877, avíos 629,
 * colores ~676) terminen en MINUTOS, se procesan con un POOL de N tareas en vuelo.
 *
 * `enLotes` mantiene siempre hasta `concurrencia` promesas activas (no por "tandas" rígidas,
 * sino reponiendo en cuanto una termina), preserva el ORDEN del resultado y es TOLERANTE: si
 * `fn(item)` lanza, ese item queda como `{ ok: false, error }` y NO tumba al resto (el ETL
 * nunca aborta por una fila — los loaders además envuelven cada fila en `intentarCrear`).
 *
 * SOLO para loaders de filas INDEPENDIENTES. NO usar donde el orden importe o haya estado
 * compartido orden-dependiente (p. ej. la fusión de terceros de proveedores: queda secuencial).
 */

/** Resultado por item: éxito con su valor, o fallo con el error capturado. */
export type ResultadoItem<T> = { ok: true; valor: T } | { ok: false; error: unknown };

/**
 * Procesa `items` con `fn`, manteniendo hasta `concurrencia` ejecuciones en vuelo a la vez.
 * Devuelve un arreglo de resultados en el MISMO orden que `items`. Un `fn` que rechaza no
 * detiene a los demás: su entrada queda `{ ok: false, error }`.
 *
 * @param items        elementos a procesar.
 * @param fn           trabajo async por item (recibe el item y su índice).
 * @param concurrencia máximo de tareas simultáneas (default 8). Se acota a [1, items.length].
 *
 * @example
 * const res = await enLotes(filas, (f) => cargarUna(f), 8);
 * const oks = res.filter((r) => r.ok).length;
 */
export async function enLotes<T, R>(
  items: readonly T[],
  fn: (item: T, indice: number) => Promise<R>,
  concurrencia = 8,
): Promise<ResultadoItem<R>[]> {
  const total = items.length;
  const resultados = new Array<ResultadoItem<R>>(total);
  if (total === 0) {
    return resultados;
  }

  const limite = Math.max(1, Math.min(concurrencia, total));
  let siguiente = 0;

  /** Un worker toma índices del cursor compartido hasta agotarlos. */
  async function worker(): Promise<void> {
    for (;;) {
      const indice = siguiente;
      siguiente += 1;
      if (indice >= total) {
        return;
      }
      const item = items[indice] as T;
      try {
        resultados[indice] = { ok: true, valor: await fn(item, indice) };
      } catch (error) {
        resultados[indice] = { ok: false, error };
      }
    }
  }

  await Promise.all(Array.from({ length: limite }, () => worker()));
  return resultados;
}

/** Concurrencia por defecto del ETL contra BD remota (configurable por loader). */
export const CONCURRENCIA_ETL = 8;
