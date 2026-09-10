/**
 * Rutas REST del RECIBO de maquila (F3-E4). Handlers DELGADOS (A1): validan (Zod compartido de
 * `src/contrato`), autorizan (`conPermiso`, A4) y delegan al dominio `dominio/produccion/recibos`.
 * Las reglas de negocio (recibido ≤ enviado estricto, entrada a PT solo en costura, cargo EsMa,
 * cancelación con inverso, concurrencia) viven en el dominio.
 *
 * Endpoints (todos por la empresa activa de la sesión = A9):
 *  • `POST /produccion/recibos`                       (perm `produccion.recibo`)  → registra un recibo.
 *  • `POST /produccion/recibos/:id/cancelar`          (perm `produccion.cancelar`) → cancela (suave + inverso).
 *  • `GET  /produccion/ordenes/:id/pendientes-recibir`(perm `produccion.wip-ver`) → pendientes por recibir.
 *  • `GET  /produccion/recibos-semanales`             (perm `produccion.wip-ver`) → recibos semanales por maquilero.
 *  • `GET  /produccion/recibos/:id/impreso`           (perm `produccion.wip-ver`) → documento de recibo (PDF).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaReciboCrear,
  esquemaReciboCancelarCuerpo,
  esquemaReciboSalida,
  esquemaPendientesRecibir,
  esquemaRecibosSemanalesQuery,
  esquemaRecibosSemanalesLista,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  cancelarReciboMaquila,
  pendientesPorRecibir,
  recibosSemanalesPorMaquilero,
  registrarReciboMaquila,
} from '../../dominio/produccion/recibos.js';
import { impresoReciboMaquila } from '../../dominio/produccion/impresos/impreso-recibo-maquila.js';

/** Parámetro de ruta `:id`. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del recurso.'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del recibo de maquila (montadas bajo `/api`). */
export const rutasRecibosProduccion: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Recibo ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/produccion/recibos',
    preHandler: app.conPermiso('produccion.recibo'),
    schema: {
      tags: ['produccion'],
      summary: 'Registrar un recibo de maquila (WIP + entrada a PT en costura + cargo EsMa)',
      security: SEGURIDAD_SESION,
      body: esquemaReciboCrear,
      response: { 201: esquemaReciboSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const recibo = await registrarReciboMaquila(sesion, request.body);
      return reply.code(201).send(recibo);
    },
  });

  app.route({
    method: 'POST',
    url: '/produccion/recibos/:id/cancelar',
    preHandler: app.conPermiso('produccion.cancelar'),
    schema: {
      tags: ['produccion'],
      summary: 'Cancelar (suave + inverso de kardex si lo generó) un recibo de maquila',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaReciboCancelarCuerpo,
      response: { 200: esquemaReciboSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarReciboMaquila(sesion, request.params.id, request.body);
    },
  });

  // ── Consultas ──────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/produccion/ordenes/:id/pendientes-recibir',
    preHandler: app.conPermiso('produccion.wip-ver'),
    schema: {
      tags: ['produccion'],
      summary:
        'Pendientes por recibir de una orden (enviado − recibido − incompletas − faltantes saldados, por proceso)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaPendientesRecibir, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return pendientesPorRecibir(sesion, request.params.id);
    },
  });

  app.route({
    method: 'GET',
    url: '/produccion/recibos-semanales',
    preHandler: app.conPermiso('produccion.wip-ver'),
    schema: {
      tags: ['produccion'],
      summary: 'Recibos semanales por maquilero (consulta agrupada por maquilero y semana)',
      security: SEGURIDAD_SESION,
      querystring: esquemaRecibosSemanalesQuery,
      response: { 200: esquemaRecibosSemanalesLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return recibosSemanalesPorMaquilero(sesion, request.query);
    },
  });

  // ── Impreso (binario application/pdf; solo se documentan los errores) ─────────
  app.route({
    method: 'GET',
    url: '/produccion/recibos/:id/impreso',
    preHandler: app.conPermiso('produccion.wip-ver'),
    schema: {
      tags: ['produccion'],
      summary: 'Documento de recibo de maquila (PDF)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await impresoReciboMaquila(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="recibo-maquila-${folio}.pdf"`);
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
