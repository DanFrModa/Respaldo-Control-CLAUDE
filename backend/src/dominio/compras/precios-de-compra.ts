/**
 * ⭐ QUIÉN VE LOS PRECIOS DE COMPRA (fila 0.249 parte D).
 *
 * Los precios de COMPRA —el renglón de la orden de compra, el precio con que la explosión asigna un
 * proveedor al material de una orden, el precio con que se recibió— no tenían hasta hoy una regla
 * con nombre porque sus pantallas ya estaban cerradas por la llave de la pantalla misma
 * (`compras.ver` para leer órdenes de compra y explosión; `compras.administrar` para asignar el
 * proveedor de compra). La bitácora guarda esos mismos precios, y la lectura de la bitácora los tapa
 * con ESTA regla para no abrir por ahí lo que esas pantallas cierran.
 *
 *  • `compras.ver` — lee las órdenes de compra (precio e importe de cada renglón) y la explosión
 *    (precio sugerido de cada material). Ver la nota en `prisma/seed.ts` (llaves de dinero).
 *  • `compras.administrar` — quien **teclea** el precio de compra (arma la OC, asigna el proveedor
 *    de compra del material de una orden). Quien escribe, lee.
 *  • `compras.recibir` (SÓLO la recepción) — quien recibe captura las cantidades y, si el proveedor
 *    mandó otro precio, lo corrige; la pantalla le precarga el de la OC. Quien escribe, lee.
 */
import type { ClavePermiso } from '../../contrato/index.js';

import { tienePermiso, type SesionUsuario } from '../../comun/permisos.js';

/** Llaves que dejan ver los precios de COMPRA (cualquiera basta). Ver el encabezado. */
export const LLAVES_PRECIO_COMPRA: readonly ClavePermiso[] = ['compras.ver', 'compras.administrar'];

/** Llaves que dejan ver los precios de una RECEPCIÓN de compra: las de compra + quien recibe. */
export const LLAVES_PRECIO_RECEPCION: readonly ClavePermiso[] = [
  ...LLAVES_PRECIO_COMPRA,
  'compras.recibir',
];

/** ¿La sesión ve los precios de compra? Ver {@link LLAVES_PRECIO_COMPRA}. */
export function puedeVerPreciosDeCompra(sesion: SesionUsuario): boolean {
  return LLAVES_PRECIO_COMPRA.some((clave) => tienePermiso(sesion, clave));
}

/** ¿La sesión ve los precios de una recepción de compra? Ver {@link LLAVES_PRECIO_RECEPCION}. */
export function puedeVerPreciosDeRecepcion(sesion: SesionUsuario): boolean {
  return LLAVES_PRECIO_RECEPCION.some((clave) => tienePermiso(sesion, clave));
}
