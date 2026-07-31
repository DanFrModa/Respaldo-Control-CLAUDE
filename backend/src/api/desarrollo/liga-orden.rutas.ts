/**
 * Rutas REST del ENGANCHE Desarrollo ↔ Producción (F8-E6). Handlers delgados (A1): validan (Zod
 * compartido), autorizan (`conPermiso`, A4: `desarrollo.administrar` para ligar/quitar,
 * `desarrollo.ver` para las lecturas) y delegan al dominio `dominio/desarrollo/liga-orden`. CERO lógica
 * de negocio aquí. NO crea permisos nuevos (usa los `desarrollo.*` de E1). Se registra en `app.ts`.
 *
 * Endpoints (bajo `/api`):
 *   `POST   /ordenes/:idOrden/desarrollo`            — ligar la orden a un desarrollo.
 *   `DELETE /ordenes/:idOrden/desarrollo`            — quitar la liga.
 *   `GET    /ordenes/:idOrden/desarrollo/sugerencia` — desarrollo candidato + precio propuesto (editable).
 *   `GET    /ordenes/:idOrden/expediente`            — vista 360 desde la orden ligada.
 *   `GET    /desarrollos/tablero`                    — conteos de desarrollos por estado (query filtros).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaExpedienteOrdenSalida,
  esquemaLigaEstadoSalida,
  esquemaLigaOrdenSalida,
  esquemaLigarOrdenCuerpo,
  esquemaSugerenciaLigaSalida,
  esquemaTableroDesarrollosQuery,
  esquemaTableroDesarrollosSalida,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  expedienteOrden,
  ligarOrden,
  quitarLiga,
  sugerenciaLigaOrden,
  tableroDesarrollos,
} from '../../dominio/desarrollo/liga-orden.js';

/** Parámetro de ruta `:idOrden` (orden de producción). */
const esquemaParamIdOrden = z.object({
  idOrden: z.coerce
    .number({ error: 'El id de la orden debe ser un número' })
    .int({ error: 'El id de la orden debe ser entero' })
    .positive({ error: 'El id de la orden debe ser positivo' })
    .describe('Id de la orden de producción.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del enganche Desarrollo↔Producción (montadas bajo `/api`). */
export const rutasLigaOrden: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Ligar la orden a un desarrollo.
  app.route({
    method: 'POST',
    url: '/ordenes/:idOrden/desarrollo',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Ligar una orden de producción a un desarrollo (R16/E6)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdOrden,
      body: esquemaLigarOrdenCuerpo,
      response: { 201: esquemaLigaOrdenSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const liga = await ligarOrden(sesion, request.params.idOrden, request.body);
      return reply.code(201).send(liga);
    },
  });

  // Quitar la liga de una orden.
  app.route({
    method: 'DELETE',
    url: '/ordenes/:idOrden/desarrollo',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Quitar la liga desarrollo↔orden de una orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdOrden,
      response: { 200: esquemaLigaEstadoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return quitarLiga(sesion, request.params.idOrden);
    },
  });

  // Sugerencia de liga + precio de pedido propuesto (editable).
  app.route({
    method: 'GET',
    url: '/ordenes/:idOrden/desarrollo/sugerencia',
    preHandler: app.conPermiso('desarrollo.ver'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Sugerir el desarrollo candidato y el precio de pedido propuesto para una orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdOrden,
      response: { 200: esquemaSugerenciaLigaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return sugerenciaLigaOrden(sesion, request.params.idOrden);
    },
  });

  // Vista 360 (expediente) desde la orden ligada.
  app.route({
    method: 'GET',
    url: '/ordenes/:idOrden/expediente',
    preHandler: app.conPermiso('desarrollo.ver'),
    schema: {
      tags: ['desarrollo'],
      summary:
        'Expediente 360 de una orden ligada a Desarrollo (proyecto/precosto/lista/negociación)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdOrden,
      response: { 200: esquemaExpedienteOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return expedienteOrden(sesion, request.params.idOrden);
    },
  });

  // Tablero de desarrollos por estado (agregado en el servidor). Ruta estática (gana sobre /:id).
  app.route({
    method: 'GET',
    url: '/desarrollos/tablero',
    preHandler: app.conPermiso('desarrollo.ver'),
    schema: {
      tags: ['desarrollo'],
      summary:
        'Tablero de conteos de desarrollos por estado (filtros por cliente/departamento/temporada)',
      security: SEGURIDAD_SESION,
      querystring: esquemaTableroDesarrollosQuery,
      response: { 200: esquemaTableroDesarrollosSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return tableroDesarrollos(sesion, request.query);
    },
  });

  done();
};
