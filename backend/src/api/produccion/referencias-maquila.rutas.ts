/**
 * Rutas REST de las REFERENCIAS DE PRECIO DE MAQUILA de la orden y de su consulta (fila 0.242,
 * `DECISIONES.md` §Post-F9.255). Sólo validan permiso + Zod y delegan al dominio
 * (`dominio/produccion/referencias-maquila.ts`, A1):
 *
 *  • `GET   /ordenes/referencias-maquila/cambios` (`ordenes.autorizar-sobreprecio`) → la consulta de Daniel:
 *    referencias cambiadas y sobreprecios autorizados.
 *  • `GET   /ordenes/:id/referencias-maquila` (`ordenes.ver`) → la referencia de cada proceso de la orden
 *    (montos tapados sin una llave de precios de maquila).
 *  • `PATCH /ordenes/:id/referencias-maquila` (`ordenes.precio-maquila`) → capturar una referencia (costura) o
 *    el precio de un renglón de arte. Deja rastro.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaReferenciaMaquilaPatchCuerpo,
  esquemaReferenciasCambiosLista,
  esquemaReferenciasCambiosQuery,
  esquemaReferenciasOrdenSalida,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  capturarReferenciaMaquila,
  listarCambiosDeReferencias,
  obtenerReferenciasOrden,
} from '../../dominio/produccion/referencias-maquila.js';

/** Parámetro de ruta `:id` (orden). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la orden debe ser un número' })
    .int({ error: 'El id de la orden debe ser entero' })
    .positive({ error: 'El id de la orden debe ser positivo' })
    .describe('Id de la orden.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de referencias de maquila (montadas bajo `/api`). */
export const rutasReferenciasMaquila: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // La consulta de Daniel: referencias cambiadas y sobreprecios autorizados (llave reservada).
  app.route({
    method: 'GET',
    url: '/ordenes/referencias-maquila/cambios',
    preHandler: app.conPermiso('ordenes.autorizar-sobreprecio'),
    schema: {
      tags: ['ordenes'],
      summary: 'Referencias de maquila cambiadas y sobreprecios autorizados',
      security: SEGURIDAD_SESION,
      querystring: esquemaReferenciasCambiosQuery,
      response: { 200: esquemaReferenciasCambiosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarCambiosDeReferencias(sesion, request.query);
    },
  });

  // Las referencias de la orden, una por proceso (montos con su regla de visibilidad).
  app.route({
    method: 'GET',
    url: '/ordenes/:id/referencias-maquila',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Referencias de precio de maquila de la orden (el tope por proceso)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaReferenciasOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerReferenciasOrden(sesion, request.params.id);
    },
  });

  // Capturar una referencia (costura) o el precio de un renglón de arte (deja rastro).
  app.route({
    method: 'PATCH',
    url: '/ordenes/:id/referencias-maquila',
    preHandler: app.conPermiso('ordenes.precio-maquila'),
    schema: {
      tags: ['ordenes'],
      summary: 'Capturar una referencia de precio de maquila de la orden (deja rastro)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaReferenciaMaquilaPatchCuerpo,
      response: { 200: esquemaReferenciasOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return capturarReferenciaMaquila(sesion, request.params.id, request.body);
    },
  });

  done();
};
