/**
 * Rutas REST del ARCHIVO HISTÓRICO DE ÓRDENES del sistema viejo (§Post-F9.26). Handlers DELGADOS
 * (A1): autorizan y delegan a `dominio/consultas/historico-ordenes`.
 *
 * SOLO GET, y así se queda: el archivo se llena con el ETL y desde la aplicación no se toca. No hay
 * POST/PUT/DELETE que escribir.
 *
 * PERMISO: `ordenes.ver` reusado (quien ve órdenes ve las viejas) — cero permisos nuevos, cero seed.
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasHistoricoOrdenes, { prefix: '/api' })`).
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  esquemaErrorApi,
  esquemaHistoricoOrdenDetalle,
  esquemaHistoricoOrdenesPagina,
  esquemaHistoricoOrdenesQuery,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  listarHistoricoOrdenes,
  obtenerHistoricoOrden,
} from '../../dominio/consultas/historico-ordenes.js';

const respuestasError = {
  401: esquemaErrorApi,
  403: esquemaErrorApi,
} as const;

const esquemaIdParam = z.object({
  id: z.coerce.number().int().positive({ error: 'El id debe ser un entero positivo' }),
});

export const rutasHistoricoOrdenes: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/historico-ordenes',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['historico'],
      summary: 'Buscar en el archivo histórico de órdenes del sistema viejo',
      security: SEGURIDAD_SESION,
      querystring: esquemaHistoricoOrdenesQuery,
      response: { 200: esquemaHistoricoOrdenesPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarHistoricoOrdenes(sesion, request.query);
    },
  });

  app.route({
    method: 'GET',
    url: '/historico-ordenes/:id',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['historico'],
      summary: 'Ficha de una orden histórica (matriz color×talla y quién la trabajó)',
      security: SEGURIDAD_SESION,
      params: esquemaIdParam,
      response: { 200: esquemaHistoricoOrdenDetalle, 404: esquemaErrorApi, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { id } = request.params;
      return obtenerHistoricoOrden(sesion, id);
    },
  });

  done();
};
