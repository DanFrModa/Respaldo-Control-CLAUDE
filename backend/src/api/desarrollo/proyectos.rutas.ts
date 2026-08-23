/**
 * Rutas REST de los PROYECTOS de desarrollo (F8-E2, D13/R16). Handlers delgados (A1): validan (Zod
 * compartido), autorizan (`conPermiso`, A4: `desarrollo.ver` para leer, `desarrollo.administrar`
 * para mutar) y delegan al dominio `dominio/desarrollo/proyectos`. El dominio devuelve ya la
 * proyección del contrato (no hay `a...Salida` aquí). Errores de dominio los traduce el handler
 * global (`src/api/errores.ts`).
 *
 * Endpoints: CRUD `/proyectos` (+ `:id`), `POST /proyectos/:id/archivar` y `.../desarchivar`.
 * Se registra en `app.ts` (`await app.register(rutasProyectos, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/index.js';
import {
  esquemaProyectoCrear,
  esquemaProyectoDetalleSalida,
  esquemaProyectoEditar,
  esquemaProyectosPagina,
  esquemaProyectosQuery,
} from '../../contrato/esquemas/proyecto.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarProyecto,
  archivarProyecto,
  crearProyecto,
  desarchivarProyecto,
  listarProyectos,
  obtenerProyecto,
} from '../../dominio/desarrollo/proyectos.js';

/** Parámetro de ruta `:id` (proyecto). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del proyecto debe ser un número' })
    .int({ error: 'El id del proyecto debe ser entero' })
    .positive({ error: 'El id del proyecto debe ser positivo' })
    .describe('Id del proyecto.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de proyectos de desarrollo (montadas bajo `/api`). */
export const rutasProyectos: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Listar (búsqueda + filtros + orden + paginación en servidor).
  app.route({
    method: 'GET',
    url: '/proyectos',
    preHandler: app.conPermiso('desarrollo.ver'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Listar proyectos de desarrollo',
      security: SEGURIDAD_SESION,
      querystring: esquemaProyectosQuery,
      response: { 200: esquemaProyectosPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarProyectos(sesion, request.query);
    },
  });

  // Obtener uno (con sus desarrollos + estado derivado).
  app.route({
    method: 'GET',
    url: '/proyectos/:id',
    preHandler: app.conPermiso('desarrollo.ver'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Obtener un proyecto de desarrollo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaProyectoDetalleSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerProyecto(sesion, request.params.id);
    },
  });

  // Crear.
  app.route({
    method: 'POST',
    url: '/proyectos',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Crear un proyecto de desarrollo',
      security: SEGURIDAD_SESION,
      body: esquemaProyectoCrear,
      response: { 201: esquemaProyectoDetalleSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const proyecto = await crearProyecto(sesion, request.body);
      return reply.code(201).send(proyecto);
    },
  });

  // Actualizar (nombre/departamento/temporada/notas).
  app.route({
    method: 'PATCH',
    url: '/proyectos/:id',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Actualizar un proyecto de desarrollo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaProyectoEditar,
      response: { 200: esquemaProyectoDetalleSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarProyecto(sesion, request.params.id, request.body);
    },
  });

  // Archivar (borrado suave reversible).
  app.route({
    method: 'POST',
    url: '/proyectos/:id/archivar',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Archivar un proyecto (borrado suave reversible)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaProyectoDetalleSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return archivarProyecto(sesion, request.params.id);
    },
  });

  // Desarchivar (operación inversa).
  app.route({
    method: 'POST',
    url: '/proyectos/:id/desarchivar',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Desarchivar un proyecto',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaProyectoDetalleSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return desarchivarProyecto(sesion, request.params.id);
    },
  });

  done();
};
