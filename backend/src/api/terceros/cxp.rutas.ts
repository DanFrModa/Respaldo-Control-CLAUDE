/**
 * Rutas REST de CxP — CUENTAS POR PAGAR de proveedores (Módulo 14, F9-E2; D12/D15/R10). Handlers
 * DELGADOS (A1): validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan a
 * `dominio/terceros/cxp`. CxP COMPONE sobre el motor de terceros (F9-E1): el saldo se DERIVA (D3), no
 * hay ninguna ruta que lo edite.
 *
 * Endpoints (por la empresa activa = A9):
 *  • `GET  /cxp/por-pagar`                              (perm `cxp.ver`)         → bandeja + aging + resumen.
 *  • `GET  /cxp/proveedores/:id/estado-cuenta`          (perm `cxp.ver`)         → saldo + movimientos.
 *  • `GET  /cxp/proveedores/:id/estado-cuenta/impreso`  (perm `cxp.ver`)         → PDF (R9).
 *  • `POST /cxp/proveedores/:id/movimientos`            (perm `cxp.administrar`) → captura un movimiento.
 *  • `POST /cxp/movimientos/:id/cancelar`               (perm `cxp.administrar`) → cancela por inverso.
 *    (la vista `fiscal` del estado de cuenta exige, además, `terceros.fiscal`; lo valida el dominio.)
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaMovimientoCxpCrear,
  esquemaBandejaCxpQuery,
  esquemaBandejaCxpSalida,
  esquemaMovimientoTerceroCancelar,
  esquemaMovimientoTerceroSalida,
  esquemaEstadoCuentaTerceroQuery,
  esquemaEstadoCuentaTerceroSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  bandejaPorPagar,
  estadoCuentaProveedorCxp,
  registrarMovimientoCxp,
  cancelarMovimientoCxp,
} from '../../dominio/terceros/cxp/cxp.js';
import { impresoEstadoCuentaCxp } from '../../dominio/terceros/cxp/impresos/impreso-estado-cuenta-cxp.js';

/** Parámetro de ruta `:id` (id de un movimiento). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del movimiento.'),
});

/** Parámetro de ruta `:id` de un proveedor. */
const esquemaParamProveedor = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del proveedor.'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de CxP (montadas bajo `/api`). */
export const rutasCxp: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Bandeja "por pagar" (estática) ────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/cxp/por-pagar',
    preHandler: app.conPermiso('cxp.ver'),
    schema: {
      tags: ['cxp'],
      summary: 'Proveedores por pagar con su antigüedad de saldos (aging) + resumen',
      security: SEGURIDAD_SESION,
      querystring: esquemaBandejaCxpQuery,
      response: { 200: esquemaBandejaCxpSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return bandejaPorPagar(sesion, request.query);
    },
  });

  // ── Estado de cuenta de un proveedor ──────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/cxp/proveedores/:id/estado-cuenta',
    preHandler: app.conPermiso('cxp.ver'),
    schema: {
      tags: ['cxp'],
      summary: 'Estado de cuenta de un proveedor (saldo + movimientos; vista operativa/fiscal)',
      security: SEGURIDAD_SESION,
      params: esquemaParamProveedor,
      querystring: esquemaEstadoCuentaTerceroQuery,
      response: { 200: esquemaEstadoCuentaTerceroSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return estadoCuentaProveedorCxp(sesion, request.params.id, request.query);
    },
  });

  // ── Estado de cuenta: impreso PDF (R9) ────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/cxp/proveedores/:id/estado-cuenta/impreso',
    preHandler: app.conPermiso('cxp.ver'),
    schema: {
      tags: ['cxp'],
      summary: 'Estado de cuenta del proveedor (PDF, R9)',
      security: SEGURIDAD_SESION,
      params: esquemaParamProveedor,
      querystring: esquemaEstadoCuentaTerceroQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, idProveedor } = await impresoEstadoCuentaCxp(
        sesion,
        request.params.id,
        request.query,
      );
      reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `inline; filename="cxp-estado-cuenta-${String(idProveedor)}.pdf"`,
        );
      return reply.send(buffer as unknown as never);
    },
  });

  // ── Captura de un movimiento de CxP ───────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/cxp/proveedores/:id/movimientos',
    preHandler: app.conPermiso('cxp.administrar'),
    schema: {
      tags: ['cxp'],
      summary: 'Capturar un movimiento de CxP de un proveedor (pago/abono/descuento/NC/entrada)',
      security: SEGURIDAD_SESION,
      params: esquemaParamProveedor,
      body: esquemaMovimientoCxpCrear,
      response: { 201: esquemaMovimientoTerceroSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const mov = await registrarMovimientoCxp(sesion, request.params.id, request.body);
      return reply.code(201).send(mov);
    },
  });

  // ── Cancelación (inverso auditado) ────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/cxp/movimientos/:id/cancelar',
    preHandler: app.conPermiso('cxp.administrar'),
    schema: {
      tags: ['cxp'],
      summary: 'Cancelar un movimiento de CxP por su inverso auditado (D3, nunca borrado)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaMovimientoTerceroCancelar,
      response: { 200: esquemaMovimientoTerceroSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarMovimientoCxp(sesion, request.params.id, request.body);
    },
  });

  done();
};
