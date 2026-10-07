/**
 * ⭐ QUIÉN VE LOS PRECIOS DE LOS CATÁLOGOS DE MATERIALES (fila 0.249 parte B, §Post-F9.257(c)).
 *
 * `telas.ver` y `avios.ver` son llaves de VOCABULARIO —el nombre de la tela, su composición, sus
 * colores, la clave del avío, quién lo surte— y el dueño quiere que algún día entren al piso de
 * lectura. Pero sus respuestas traían además **el precio**: el sugerido de la tela y de su
 * complemento, el de cada color, el de cada proveedor (y por color), el de referencia del avío, el
 * de cada proveedor del avío y el de cada medida. *«Lo que sea dinero no debe estar en el piso»*.
 *
 * Aquí vive la regla que decide quién los recibe. **No hay llave nueva**: se combinan llaves que ya
 * existen, cada una por una razón medida —
 *
 *  • `consultas.ver-importes` — la llave de DINERO de los precios (acceso #2 del sistema viejo:
 *    *«Ver Importes Totales y Precios»*). Es la que ya tapa los importes del PRECOSTO, que se
 *    calculan **con estos mismos precios**: quien no puede ver el costo de la receta tampoco debe
 *    poder reconstruirlo leyendo el catálogo renglón por renglón.
 *  • `telas.administrar` / `avios.administrar` — quien **teclea** el precio en el catálogo. Mismo
 *    criterio que la parte A con `proveedores.administrar`: darle la lectura a alguien más sería
 *    abrir, no tapar; quitársela a quien la escribe sería dejarlo capturando a ciegas.
 *  • `compras.administrar` — quien **compra con él**. Escribe precios de color de tela desde la
 *    explosión (`compras/color-de-la-tela.ts` `fijarPrecioDeColor`, y el alta de color
 *    `agregarColorATela`), y la captura de la OC **precarga** el precio del avío desde su proveedor
 *    (`EditorLineasOc.tsx` → `avios.proveedores[].precio`). La OC ya enseña precios a quien la
 *    arma; quitarle el del catálogo sólo lo haría teclear de memoria.
 *  • `proveedores.administrar` (sólo avíos) — asigna el avío al proveedor **con su precio**
 *    (`catalogos/proveedores.ts` `asignarAvioProveedor`, la vista «Avíos que surte»).

 *  • `modelos.administrar` — quien **arma la receta** (Gestión Técnica, Desarrollo). En el editor del
 *    BOM elige el AMARRE proveedor–tela/avío por su precio, y esos mismos precios ya los ve en el
 *    BOM del modelo (`precioCosteo`, con `modelos.ver`). Taparle el selector la haría elegir a ciegas
 *    sin proteger nada (decisión del lead en la revisión de la parte B).
 *
 * 🔑 **La invariante que hace que ningún formulario pise un precio:** toda llave que ESCRIBE un
 * precio de estos catálogos DESDE UN FORMULARIO está en su lista de lectura (las copias que hace el
 * propio servidor —p. ej. `fusionarColores`, que mueve precios al fusionar— no pasan por un
 * formulario y no cuentan). La fija `precios-de-catalogo.test.ts`: si
 * mañana alguien abre una escritura con otra llave sin sumarla aquí, ese formulario partiría de un
 * precio en blanco y lo mandaría vacío al guardar.
 *
 * ⚠️ El frontend NO repite esta regla: reacciona a lo que llega (`preciosOcultos: true` en cada
 * objeto que trae precio ⇒ pinta «—» y no manda el campo al guardar). Si la regla cambia aquí, la
 * pantalla la sigue sola.
 */
import type { ClavePermiso } from '../../contrato/index.js';

import { tienePermiso, type SesionUsuario } from '../../comun/permisos.js';

/** Llaves que dejan ver los precios del catálogo de TELAS (cualquiera basta). Ver el encabezado. */
export const LLAVES_PRECIO_TELA: readonly ClavePermiso[] = [
  'consultas.ver-importes',
  'telas.administrar',
  'compras.administrar',
  'modelos.administrar',
];

/** Llaves que dejan ver los precios del catálogo de AVÍOS (cualquiera basta). Ver el encabezado. */
export const LLAVES_PRECIO_AVIO: readonly ClavePermiso[] = [
  'consultas.ver-importes',
  'avios.administrar',
  'compras.administrar',
  'proveedores.administrar',
  'modelos.administrar',
];

/** ¿La sesión recibe los precios del catálogo de telas? Ver {@link LLAVES_PRECIO_TELA}. */
export function puedeVerPreciosDeTela(sesion: SesionUsuario): boolean {
  return LLAVES_PRECIO_TELA.some((clave) => tienePermiso(sesion, clave));
}

/** ¿La sesión recibe los precios del catálogo de avíos? Ver {@link LLAVES_PRECIO_AVIO}. */
export function puedeVerPreciosDeAvio(sesion: SesionUsuario): boolean {
  return LLAVES_PRECIO_AVIO.some((clave) => tienePermiso(sesion, clave));
}
