import type { ClavePermiso } from '@/api/tipos';

/**
 * ⭐⭐ **LA PUERTA AL CATÁLOGO DE TIPOS DE PRODUCTO** — V1-E8t, ronda de corrección (§Post-F9.145).
 *
 * 🔴 **Nace de un hallazgo del reviewer que duele, porque la razón que yo había escrito para NO
 * construir esta puerta era FALSA — y falsa justo para Daniel.** La ficha declaraba que a este aviso
 * *"no se le construye puerta porque quien lo ve no administra el catálogo de Calidad"*. Medido
 * corriendo `definirRoles()`:
 *
 * ```
 * ROL                       desarrollo.administrar   calidad.ver   calidad.administrar-catalogo
 * Administrador (= Daniel)  ✔                        ✔             ✔     ⇒ SÍ puede cruzar
 * AdministracionDireccion   ✔                        ✔             ✔     ⇒ SÍ puede cruzar
 * Directivo / Gerencial / Ventas  ✔                  ✔             ✘     ⇒ no
 * ```
 *
 * ⇒ **2 de 9 roles SÍ pueden arreglarlo, y el de Daniel es uno.** Él abre «Agregar modelo», ve
 * *«sin dígito, no se puede numerar»*, **puede componerlo él mismo** y tenía que ir a buscar la
 * pantalla a mano: **letra por letra el encargo que originó esta etapa**, declarado como resuelto.
 *
 * ⚖️ **Y la invariante que lo obliga es la que yo mismo escribí** en §Post-F9.145(c) —*la puerta se
 * pinta sólo a quien puede cruzarla*—: **su recíproco es que a quien PUEDE cruzarla, se le pinta.**
 * Una regla que sólo se aplica en su dirección restrictiva no es una regla, es una excusa.
 *
 * Cruzar exige los **dos** permisos, y por eso los pide los dos: `calidad.ver` para entrar a la
 * pantalla (así la declara el catálogo del menú) y `calidad.administrar-catalogo` para que ahí haya
 * algo que apretar (lo exigen el `POST`/`PATCH` del backend y `TiposProductoPagina`, que llama a
 * ESTA función para decidir sus acciones: la puerta y su destino no pueden medir distinto).
 */

/** Ruta del catálogo de Tipos de producto: el destino exacto, no el hub de Calidad. */
export const RUTA_TIPOS_PRODUCTO = '/calidad/tipos-producto';

/** ¿Este usuario puede ENTRAR al catálogo de tipos de producto y capturar ahí el dígito? */
export function puedeAdministrarTiposProducto(
  tienePermiso: (clave: ClavePermiso) => boolean,
): boolean {
  return tienePermiso('calidad.ver') && tienePermiso('calidad.administrar-catalogo');
}
