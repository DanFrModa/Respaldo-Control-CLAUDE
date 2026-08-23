/**
 * Rutas REST de CxC — CUENTAS POR COBRAR de clientes (Módulo 14, F9-E4; D12/D15/R10/R12). Handlers
 * DELGADOS (A1): validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan a
 * `dominio/terceros/cxc`. CxC COMPONE sobre el motor de terceros (F9-E1): el saldo se DERIVA (D3), no
 * hay ninguna ruta que lo edite. Espejo de las rutas de CxP.
 *
 * Endpoints (por la empresa activa = A9):
 *  • `GET  /cxc/por-cobrar`                            (perm `cxc.ver`)         → bandeja + aging + resumen.
 *  • `GET  /cxc/clientes/:id/estado-cuenta`            (perm `cxc.ver`)         → saldo + movimientos.
 *  • `GET  /cxc/clientes/:id/estado-cuenta/impreso`    (perm `cxc.ver`)         → PDF (R9).
 *  • `POST /cxc/clientes/:id/movimientos`              (perm `cxc.administrar`) → captura un movimiento.
 *  • `POST /cxc/movimientos/:id/cancelar`              (perm `cxc.administrar`) → cancela por inverso.
 *    (la vista `fiscal` del estado de cuenta exige, además, `terceros.fiscal`; lo valida el dominio.)
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaMovimientoCxcCrear,
  esquemaBandejaCxcQuery,
  esquemaBandejaCxcSalida,
  esquemaMovimientoTerceroCancelar,
  esquemaMovimientoTerceroSalida,
  esquemaEstadoCuentaTerceroQuery,
  esquemaEstadoCuentaTerceroSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  bandejaPorCobrar,
  estadoCuentaClienteCxc,
  registrarMovimientoCxc,
  cancelarMovimientoCxc,
} from '../../dominio/terceros/cxc/cxc.js';
import { impresoEstadoCuentaCxc } from '../../dominio/terceros/cxc/impresos/impreso-estado-cuenta-cxc.js';

/** Parámetro de ruta `:id` (id de un movimiento). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del movimiento.'),
});

/** Parámetro de ruta `:id` de un cliente. */
const esquemaParamCliente = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del cliente.'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de CxC (montadas bajo `/api`). */
export const rutasCxc: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Bandeja "por cobrar" (estática) ───────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/cxc/por-cobrar',
    preHandler: app.conPermiso('cxc.ver'),
    schema: {
      tags: ['cxc'],
      summary: 'Clientes por cobrar con su antigüedad de saldos (aging) + resumen',
      security: SEGURIDAD_SESION,
      querystring: esquemaBandejaCxcQuery,
      response: { 200: esquemaBandejaCxcSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return bandejaPorCobrar(sesion, request.query);
    },
  });

  // ── Estado de cuenta de un cliente ────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/cxc/clientes/:id/estado-cuenta',
    preHandler: app.conPermiso('cxc.ver'),
    schema: {
      tags: ['cxc'],
      summary: 'Estado de cuenta de un cliente (saldo + movimientos; vista operativa/fiscal)',
      security: SEGURIDAD_SESION,
      params: esquemaParamCliente,
      querystring: esquemaEstadoCuentaTerceroQuery,
      response: { 200: esquemaEstadoCuentaTerceroSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return estadoCuentaClienteCxc(sesion, request.params.id, request.query);
    },
  });

  // ── Estado de cuenta: impreso PDF (R9) ────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/cxc/clientes/:id/estado-cuenta/impreso',
    preHandler: app.conPermiso('cxc.ver'),
    schema: {
      tags: ['cxc'],
      summary: 'Estado de cuenta del cliente (PDF, R9)',
      security: SEGURIDAD_SESION,
      params: esquemaParamCliente,
      querystring: esquemaEstadoCuentaTerceroQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, idCliente } = await impresoEstadoCuentaCxc(
        sesion,
        request.params.id,
        request.query,
      );
      reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `inline; filename="cxc-estado-cuenta-${String(idCliente)}.pdf"`,
        );
      return reply.send(buffer as unknown as never);
    },
  });

  // ── Captura de un movimiento de CxC ───────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/cxc/clientes/:id/movimientos',
    preHandler: app.conPermiso('cxc.administrar'),
    schema: {
      tags: ['cxc'],
      summary: 'Capturar un movimiento de CxC de un cliente (cobro/abono/descuento/NC/cargo)',
      security: SEGURIDAD_SESION,
      params: esquemaParamCliente,
      body: esquemaMovimientoCxcCrear,
      response: { 201: esquemaMovimientoTerceroSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const mov = await registrarMovimientoCxc(sesion, request.params.id, request.body);
      return reply.code(201).send(mov);
    },
  });

  // ── Cancelación (inverso auditado) ────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/cxc/movimientos/:id/cancelar',
    preHandler: app.conPermiso('cxc.administrar'),
    schema: {
      tags: ['cxc'],
      summary: 'Cancelar un movimiento de CxC por su inverso auditado (D3, nunca borrado)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaMovimientoTerceroCancelar,
      response: { 200: esquemaMovimientoTerceroSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarMovimientoCxc(sesion, request.params.id, request.body);
    },
  });

  done();
};
