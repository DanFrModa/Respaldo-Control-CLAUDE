/**
 * Rutas REST de los PAGOS a maquileros (F6-E4). Handlers DELGADOS (A1): validan (Zod compartido),
 * autorizan (`conPermiso`, A4) y delegan al dominio `dominio/esma/pagos`. La regla anti-doble-pago
 * (prendas por pagar bajo lock, bloqueo duro) vive en el dominio.
 *
 * Endpoints (por la empresa activa = A9):
 *  • `POST /esma/pagos`                 (perm `esma.ver-pagos`) → captura un pago ligado a cargos.
 *  • `GET  /esma/pagos/:id`             (perm `esma.ver-pagos`) → un pago con sus aplicaciones.
 *  • `GET  /esma/pagos/:id/impreso`     (perm `esma.ver-pagos`) → recibo de pago (PDF, R9).
 *  • `GET  /esma/maquileros/:id/pagos`  (perm `esma.ver-pagos`) → pagos del maquilero.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaPagoCrear,
  esquemaPagoSalida,
  esquemaPagosLista,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  crearPagoMaquilero,
  listarPagosMaquilero,
  obtenerPagoMaquilero,
} from '../../dominio/esma/pagos.js';
import { impresoReciboPago } from '../../dominio/esma/impresos/impreso-recibo-pago.js';

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

/** Registra las rutas de pagos EsMa (montadas bajo `/api`). */
export const rutasPagosEsMa: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    method: 'POST',
    url: '/esma/pagos',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Capturar un pago a un maquilero (ligado a cargos; anti-doble-pago)',
      security: SEGURIDAD_SESION,
      body: esquemaPagoCrear,
      response: { 201: esquemaPagoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pago = await crearPagoMaquilero(sesion, request.body);
      return reply.code(201).send(pago);
    },
  });

  app.route({
    method: 'GET',
    url: '/esma/pagos/:id',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Obtener un pago (con sus aplicaciones a cargos)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaPagoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerPagoMaquilero(sesion, request.params.id);
    },
  });

  // ── Impreso (binario application/pdf; solo se documentan los errores) ─────────
  app.route({
    method: 'GET',
    url: '/esma/pagos/:id/impreso',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Recibo de pago de maquila (PDF, R9)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await impresoReciboPago(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="recibo-pago-${folio}.pdf"`);
      return reply.send(buffer as unknown as never);
    },
  });

  app.route({
    method: 'GET',
    url: '/esma/maquileros/:id/pagos',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Pagos de un maquilero (importes ocultos sin consultas.ver-importes)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaPagosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarPagosMaquilero(sesion, request.params.id);
    },
  });

  done();
};
