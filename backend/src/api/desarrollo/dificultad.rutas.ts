/**
 * Ruta REST del resolvedor de DIFICULTAD por # de operaciones (rediseño R5, B7). El editor de
 * desarrollo la consulta para mostrar EN VIVO "34 ops → Muy complejo → costura ≈ 20 d" sin necesitar
 * permisos de Ruta Crítica (la derivación server-side vive en `dominio/desarrollo/dificultad`, A1).
 * Handler delgado: valida (Zod), autoriza (`desarrollo.ver`) y delega. Se registra en `app.ts`.
 *
 * Endpoint: `GET /desarrollos/dificultad?ops=N` (segmento estático, como `/desarrollos/tablero`).
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/index.js';
import {
  esquemaDificultadQuery,
  esquemaDificultadResuelta,
} from '../../contrato/esquemas/modelo.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { resolverDificultadPorOps } from '../../dominio/desarrollo/dificultad.js';

/** Registra la ruta del resolvedor de dificultad (montada bajo `/api`). */
export const rutasDificultad: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  app.route({
    method: 'GET',
    url: '/desarrollos/dificultad',
    preHandler: app.conPermiso('desarrollo.ver'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Resolver la dificultad derivada de un # de operaciones (R5/B7)',
      security: SEGURIDAD_SESION,
      querystring: esquemaDificultadQuery,
      response: {
        200: esquemaDificultadResuelta,
        400: esquemaErrorApi,
        401: esquemaErrorApi,
        403: esquemaErrorApi,
      },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return resolverDificultadPorOps(sesion, request.query.ops);
    },
  });

  done();
};
