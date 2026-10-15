/**
 * ⭐ Fila 0.147 — el candado de la FILA del pedido, en su propio módulo porque lo toman puertas de
 * DOS dominios (pedidos y producción): vivir en `pedidos.ts` obligaría a `produccion/ordenes.ts` a
 * importar el módulo de pedidos, que ya importa de producción (ciclo).
 *
 * 🔑 ORDEN DE CANDADOS (para que no haya ciclos): este candado va SIEMPRE ANTES de los de producción
 * —los advisory del modelo por color y del nº de producción (`nomenclatura.ts`), la secuencia de
 * folios, y el del cierre/etapas de cada orden—. Por eso `salidaAProduccion` lo toma al ABRIR su
 * transacción, antes de resolver el modelo: si lo tomara después (dentro de `crearOrden`), una salida
 * manual quedaría «serie → pedido» frente al importador «pedido → serie», y dos de ellas sobre el
 * mismo pedido podrían bloquearse mutuamente. El único candado que va antes es el advisory POR
 * CLIENTE de los importadores.
 */
import type { Tx } from '../../comun/transaccion.js';

/**
 * ⭐ Fila 0.147 — BLOQUEA la fila del pedido hasta el final de la transacción (`FOR NO KEY UPDATE`)
 * y la devuelve, o `null` si no existe en la empresa activa (A9: el pedido de otra empresa, para esta
 * sesión, no existe).
 *
 * Lo toman las puertas que pueden pisarse sobre un pedido VIVO: `cancelarPedido` y TODAS las que le
 * hacen nacer una OP —el importador de PDF cuando AÑADE una tanda a un pedido existente, la salida a
 * producción manual («Generar OP», `salidaAProduccion`) y la captura directa (`crearOrden`, vía
 * `resolverOrigenPedido`)—. Sin él, una cancelación que leyó «sus OPs vivas»
 * justo antes de que el importador colgara las nuevas las dejaría vivas debajo de un pedido cancelado
 * (la cascada no las vería); y un import que leyó «no cancelado» antes del commit de la cancelación
 * colgaría OPs de un pedido que ya no se produce. Con el candado, la segunda en llegar espera a la
 * primera y RE-LEE lo que ésta dejó.
 *
 * `NO KEY UPDATE` y no `UPDATE`, a propósito: no choca con el `KEY SHARE` que toma cualquier INSERT de
 * un renglón que apunte a este pedido (la FK), así que no serializa de más; sí choca consigo mismo y
 * con el `UPDATE` del encabezado, que es justo lo que hay que ordenar.
 */
export async function bloquearPedido(
  tx: Tx,
  id: number,
  idEmpresa: number,
): Promise<{ id: number; folio: bigint; idCliente: number } | null> {
  const filas = await tx.$queryRaw<{ id: number; folio: bigint; id_cliente: number }[]>`
    SELECT "id", "folio", "id_cliente" FROM "pedidos"
    WHERE "id" = ${id} AND "id_empresa" = ${idEmpresa}
    FOR NO KEY UPDATE`;
  const fila = filas[0];
  return fila === undefined ? null : { id: fila.id, folio: fila.folio, idCliente: fila.id_cliente };
}
