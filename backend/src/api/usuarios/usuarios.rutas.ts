/**
 * Rutas REST de Usuarios (Administración, F1-E1 PIEZA C). Calca el ESTÁNDAR de
 * ruta de Almacenes (`api/almacenes/almacenes.rutas.ts`): cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2).
 *  3. **Delega** al servicio de dominio `dominio/admin/usuarios` (que reaplica el
 *     permiso, valida de nuevo, abre transacción y audita).
 *
 * ⚠️ A diferencia de los catálogos, el dominio de usuarios verifica
 * `usuarios.administrar` en TODAS sus operaciones (incluidas las de lectura: no
 * existe `usuarios.ver`). Por eso TODAS las rutas —GET incluidos— se protegen con
 * `usuarios.administrar`: el guard de la ruta y el del dominio usan la MISMA clave.
 *
 * El id del usuario es un cuid (String), no un entero. CERO lógica de negocio o
 * acceso a datos aquí; los errores de dominio los traduce `src/api/errores.ts`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaUsuarioAsignarRoles,
  esquemaUsuarioCambiarContrasena,
  esquemaUsuarioCrear,
  esquemaUsuarioEditar,
  esquemaUsuarioSalida,
  esquemaUsuariosPagina,
  esquemaUsuariosQuery,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarUsuario,
  asignarRoles,
  cambiarContrasenaUsuario,
  crearUsuario,
  desactivarUsuario,
  desbloquearUsuario,
  listarUsuarios,
  obtenerUsuario,
  type UsuarioDto,
} from '../../dominio/admin/usuarios.js';

/** Proyecta el `UsuarioDto` del dominio a la forma JSON del contrato (fechas ISO). */
function aUsuarioSalida(usuario: UsuarioDto): z.infer<typeof esquemaUsuarioSalida> {
  return {
    id: usuario.id,
    username: usuario.username,
    nombre: usuario.nombre,
    email: usuario.email,
    activo: usuario.activo,
    bloqueado: usuario.bloqueado,
    intentosFallidos: usuario.intentosFallidos,
    esAuditor: usuario.esAuditor,
    creadoEn: usuario.creadoEn.toISOString(),
    modificadoEn: usuario.modificadoEn.toISOString(),
    roles: usuario.roles,
  };
}

/** Parámetro de ruta `:id` del usuario (cuid). Reutilizado por GET/PATCH/DELETE/acciones. */
const esquemaParamId = z.object({
  id: z
    .string({ error: 'El id del usuario es obligatorio' })
    .min(1, { error: 'El id del usuario es obligatorio' })
    .describe('Id del usuario (cuid).'),
});

/** El cuerpo del PATCH no repite el `id` (va en la URL). */
const esquemaUsuarioPatchCuerpo = esquemaUsuarioEditar.omit({ id: true });

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de usuarios (montadas bajo `/api`). */
export const rutasUsuarios: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Listar (búsqueda + filtros + orden + paginación en servidor) ───────────
  app.route({
    method: 'GET',
    url: '/usuarios',
    preHandler: app.conPermiso('usuarios.administrar'),
    schema: {
      tags: ['usuarios'],
      summary: 'Listar usuarios',
      security: SEGURIDAD_SESION,
      querystring: esquemaUsuariosQuery,
      response: { 200: esquemaUsuariosPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarUsuarios(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aUsuarioSalida) };
    },
  });

  // ── Obtener uno ────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/usuarios/:id',
    preHandler: app.conPermiso('usuarios.administrar'),
    schema: {
      tags: ['usuarios'],
      summary: 'Obtener un usuario',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaUsuarioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aUsuarioSalida(await obtenerUsuario(sesion, request.params.id));
    },
  });

  // ── Crear (alta con rol existente) ─────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/usuarios',
    preHandler: app.conPermiso('usuarios.administrar'),
    schema: {
      tags: ['usuarios'],
      summary: 'Crear un usuario',
      security: SEGURIDAD_SESION,
      body: esquemaUsuarioCrear,
      response: { 201: esquemaUsuarioSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const usuario = await crearUsuario(sesion, request.body);
      return reply.code(201).send(aUsuarioSalida(usuario));
    },
  });

  // ── Actualizar (parcial; `activo` des/reactiva, `bloqueado:false` desbloquea) ─
  app.route({
    method: 'PATCH',
    url: '/usuarios/:id',
    preHandler: app.conPermiso('usuarios.administrar'),
    schema: {
      tags: ['usuarios'],
      summary: 'Actualizar un usuario',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaUsuarioPatchCuerpo,
      response: { 200: esquemaUsuarioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const usuario = await actualizarUsuario(sesion, { ...request.body, id: request.params.id });
      return aUsuarioSalida(usuario);
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/usuarios/:id',
    preHandler: app.conPermiso('usuarios.administrar'),
    schema: {
      tags: ['usuarios'],
      summary: 'Desactivar un usuario (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaUsuarioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aUsuarioSalida(await desactivarUsuario(sesion, request.params.id));
    },
  });

  // ── Reasignar roles (REEMPLAZA el conjunto) ────────────────────────────────
  app.route({
    method: 'POST',
    url: '/usuarios/:id/roles',
    preHandler: app.conPermiso('usuarios.administrar'),
    schema: {
      tags: ['usuarios'],
      summary: 'Reasignar los roles de un usuario',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaUsuarioAsignarRoles,
      response: { 200: esquemaUsuarioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const usuario = await asignarRoles(sesion, request.params.id, request.body.idsRoles);
      return aUsuarioSalida(usuario);
    },
  });

  // ── Desbloquear (reinicia intentos fallidos) ───────────────────────────────
  app.route({
    method: 'POST',
    url: '/usuarios/:id/desbloquear',
    preHandler: app.conPermiso('usuarios.administrar'),
    schema: {
      tags: ['usuarios'],
      summary: 'Desbloquear un usuario bloqueado por intentos',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaUsuarioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aUsuarioSalida(await desbloquearUsuario(sesion, request.params.id));
    },
  });

  // ── Cambiar contraseña (reset por administrador) ───────────────────────────
  app.route({
    method: 'POST',
    url: '/usuarios/:id/contrasena',
    preHandler: app.conPermiso('usuarios.administrar'),
    schema: {
      tags: ['usuarios'],
      summary: 'Cambiar la contraseña de un usuario (reset por administrador)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaUsuarioCambiarContrasena,
      response: { 200: esquemaUsuarioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const usuario = await cambiarContrasenaUsuario(
        sesion,
        request.params.id,
        request.body.password,
      );
      return aUsuarioSalida(usuario);
    },
  });

  done();
};
