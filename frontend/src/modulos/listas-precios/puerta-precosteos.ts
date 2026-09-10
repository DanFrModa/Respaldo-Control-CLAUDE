import type { ClavePermiso } from '@/api/tipos';

/**
 * ⭐ **LA PUERTA A PRE-COSTEOS** — V1-E8t (§Post-F9.145). El aviso *"…captúralos en Pre-costeos y
 * congela la versión"* aparece en TRES lugares del flujo de listas (el diálogo de crear lista con y
 * sin descartados, y el vacío de la pantalla de Listas de precios). Los tres mandan al MISMO sitio,
 * así que el destino y su permiso se deciden aquí, una vez.
 *
 * ⚠️ **Y aquí se MIDE, que es lo que faltaba.** La puerta que V1-E8f estrenó en `SinCandidatos` se
 * pintaba sin preguntar si quien la ve puede cruzarla: `/desarrollo` está declarada en el catálogo del
 * menú con `desarrollo.ver`, y este botón lo pinta un aviso que se sirve con `listas.ver`. Dos
 * permisos distintos, uno pintando la puerta del otro.
 *
 * 🔴 **HONESTIDAD SOBRE LO QUE ESTO ARREGLA HOY — medido, no supuesto** (29-ago-2026, corriendo
 * `definirRoles()` del seed): **ningún rol sembrado** tiene `listas.ver` sin `desarrollo.ver` — a
 * los dos los llevan exactamente los mismos perfiles, todos menos `Basico`. O sea que **hoy nadie se topa con la promesa
 * rota**, y decir lo contrario sería la clase de afirmación que este proyecto ya se ha quemado por
 * escribir sin ejecutar. Se mide igual, y por la razón de la casa: **los roles son DATOS editables y
 * el permiso es granular** — un rol a la medida con `listas.ver` y sin `desarrollo.ver` se crea desde
 * la pantalla de roles, sin tocar código, y ese día el botón manda a un muro. *Un defecto conocido no
 * es "menor" porque el seed de hoy no lo alcance.*
 */

/** Ruta de Pre-costeos (Desarrollo › Proyectos): el destino exacto, no el hub del módulo. */
export const RUTA_PRECOSTEOS = '/desarrollo';

/** ¿Se le pinta a este usuario la puerta «Ir a Pre-costeos»? */
export function puedeIrAPrecosteos(tienePermiso: (clave: ClavePermiso) => boolean): boolean {
  return tienePermiso('desarrollo.ver');
}
