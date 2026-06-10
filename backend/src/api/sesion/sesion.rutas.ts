/**
 * Ruta `GET /api/sesion` — el "yo"/me.
 *
 * Devuelve el usuario autenticado, su empresa activa y sus permisos efectivos,
 * para que el frontend (E4) arme el menú y oculte lo no permitido. La decisión
 * de autorización REAL ocurre en cada ruta protegida (§9.2); esto es solo el
 * contexto que el cliente necesita para pintar la interfaz.
 *
 * Ruta DELGADA (A1): no hay lógica de negocio; toma la `SesionUsuario` ya
 * resuelta por el plugin de auth y la proyecta al contrato. 401 si no hay sesión.
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi, esquemaSesionActual } from '../../contrato/index.js';
import { SEGURIDAD_SESION } from '../../openapi.js';

/** Registra `GET /sesion` (montado bajo `/api`). */
export const rutasSesion: FastifyPluginCallbackZod = (app, _opciones, done) => {
  app.route({
    method: 'GET',
    url: '/sesion',
    schema: {
      tags: ['sesion'],
      summary: 'Usuario actual',
      description: 'Devuelve el usuario autenticado, su empresa activa y sus permisos.',
      security: SEGURIDAD_SESION,
      response: { 200: esquemaSesionActual, 401: esquemaErrorApi },
    },
    handler: async (request, reply) => {
      const sesion = await request.obtenerSesion();
      if (sesion === null) {
        return reply
          .code(401)
          .send({ codigo: 'NO_AUTENTICADO', mensaje: 'Necesitas iniciar sesión.' });
      }
      return reply.code(200).send({
        id: sesion.id,
        username: sesion.username,
        nombre: sesion.nombre,
        empresaActiva: { id: sesion.idEmpresaActiva, nombre: sesion.nombreEmpresaActiva },
        permisos: [...sesion.permisos],
      });
    },
  });

  done();
};
