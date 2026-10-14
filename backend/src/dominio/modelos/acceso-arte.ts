/**
 * QUIÉN PUEDE TOCAR EL ARTE: la reja de `modelos.arte` (fila 0.235).
 *
 * Daniel describió a Diseño Gráfico (§Post-F9.247(c) de `DECISIONES.md`): *«desarrolla todos los
 * artes, define quién es el proveedor y cotiza cuánto cuesta cada uno»*. Hasta la 0.235 esa línea no
 * se podía trazar:
 *  • el arte del MODELO (`arte-modelo.ts`) exigía `modelos.administrar`, que abre además la ficha,
 *    las telas, los avíos y las fotos de cualquier modelo;
 *  • las fotos de arte de la ORDEN (`produccion/fotos-arte-orden.ts`) exigían `desarrollo.administrar`,
 *    que abre además el alta y la edición de proyectos de desarrollo y la receta entera de la orden.
 * ⇒ no había llave que dijera «sólo el arte». Daniel aceptó a sabiendas darle las dos completas
 * mientras se construía ésta (§Post-F9.250(b)); quitárselas sigue siendo decisión suya.
 *
 * Desde la 0.235 el reparto queda así:
 *  • **Arte del modelo** (alta, edición —descripción, posición, tipo, puntadas, PRECIO, proveedor—,
 *    quitar, marcar principal, copiar de otro modelo, subir y quitar sus fotos) → `modelos.arte`
 *    **o** `modelos.administrar`, que la implica: quien administra el modelo entero obviamente puede
 *    tocar su arte, y nadie que ya lo hacía lo pierde.
 *  • **Fotos de arte de la orden** (ocultar/mostrar una heredada, subir y quitar una propia) →
 *    `modelos.arte` **o** `desarrollo.administrar`, la llave de la receta de la orden que las
 *    gobernaba (todo lo que hoy pasa con ella sigue pasando). ⚠️ **NO `modelos.administrar`**: esa
 *    llave nunca tocó la orden, y dejarla pasar aquí abriría la OP a Gestión Técnica sin que nadie
 *    lo decidiera.
 *
 * ⚠️ La inversa NO vale y es la razón de la fila: `modelos.arte` no edita la ficha, las telas, los
 * avíos ni las fotos del modelo, no copia la receta entera (`copiarBom` también trae telas y avíos) y
 * no toca el arte CONGELADO de la orden (`OrdenArte`: su descripción, precio y proveedor se editan en
 * la receta de la orden con `desarrollo.administrar`, `produccion/receta-orden.ts`).
 *
 * Mismo molde que `catalogos/acceso-clientes.ts` (`exigirModificarCliente`, fila 0.239). Aquí no hay
 * negocio: sólo el permiso.
 */
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';

/**
 * Exige poder EDITAR el arte del modelo. Pasa con `modelos.arte` **o** con `modelos.administrar`.
 * Sigue siendo deny-by-default (A4): sin ninguna, 403 nombrando `modelos.arte`, que es la llave que
 * hay que dar.
 */
export function exigirEditarArteModelo(sesion: SesionUsuario): void {
  if (tienePermiso(sesion, 'modelos.administrar')) {
    return;
  }
  verificarPermiso(sesion, 'modelos.arte');
}

/**
 * Exige poder EDITAR las fotos de arte de una orden. Pasa con `modelos.arte` **o** con
 * `desarrollo.administrar` (NO con `modelos.administrar`, ver la cabecera). Sin ninguna, 403
 * nombrando `modelos.arte`.
 */
export function exigirEditarFotosArteOrden(sesion: SesionUsuario): void {
  if (tienePermiso(sesion, 'desarrollo.administrar')) {
    return;
  }
  verificarPermiso(sesion, 'modelos.arte');
}
