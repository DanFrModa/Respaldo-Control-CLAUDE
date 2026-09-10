import type { ClavePermiso } from '@/api/tipos';

/**
 * ⭐⭐ **LA PUERTA A LOS FACTORES DE PRECIO** — V1-E8t (§Post-F9.145). Daniel, 29-ago-2026, al
 * toparse con *"Este cliente/departamento no tiene factores de precio capturados… los captura el
 * DUEÑO desde la ficha del cliente"* **siendo él el dueño**:
 *
 * > *«estaría bueno desde ahí poder acceder al botón donde necesito llenar los datos»*
 *
 * Este archivo es el ÚNICO lugar donde se decide **quién ve esa puerta** y **a dónde lleva**. Lo
 * importan los tres que participan: el aviso que la pinta (`DialogoCrearLista`), la pantalla que la
 * recibe (`ClientesPagina`) y el editor del destino (`EditorFactoresCliente`).
 *
 * 🔴 **Por qué en una sola función y no "una condición parecida" en cada lado:** una puerta que se
 * pinta con un criterio y un destino que se abre con otro es una puerta a un 403 — el usuario
 * aterriza en una pantalla donde no está lo que le prometieron. Ya hubo guardas gemelas que se
 * desincronizaron en la primera corrección (§Post-F9.125 arregló justo eso con los factores). Si
 * mañana el permiso cambia, cambia aquí o no cambia.
 */

/**
 * ¿Este usuario **VE** los cuatro factores (margen · descuentos · regalías · costo de ventas)?
 *
 * Gemela de `puedeVerFactoresDePrecio` del backend (`dominio/desarrollo/cliente-factores.ts`), que
 * exige `listas.aprobar` — el permiso del DUEÑO (§Post-F9.125: *"los factores sólo yo los puedo
 * mover y no son visibles para nadie más"*). Aquí se pide ADEMÁS `listas.ver` porque la pantalla no
 * sólo decide: **consulta** `GET /api/clientes/:id/factores`, que exige `listas.ver`. Pedir menos
 * que lo que el endpoint exige es prometer una sección que carga en error.
 */
export function puedeVerFactoresDePrecio(tienePermiso: (clave: ClavePermiso) => boolean): boolean {
  return tienePermiso('listas.ver') && tienePermiso('listas.aprobar');
}

/**
 * ¿Se le pinta a este usuario la puerta **«Capturar factores»**?
 *
 * ⚠️ **La puerta se mide por el DESTINO, no por las ganas.** Cruzarla es: abrir la ficha del
 * cliente (el listado exige `clientes.ver`) y capturar ahí sus factores (`listas.aprobar`, que
 * valida el servidor al guardar). Sin los tres permisos el botón sería una promesa que termina en
 * un error o en una sección que ni siquiera se pinta — y §Post-F9.96 es explícito: mandar a alguien
 * a una pantalla que no puede usar es peor que no mandarlo. A quien no la tiene se le dice **a
 * quién pedírselo** (el dueño), que es lo único accionable que le queda.
 */
export function puedeCapturarFactoresDePrecio(
  tienePermiso: (clave: ClavePermiso) => boolean,
): boolean {
  return puedeVerFactoresDePrecio(tienePermiso) && tienePermiso('clientes.ver');
}

/** Ruta de la ficha del cliente: el destino EXACTO de la puerta (no el hub de catálogos). */
export const RUTA_FICHA_CLIENTE = '/catalogos/clientes';

/**
 * Estado de navegación del deep-link a la ficha de UN cliente, en su sección de factores.
 * Mismo patrón que el deep-link de Modelos (`state.idModelo`, §Post-F9.140): el ESCRITOR y el
 * LECTOR ({@link leerDeepLinkFactores}) viven juntos para que el nombre de la llave no se pueda
 * teclear distinto en cada punta.
 */
export function estadoDeepLinkFactores(idCliente: number): {
  idCliente: number;
  seccion: 'factores';
} {
  return { idCliente, seccion: 'factores' };
}

/**
 * Lee DEFENSIVAMENTE el deep-link del `state` de navegación. Devuelve el id del cliente a abrir
 * (entero positivo) o `null` si no viene, no es válido o no pide la sección de factores: sin
 * deep-link la pantalla se comporta exactamente como siempre.
 */
export function leerDeepLinkFactores(state: unknown): number | null {
  if (typeof state !== 'object' || state === null) {
    return null;
  }
  if (!('idCliente' in state) || !('seccion' in state) || state.seccion !== 'factores') {
    return null;
  }
  const id = state.idCliente;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}
