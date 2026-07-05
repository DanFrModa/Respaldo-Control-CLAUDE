/**
 * Rutas REST de los DESARROLLOS (F8-E2, D13/R16). Handlers delgados (A1): validan (Zod compartido),
 * autorizan (`conPermiso`, A4: `desarrollo.ver` para leer, `desarrollo.administrar` para mutar) y
 * delegan al dominio `dominio/desarrollo/desarrollos`. El dominio devuelve ya la proyección del
 * contrato (con el estado DERIVADO). Errores de dominio los traduce el handler global.
 *
 * Endpoints: `POST /proyectos/:idProyecto/desarrollos` (alta anidada al proyecto), `GET/PATCH
 * /desarrollos/:id`, `POST /desarrollos/:id/apagar` (motivo) y `.../reactivar`. Se registra en
 * `app.ts`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/index.js';
import {
  esquemaDesarrolloApagarCuerpo,
  esquemaDesarrolloCrear,
  esquemaDesarrolloEditar,
  esquemaDesarrolloSalida,
} from '../../contrato/esquemas/desarrollo.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarDesarrollo,
  apagarDesarrollo,
  crearDesarrollo,
  obtenerDesarrollo,
  reactivarDesarrollo,
} from '../../dominio/desarrollo/desarrollos.js';

/** Parámetro de ruta `:idProyecto`. */
const esquemaParamProyecto = z.object({
  idProyecto: z.coerce
    .number({ error: 'El id del proyecto debe ser un número' })
    .int({ error: 'El id del proyecto debe ser entero' })
    .positive({ error: 'El id del proyecto debe ser positivo' })
    .describe('Id del proyecto.'),
});

/** Parámetro de ruta `:id` (desarrollo). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del desarrollo debe ser un número' })
    .int({ error: 'El id del desarrollo debe ser entero' })
    .positive({ error: 'El id del desarrollo debe ser positivo' })
    .describe('Id del desarrollo.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de desarrollos (montadas bajo `/api`). */
export const rutasDesarrollos: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Crear un desarrollo dentro de un proyecto (elige un modelo existente).
  app.route({
    method: 'POST',
    url: '/proyectos/:idProyecto/desarrollos',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Agregar un desarrollo a un proyecto',
      security: SEGURIDAD_SESION,
      params: esquemaParamProyecto,
      body: esquemaDesarrolloCrear,
      response: { 201: esquemaDesarrolloSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const desarrollo = await crearDesarrollo(sesion, request.params.idProyecto, request.body);
      return reply.code(201).send(desarrollo);
    },
  });

  // Obtener un desarrollo (con su estado derivado).
  app.route({
    method: 'GET',
    url: '/desarrollos/:id',
    preHandler: app.conPermiso('desarrollo.ver'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Obtener un desarrollo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaDesarrolloSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerDesarrollo(sesion, request.params.id);
    },
  });

  // Actualizar (numeroCliente/notas).
  app.route({
    method: 'PATCH',
    url: '/desarrollos/:id',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Actualizar un desarrollo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaDesarrolloEditar,
      response: { 200: esquemaDesarrolloSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarDesarrollo(sesion, request.params.id, request.body);
    },
  });

  // Apagar (borrado suave con motivo).
  app.route({
    method: 'POST',
    url: '/desarrollos/:id/apagar',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Apagar un desarrollo (borrado suave con motivo)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaDesarrolloApagarCuerpo,
      response: { 200: esquemaDesarrolloSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return apagarDesarrollo(sesion, request.params.id, request.body);
    },
  });

  // Reactivar (operación inversa).
  app.route({
    method: 'POST',
    url: '/desarrollos/:id/reactivar',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Reactivar un desarrollo apagado',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaDesarrolloSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return reactivarDesarrollo(sesion, request.params.id);
    },
  });

  done();
};
