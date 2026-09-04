/**
 * Rutas REST del CATÁLOGO DE CONCEPTOS DE PAGO que no son proveedores (fila 0.125). Handlers
 * DELGADOS (A1): validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/catalogos/conceptos-pago` y `…/conceptos-pago-cuentas`.
 *
 * Endpoints:
 *  • `GET    /conceptos-pago`                       (`conceptos-pago.ver`)         → catálogo paginado.
 *  • `POST   /conceptos-pago`                       (`conceptos-pago.administrar`) → alta.
 *  • `GET    /conceptos-pago/:id`                   (`conceptos-pago.ver`)         → uno con sus cuentas.
 *  • `PATCH  /conceptos-pago/:id`                   (`conceptos-pago.administrar`) → edición/retiro.
 *  • `GET    /conceptos-pago/:id/cuentas`           (`conceptos-pago.ver`)         → sus cuentas.
 *  • `POST   /conceptos-pago/:id/cuentas`           (`conceptos-pago.administrar`) → alta de cuenta.
 *  • `PATCH  /conceptos-pago/:id/cuentas/:idCuenta` (`conceptos-pago.administrar`) → edita/retira/default.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaConceptoPagoCrear,
  esquemaConceptoPagoCuentaCrear,
  esquemaConceptoPagoCuentaEditar,
  esquemaConceptoPagoCuentaSalida,
  esquemaConceptoPagoEditar,
  esquemaConceptoPagoSalida,
  esquemaConceptosPagoPagina,
  esquemaConceptosPagoQuery,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarConceptoPago,
  crearConceptoPago,
  listarConceptosPago,
  obtenerConceptoPago,
} from '../../dominio/catalogos/conceptos-pago.js';
import {
  actualizarCuentaConcepto,
  crearCuentaConcepto,
  listarCuentasConcepto,
} from '../../dominio/catalogos/conceptos-pago-cuentas.js';

/** Parámetro de ruta `:id`. */
const esquemaParamId = z.object({
  id: z.coerce.number().int().positive().describe('Id del concepto.'),
});

/** Parámetros `:id/:idCuenta`. */
const esquemaParamCuenta = esquemaParamId.extend({
  idCuenta: z.coerce.number().int().positive().describe('Id de la cuenta.'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del catálogo de conceptos de pago (montadas bajo `/api`). */
export const rutasConceptosPago: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/conceptos-pago',
    preHandler: app.conPermiso('conceptos-pago.ver'),
    schema: {
      tags: ['conceptos-pago'],
      summary: 'Catálogo de conceptos de pago que no son proveedores',
      security: SEGURIDAD_SESION,
      querystring: esquemaConceptosPagoQuery,
      response: { 200: esquemaConceptosPagoPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarConceptosPago(sesion, request.query);
    },
  });

  app.route({
    method: 'POST',
    url: '/conceptos-pago',
    preHandler: app.conPermiso('conceptos-pago.administrar'),
    schema: {
      tags: ['conceptos-pago'],
      summary: 'Dar de alta un concepto de pago',
      security: SEGURIDAD_SESION,
      body: esquemaConceptoPagoCrear,
      response: { 201: esquemaConceptoPagoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const creado = await crearConceptoPago(sesion, request.body);
      return reply.code(201).send(creado);
    },
  });

  app.route({
    method: 'GET',
    url: '/conceptos-pago/:id',
    preHandler: app.conPermiso('conceptos-pago.ver'),
    schema: {
      tags: ['conceptos-pago'],
      summary: 'Obtener un concepto de pago con sus cuentas',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaConceptoPagoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerConceptoPago(sesion, request.params.id);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/conceptos-pago/:id',
    preHandler: app.conPermiso('conceptos-pago.administrar'),
    schema: {
      tags: ['conceptos-pago'],
      summary: 'Editar, retirar o reactivar un concepto de pago',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaConceptoPagoEditar,
      response: { 200: esquemaConceptoPagoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarConceptoPago(sesion, request.params.id, request.body);
    },
  });

  app.route({
    method: 'GET',
    url: '/conceptos-pago/:id/cuentas',
    preHandler: app.conPermiso('conceptos-pago.ver'),
    schema: {
      tags: ['conceptos-pago'],
      summary: 'Cuentas/destinos de pago de un concepto',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      querystring: z.object({
        incluirInactivas: z.coerce
          .boolean()
          .default(false)
          .describe('Incluye las cuentas retiradas (historial reutilizable).'),
      }),
      response: { 200: z.array(esquemaConceptoPagoCuentaSalida), ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarCuentasConcepto(sesion, request.params.id, request.query.incluirInactivas);
    },
  });

  app.route({
    method: 'POST',
    url: '/conceptos-pago/:id/cuentas',
    preHandler: app.conPermiso('conceptos-pago.administrar'),
    schema: {
      tags: ['conceptos-pago'],
      summary: 'Agregar una cuenta/destino de pago a un concepto',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaConceptoPagoCuentaCrear,
      response: { 201: esquemaConceptoPagoCuentaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const creada = await crearCuentaConcepto(sesion, request.params.id, request.body);
      return reply.code(201).send(creada);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/conceptos-pago/:id/cuentas/:idCuenta',
    preHandler: app.conPermiso('conceptos-pago.administrar'),
    schema: {
      tags: ['conceptos-pago'],
      summary: 'Editar, retirar, reactivar o dejar por omisión una cuenta del concepto',
      security: SEGURIDAD_SESION,
      params: esquemaParamCuenta,
      body: esquemaConceptoPagoCuentaEditar,
      response: { 200: esquemaConceptoPagoCuentaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarCuentaConcepto(
        sesion,
        request.params.id,
        request.params.idCuenta,
        request.body,
      );
    },
  });

  done();
};
