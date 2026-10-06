/** Existencia de un avío en UN almacén (la dimensión de existencia de avíos es avío×almacén, R4). */
export interface ExistenciaAvioEnAlmacen {
  existencia: number;
  unidad: string | null;
}

/**
 * Lo que una pantalla sabe del stock del almacén del que SALE el avío: existencia por avío.
 *
 * `undefined` significa **«no se sabe»** —no hay almacén elegido, o su consulta no ha vuelto, o
 * falló— y es una tercera posibilidad que importa: no es lo mismo que «hay cero». Ver
 * {@link hayStockDeAvio}.
 */
export type StockDeAvios = ReadonlyMap<number, { existencia: number }> | undefined;

/**
 * ⭐⭐ FILAS 0.216 / 0.233 — ¿SE PUEDE SACAR ESTE AVÍO DEL ALMACÉN?
 *
 * Nace del repaso de Inventarios de DANIEL (§Post-F9.243, punto 07c), sobre la nota de salida:
 *
 * > *«Al traer los avíos de la OP… **como me jala avíos que no hay stock, no me deja**. Estaría bien
 * > que no deje meter los avíos que no hay stock, ANTES de meterlos. Porque ahorita valida DESPUÉS
 * > de haberlos metido en la nota de salida.»*
 *
 * La fila 0.216 lo arregló en la nota de salida; la 0.233 lo lleva a las otras tres pantallas que
 * SACAN avíos (salida sin orden, ajuste de SALIDA y traspaso, desde su almacén ORIGEN), que
 * comparten `CapturaRenglonesAvio`.
 *
 * ⚠️ **Esto NO sustituye la guarda del servidor** (A1): el no-negativo del avío lo sigue validando
 * el dominio al guardar, bajo bloqueo y por suma de movimientos. Lo único que hace esta función es
 * que la captura **no llegue hasta ahí**.
 *
 * 🔑 **Sin stock CONOCIDO devuelve `true`, y es deliberado.** Un avío que NO aparece en el mapa
 * cuenta como cero —la vista de existencias sólo tiene renglón donde hubo movimientos, y la
 * consulta pide `incluirCeros`, así que «no está» es «nunca entró aquí»—, pero si el mapa entero es
 * `undefined` no se sabe nada y bloquear sería inventar un cero: se deja pasar y decide el servidor.
 *
 * Función PURA (A1).
 */
export function hayStockDeAvio(stock: StockDeAvios, idAvio: number): boolean {
  if (stock === undefined) {
    return true;
  }
  return (stock.get(idAvio)?.existencia ?? 0) > 0;
}
