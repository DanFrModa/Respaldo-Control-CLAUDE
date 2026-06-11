import type { paths } from './esquema.gen';

/**
 * Alias utiles extraidos del contrato generado (`esquema.gen.ts`). Centralizar
 * aqui los tipos que la UI consume evita repetir el camino
 * `paths['...']['get']['responses'][200][...]` por todos lados y da un nombre
 * de dominio a cada forma.
 */

/** Respuesta de `GET /api/sesion`: usuario + empresa activa + permisos. */
export type Sesion = paths['/api/sesion']['get']['responses']['200']['content']['application/json'];

/**
 * Clave de permiso efectiva (union de literales del contrato). Es la MISMA
 * identidad de permiso que el backend (catalogo unico, A4): un permiso que no
 * existe en el contrato es error de compilacion al filtrar el menu.
 */
export type ClavePermiso = Sesion['permisos'][number];

/** Pagina de almacenes (`GET /api/almacenes`). */
export type AlmacenesPagina =
  paths['/api/almacenes']['get']['responses']['200']['content']['application/json'];

/** Un almacen tal como lo devuelve el API. */
export type Almacen = AlmacenesPagina['datos'][number];

/** Parametros de consulta del listado de almacenes (querystring). */
export type AlmacenesQuery = NonNullable<paths['/api/almacenes']['get']['parameters']['query']>;

/** Cuerpo de alta de almacen (`POST /api/almacenes`). */
export type AlmacenCrear =
  paths['/api/almacenes']['post']['requestBody']['content']['application/json'];

/** Cuerpo de edicion de almacen (`PATCH /api/almacenes/{id}`). */
export type AlmacenEditar =
  paths['/api/almacenes/{id}']['patch']['requestBody']['content']['application/json'];
