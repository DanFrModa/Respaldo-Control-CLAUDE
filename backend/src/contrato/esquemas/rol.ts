import { z } from 'zod';

/**
 * Esquemas de Roles y del catálogo de permisos (Administración, RBAC A4). Cubre
 * la administración COMPLETA de roles: salida (lista + detalle), cuerpos de
 * alta/edición/asignación de permisos y el catálogo de permisos agrupado por
 * módulo que alimenta el árbol de la pantalla.
 *
 * Proyecta el `RolDto` del dominio `dominio/admin/roles` a JSON. Los roles son
 * pocos (9 de sistema + los que se creen), así que el listado es un arreglo
 * simple (sin paginación), igual que el servicio de dominio.
 *
 * La validación FINA de las claves de permiso (que existan en el catálogo
 * tipado, A4) la hace el DOMINIO; aquí los cuerpos solo exigen la FORMA
 * (`string[]`), sin duplicar el catálogo.
 */
export const esquemaRolSalida = z
  .object({
    id: z.number().int().describe('Id del rol.'),
    nombre: z.string().describe('Nombre del rol.'),
    descripcion: z.string().describe('Descripción del rol.'),
    esSistema: z
      .boolean()
      .describe('Verdadero si es un rol de sistema (sembrado; no se renombra ni se borra).'),
    clavesPermisos: z
      .array(z.string())
      .describe('Claves de permiso (`modulo.accion`) que otorga el rol.'),
    totalUsuarios: z.number().int().describe('Cuántos usuarios tienen este rol.'),
  })
  .describe('Rol del sistema con sus permisos (RBAC A4).');

/** Forma de un rol tal como lo devuelve la API. */
export type RolSalida = z.infer<typeof esquemaRolSalida>;

/**
 * Cuerpo de alta de un rol (`POST /api/roles`). Misma forma de captura que el
 * dominio (`esquemaCrearRol`): nombre 1..60, descripción ≤200 (default vacío) y
 * el set inicial de permisos. Las claves se validan contra el catálogo en el
 * dominio (no aquí).
 */
export const esquemaCrearRolBody = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, 'El nombre del rol es obligatorio.')
      .max(60)
      .describe('Nombre del rol (único, 1..60).'),
    descripcion: z
      .string()
      .trim()
      .max(200)
      .default('')
      .describe('Descripción del rol (≤200; opcional).'),
    clavesPermisos: z
      .array(z.string())
      .default([])
      .describe('Claves de permiso (`modulo.accion`) que otorga el rol al crearse.'),
  })
  .describe('Alta de un rol con su conjunto inicial de permisos.');

/** Cuerpo de alta de rol. */
export type CrearRolBody = z.input<typeof esquemaCrearRolBody>;

/**
 * Cuerpo de edición de un rol (`PATCH /api/roles/{id}`): nombre y/o descripción.
 * Requiere al menos un cambio. Un rol de sistema NO se renombra (lo rechaza el
 * dominio); su descripción sí es editable.
 */
export const esquemaActualizarRolBody = z
  .object({
    nombre: z.string().trim().min(1).max(60).optional().describe('Nuevo nombre del rol.'),
    descripcion: z.string().trim().max(200).optional().describe('Nueva descripción del rol.'),
  })
  .refine((cambios) => Object.values(cambios).some((valor) => valor !== undefined), {
    message: 'No hay ningún cambio que guardar.',
  })
  .describe('Edición del nombre y/o la descripción de un rol.');

/** Cuerpo de edición de rol. */
export type ActualizarRolBody = z.input<typeof esquemaActualizarRolBody>;

/**
 * Cuerpo de asignación de permisos (`PUT /api/roles/{id}/permisos`). Semántica de
 * REEMPLAZO: el conjunto enviado sustituye por completo a los permisos del rol.
 */
export const esquemaAsignarPermisosBody = z
  .object({
    clavesPermisos: z
      .array(z.string())
      .describe('Conjunto COMPLETO de claves de permiso que queda en el rol (reemplazo total).'),
  })
  .describe('Reemplaza el conjunto de permisos de un rol.');

/** Cuerpo de asignación de permisos. */
export type AsignarPermisosBody = z.infer<typeof esquemaAsignarPermisosBody>;

/** Un permiso del catálogo tipado (código, A4) tal como lo expone el API. */
export const esquemaPermisoCatalogoSalida = z
  .object({
    clave: z.string().describe('Clave estable del permiso (`modulo.accion`).'),
    descripcion: z.string().describe('Descripción clara del permiso (para la UI).'),
    modulo: z.string().describe('Clave del módulo funcional al que pertenece.'),
    apagado: z
      .boolean()
      .describe(
        'true si su módulo está APAGADO en esta versión (V1-E3t): la sesión lo descarta, así que otorgarlo no surte efecto.',
      ),
  })
  .describe('Un permiso del catálogo.');

/** Forma de un permiso del catálogo. */
export type PermisoCatalogoSalida = z.infer<typeof esquemaPermisoCatalogoSalida>;

/** Un módulo con sus permisos (grupo del árbol de la pantalla de roles). */
export const esquemaModuloPermisosSalida = z
  .object({
    modulo: z.string().describe('Clave del módulo funcional.'),
    etiqueta: z.string().describe('Etiqueta del módulo para la UI.'),
    permisos: z.array(esquemaPermisoCatalogoSalida).describe('Permisos que agrupa el módulo.'),
  })
  .describe('Un módulo funcional con los permisos que agrupa.');

/** Forma de un grupo (módulo) del catálogo. */
export type ModuloPermisosSalida = z.infer<typeof esquemaModuloPermisosSalida>;

/** Catálogo de permisos agrupado por módulo (`GET /api/permisos`). */
export const esquemaCatalogoPermisosSalida = z
  .array(esquemaModuloPermisosSalida)
  .describe('Catálogo tipado de permisos (A4) agrupado por módulo, para el árbol de roles.');

/** Forma del catálogo de permisos agrupado. */
export type CatalogoPermisosSalida = z.infer<typeof esquemaCatalogoPermisosSalida>;
