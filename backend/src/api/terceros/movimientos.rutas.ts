/**
 * Rutas REST del MOTOR de cuenta corriente de terceros (Módulo 14, F9-E1; D12/D15/R10). Handlers
 * DELGADOS (A1): validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/terceros`. El saldo se DERIVA (D3): no hay ninguna ruta que edite un saldo.
 *
 * Endpoints (por la empresa activa = A9):
 *  • `POST /terceros/movimientos`              (perm `terceros.administrar`) → registra un movimiento.
 *  • `POST /terceros/movimientos/:id/cancelar` (perm `terceros.administrar`) → cancela por inverso.
 *  • `GET  /terceros/:tipo/:id/saldo`          (perm `terceros.ver`)         → saldo derivado (motor + EsMa).
 *  • `GET  /terceros/:tipo/:id/estado-cuenta`  (perm `terceros.ver`)         → saldo + movimientos paginados.
 *    (la vista `fiscal` del estado de cuenta exige, además, `terceros.fiscal`; lo valida el dominio.)
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  TIPOS_TERCERO,
  esquemaMovimientoTerceroCrear,
  esquemaMovimientoTerceroCancelar,
  esquemaMovimientoTerceroSalida,
  esquemaEstadoCuentaTerceroQuery,
  esquemaEstadoCuentaTerceroSalida,
  esquemaSaldoTerceroSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  registrarMovimientoTercero,
  cancelarMovimientoTercero,
  calcularSaldoTercero,
  estadoDeCuentaTercero,
} from '../../dominio/terceros/cuenta-terceros.js';

/** Parámetro de ruta `:id` (id de un movimiento). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del movimiento.'),
});

/** Parámetros de ruta de un tercero: `:tipo` (cliente|proveedor) + `:id`. */
const esquemaParamTercero = z.object({
  tipo: z.enum(TIPOS_TERCERO).describe('Tipo de tercero: cliente o proveedor.'),
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del cliente o proveedor.'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del motor de terceros (montadas bajo `/api`). */
export const rutasTerceros: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/terceros/movimientos',
    preHandler: app.conPermiso('terceros.administrar'),
    schema: {
      tags: ['terceros'],
      summary: 'Registrar un movimiento de cuenta corriente de un tercero (CxC/CxP)',
      security: SEGURIDAD_SESION,
      body: esquemaMovimientoTerceroCrear,
      response: { 201: esquemaMovimientoTerceroSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const mov = await registrarMovimientoTercero(sesion, request.body);
      return reply.code(201).send(mov);
    },
  });

  app.route({
    method: 'POST',
    url: '/terceros/movimientos/:id/cancelar',
    preHandler: app.conPermiso('terceros.administrar'),
    schema: {
      tags: ['terceros'],
      summary: 'Cancelar un movimiento por su inverso auditado (D3, nunca borrado)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaMovimientoTerceroCancelar,
      response: { 200: esquemaMovimientoTerceroSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarMovimientoTercero(sesion, request.params.id, request.body);
    },
  });

  app.route({
    method: 'GET',
    url: '/terceros/:tipo/:id/saldo',
    preHandler: app.conPermiso('terceros.ver'),
    schema: {
      tags: ['terceros'],
      summary: 'Saldo derivado de un tercero (Σ movimientos; incluye EsMa en proveedores)',
      security: SEGURIDAD_SESION,
      params: esquemaParamTercero,
      response: { 200: esquemaSaldoTerceroSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return calcularSaldoTercero(sesion, request.params.tipo, request.params.id);
    },
  });

  app.route({
    method: 'GET',
    url: '/terceros/:tipo/:id/estado-cuenta',
    preHandler: app.conPermiso('terceros.ver'),
    schema: {
      tags: ['terceros'],
      summary:
        'Estado de cuenta de un tercero (saldo + movimientos paginados; vista operativa/fiscal)',
      security: SEGURIDAD_SESION,
      params: esquemaParamTercero,
      querystring: esquemaEstadoCuentaTerceroQuery,
      response: { 200: esquemaEstadoCuentaTerceroSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return estadoDeCuentaTercero(sesion, request.params.tipo, request.params.id, request.query);
    },
  });

  done();
};
