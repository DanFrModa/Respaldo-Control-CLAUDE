/**
 * Rutas REST de Roles y del catálogo de permisos (Administración, RBAC A4).
 * Cubre la administración COMPLETA de roles: lectura (lista + detalle para el
 * selector de usuarios) y mutación (alta, edición, asignación de permisos con
 * semántica de REEMPLAZO, y borrado), más el catálogo de permisos agrupado por
 * módulo que alimenta el árbol de la pantalla.
 *
 * Calca el ESTÁNDAR de ruta: valida (Zod compartido), autoriza
 * (`app.conPermiso`) y delega al dominio `dominio/admin/roles` — CERO lógica de
 * negocio aquí; el dominio reaplica el permiso, valida contra el catálogo
 * tipado, abre transacción, protege los roles de sistema y audita (A7).
 *
 * ⚠️ TODAS las rutas se protegen con `roles.administrar`: es la MISMA clave que
 * verifica el dominio (regla "el guard de la ruta usa la clave del dominio").
 * En el seed, quien administra usuarios también tiene `roles.administrar`, así
 * que el selector de rol del alta de usuarios sigue funcionando.
 *
 * Los roles son pocos: el listado es un arreglo (sin paginación), como el dominio.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaActualizarRolBody,
  esquemaAsignarPermisosBody,
  esquemaCatalogoPermisosSalida,
  esquemaCrearRolBody,
  esquemaErrorApi,
  esquemaRolSalida,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarRol,
  asignarPermisos,
  crearRol,
  eliminarRol,
  listarRoles,
  obtenerRol,
  type RolDto,
} from '../../dominio/admin/roles.js';
import { listarCatalogoPermisos } from '../../dominio/admin/permisos.js';

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

  // ── Crear (alta con su set inicial de permisos) ────────────────────────────
  app.route({
    method: 'POST',
    url: '/roles',
    preHandler: app.conPermiso('roles.administrar'),
    schema: {
      tags: ['roles'],
      summary: 'Crear un rol',
      security: SEGURIDAD_SESION,
      body: esquemaCrearRolBody,
      response: { 201: esquemaRolSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const rol = await crearRol(sesion, request.body);
      return reply.code(201).send(aRolSalida(rol));
    },
  });

  // ── Actualizar (nombre/descripción; un rol de sistema no se renombra) ──────
  app.route({
    method: 'PATCH',
    url: '/roles/:id',
    preHandler: app.conPermiso('roles.administrar'),
    schema: {
      tags: ['roles'],
      summary: 'Actualizar un rol',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaActualizarRolBody,
      response: { 200: esquemaRolSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aRolSalida(await actualizarRol(sesion, request.params.id, request.body));
    },
  });

  // ── Asignar permisos (REEMPLAZA el conjunto completo) ──────────────────────
  app.route({
    method: 'PUT',
    url: '/roles/:id/permisos',
    preHandler: app.conPermiso('roles.administrar'),
    schema: {
      tags: ['roles'],
      summary: 'Reemplazar los permisos de un rol',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaAsignarPermisosBody,
      response: { 200: esquemaRolSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const rol = await asignarPermisos(sesion, request.params.id, request.body.clavesPermisos);
      return aRolSalida(rol);
    },
  });

  // ── Eliminar (borrado real; bloquea roles de sistema y con usuarios) ───────
  app.route({
    method: 'DELETE',
    url: '/roles/:id',
    preHandler: app.conPermiso('roles.administrar'),
    schema: {
      tags: ['roles'],
      summary: 'Eliminar un rol',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await eliminarRol(sesion, request.params.id);
      return reply.code(204).send(null);
    },
  });

  // ── Catálogo de permisos agrupado por módulo (árbol de la pantalla) ────────
  // Catálogo de CÓDIGO (A4): no toca BD. Se protege con `roles.administrar`
  // porque solo quien administra roles necesita el árbol de permisos.
  app.route({
    method: 'GET',
    url: '/permisos',
    preHandler: app.conPermiso('roles.administrar'),
    schema: {
      tags: ['roles'],
      summary: 'Catálogo de permisos agrupado por módulo',
      security: SEGURIDAD_SESION,
      response: { 200: esquemaCatalogoPermisosSalida, ...respuestasError },
    },
    handler: async (request) => {
      await exigirSesion(() => request.obtenerSesion());
      return listarCatalogoPermisos();
    },
  });

  done();
};
