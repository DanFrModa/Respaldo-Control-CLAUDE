import { z } from 'zod';

/**
 * Esquema de SALIDA de roles (Administración, F1-E1 PIEZA C). SOLO lectura:
 * alimenta el selector de rol al crear/editar usuarios. La administración fina
 * de roles y permisos NO entra en esta etapa (queda para una fase posterior).
 *
 * Proyecta el `RolDto` del dominio `dominio/admin/roles` a JSON. Los roles son
 * pocos (9 de sistema + los que se creen), así que el listado es un arreglo
 * simple (sin paginación), igual que el servicio de dominio.
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
