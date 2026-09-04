/**
 * Rutas REST del TABLERO WIP + existencias en poder del maquilero (F3-E5; consultas consolidadas).
 * Handlers DELGADOS (A1): validan (Zod compartido de `src/contrato`), autorizan (`conPermiso`, A4) y
 * delegan al dominio `dominio/produccion/wip`. CERO lógica de negocio aquí — el avance lo DERIVA el
 * dominio por suma directa de `EtapaMovimientoDet` (D3/D4).
 *
 * Endpoints (todos GET, todos `produccion.wip-ver`, todos por la empresa activa = A9):
 *  • `GET /produccion/wip`                  → tablero: órdenes con su avance agregado (paginado).
 *  • `GET /produccion/wip/ordenes/:id`      → drill-down de una orden (pendientes por etapa, color×talla).
 *  • `GET /produccion/existencias-maquilero`→ enviado − recibido − incompletas − faltantes saldados, por maquilero ×
 *                                              proceso × orden (V1-E8v: la incompleta ya volvió).
 *
 * El drill-down usa el prefijo `/produccion/wip/ordenes/:id` a propósito, para NO chocar con
 * `/produccion/ordenes/:id/pendientes` (etapas.rutas.ts) ni `/produccion/ordenes/:id/pendientes-recibir`
 * (recibos.rutas.ts).
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasWip, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaTableroWipQuery,
  esquemaTableroWipPagina,
  esquemaWipOrden,
  esquemaExistenciaMaquileroQuery,
  esquemaExistenciaMaquileroLista,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  consultarExistenciaMaquilero,
  consultarWip,
  wipDeOrden,
} from '../../dominio/produccion/wip.js';

/** Parámetro de ruta `:id`. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del recurso.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
} as const;

/** Registra las rutas del tablero WIP + existencias del maquilero (montadas bajo `/api`). */
export const rutasWip: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Tablero WIP: órdenes con su avance agregado por etapa (paginado).
  app.route({
    method: 'GET',
    url: '/produccion/wip',
    preHandler: app.conPermiso('produccion.wip-ver'),
    schema: {
      tags: ['produccion'],
      summary: 'Tablero WIP: órdenes con su avance derivado por etapa (corte/envío/recibo/entrega)',
      security: SEGURIDAD_SESION,
      querystring: esquemaTableroWipQuery,
      response: { 200: esquemaTableroWipPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return consultarWip(sesion, request.query);
    },
  });

  // Drill-down de UNA orden: pendientes por etapa y por color×talla. (Prefijo /wip/ordenes para no
  // chocar con /produccion/ordenes/:id/... de etapas/recibos.)
  app.route({
    method: 'GET',
    url: '/produccion/wip/ordenes/:id',
    preHandler: app.conPermiso('produccion.wip-ver'),
    schema: {
      tags: ['produccion'],
      summary: 'Drill-down del avance de una orden (pendientes por etapa, color×talla + entregado)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaWipOrden, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return wipDeOrden(sesion, request.params.id);
    },
  });

  // Existencias del maquilero: enviado − recibido − incompletas − faltantes saldados, por maquilero × proceso × orden.
  app.route({
    method: 'GET',
    url: '/produccion/existencias-maquilero',
    preHandler: app.conPermiso('produccion.wip-ver'),
    schema: {
      tags: ['produccion'],
      summary:
        'Existencias del maquilero (enviado − recibido − incompletas − faltantes saldados, por orden y proceso)',
      security: SEGURIDAD_SESION,
      querystring: esquemaExistenciaMaquileroQuery,
      response: { 200: esquemaExistenciaMaquileroLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return consultarExistenciaMaquilero(sesion, request.query);
    },
  });

  done();
};
