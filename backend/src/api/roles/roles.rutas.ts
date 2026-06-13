/**
 * Rutas REST de Roles — SOLO LECTURA (Administración, F1-E1 PIEZA C). Alimentan
 * el selector de rol al crear/editar usuarios. La administración fina de roles y
 * permisos (alta, edición, asignación de permisos) NO entra en esta etapa.
 *
 * Calca el ESTÁNDAR de ruta: valida (Zod compartido), autoriza
 * (`app.conPermiso`) y delega al dominio `dominio/admin/roles`.
 *
 * ⚠️ El dominio `listarRoles`/`obtenerRol` verifica `roles.administrar`; por la
 * regla de "el guard de la ruta usa la MISMA clave que el dominio", estas rutas
 * se protegen con `roles.administrar` (no con `usuarios.ver`, que no existe). En
 * el seed, quien administra usuarios (Administrador / AdministracionDireccion)
 * también tiene `roles.administrar`, así que el selector de rol funciona.
 *
 * Los roles son pocos: el listado es un arreglo (sin paginación), como el dominio.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi, esquemaRolSalida } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { listarRoles, obtenerRol, type RolDto } from '../../dominio/admin/roles.js';

/** Proyecta el `RolDto` del dominio a la forma JSON del contrato. */
function aRolSalida(rol: RolDto): z.infer<typeof esquemaRolSalida> {
  return {
    id: rol.id,
    nombre: rol.nombre,
    descripcion: rol.descripcion,
    esSistema: rol.esSistema,
    clavesPermisos: rol.clavesPermisos,
    totalUsuarios: rol.totalUsuarios,
  };
}

/** Parámetro de ruta `:id` del rol (entero positivo). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del rol debe ser un número' })
    .int({ error: 'El id del rol debe ser entero' })
    .positive({ error: 'El id del rol debe ser positivo' })
    .describe('Id del rol.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de roles (montadas bajo `/api`). */
export const rutasRoles: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Listar TODOS (para el selector de rol; sin paginación) ─────────────────
  app.route({
    method: 'GET',
    url: '/roles',
    preHandler: app.conPermiso('roles.administrar'),
    schema: {
      tags: ['roles'],
      summary: 'Listar roles',
      security: SEGURIDAD_SESION,
      response: { 200: z.array(esquemaRolSalida), ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const roles = await listarRoles(sesion);
      return roles.map(aRolSalida);
    },
  });

  // ── Obtener uno ────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/roles/:id',
    preHandler: app.conPermiso('roles.administrar'),
    schema: {
      tags: ['roles'],
      summary: 'Obtener un rol',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaRolSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aRolSalida(await obtenerRol(sesion, request.params.id));
    },
  });

  done();
};
