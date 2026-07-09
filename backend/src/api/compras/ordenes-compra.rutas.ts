/**
 * Rutas REST del Módulo ÓRDENES DE COMPRA (F4-E2). Calca el ESTÁNDAR de las rutas de
 * Órdenes/Pedidos: cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `compras.ver` para leer, `compras.administrar` para mutar/duplicar,
 *     `compras.autorizar` para autorizar, `compras.cancelar` para cancelar.
 *  3. **Delega** a los servicios de dominio (`dominio/compras/ordenes-compra.ts`).
 *
 * Endpoints: `GET /ordenes-compra` (listado/filtros), `GET /ordenes-compra/:id`,
 * `GET /ordenes-compra/:id/impreso` (PDF binario), `POST /ordenes-compra` (crear borrador),
 * `PATCH /ordenes-compra/:id` (encabezado + líneas; el dominio aplica la regla admin/autorizada),
 * `POST /ordenes-compra/:id/autorizar`, `POST /ordenes-compra/:id/cancelar` (motivo obligatorio),
 * `POST /ordenes-compra/:id/duplicar`. El impreso es binario (`application/pdf`); el frontend solo
 * abre el blob (los impresos del proyecto son server-side).
 *
 * CERO lógica de negocio o acceso a datos aquí; los errores de dominio los traduce el error
 * handler global (`src/api/errores.ts`).
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasOrdenesCompra, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaCompraCancelarCuerpo,
  esquemaCompraCrear,
  esquemaCompraEditarCuerpo,
  esquemaCompraSalida,
  esquemaComprasPagina,
  esquemaErrorApi,
  esquemaListarCompras,
  esquemaResumenCompras,
  esquemaResumenComprasQuery,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarOC,
  autorizarOC,
  cancelarOC,
  crearOC,
  duplicarOC,
  listarOC,
  obtenerOC,
  resumenOC,
} from '../../dominio/compras/ordenes-compra.js';
import { impresoOrdenCompra } from '../../dominio/compras/impresos/impreso-orden-compra.js';

/** Parámetro de ruta `:id` (orden de compra). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la orden de compra debe ser un número' })
    .int({ error: 'El id de la orden de compra debe ser entero' })
    .positive({ error: 'El id de la orden de compra debe ser positivo' })
    .describe('Id de la orden de compra.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de órdenes de compra (montadas bajo `/api`). */
export const rutasOrdenesCompra: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Listar (búsqueda folio/proveedor + filtros + orden + paginación).
  app.route({
    method: 'GET',
    url: '/ordenes-compra',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Listar órdenes de compra',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarCompras,
      response: { 200: esquemaComprasPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarOC(sesion, request.query);
    },
  });

  // Resumen de cabecera (KPIs vCompras, R9): # OC abiertas + $ por recibir, sobre el mismo filtro.
  // Ruta ESTÁTICA antes de la paramétrica `/:id` (Fastify prioriza estáticas; se declara antes por
  // claridad). Reúsa `compras.ver`.
  app.route({
    method: 'GET',
    url: '/ordenes-compra/resumen',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Resumen de cabecera de órdenes de compra (OC abiertas + $ por recibir)',
      security: SEGURIDAD_SESION,
      querystring: esquemaResumenComprasQuery,
      response: { 200: esquemaResumenCompras, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return resumenOC(sesion, request.query);
    },
  });

  // Obtener una (con líneas, matriz, órdenes ligadas y total derivado).
  app.route({
    method: 'GET',
    url: '/ordenes-compra/:id',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Obtener una orden de compra',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaCompraSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerOC(sesion, request.params.id);
    },
  });

  // Impreso (PDF) de una OC. Respuesta BINARIA (application/pdf); el frontend solo abre el blob.
  app.route({
    method: 'GET',
    url: '/ordenes-compra/:id/impreso',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Imprimir una orden de compra (PDF)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      // La respuesta 200 es binaria (application/pdf); solo se documentan los errores.
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, numCompra } = await impresoOrdenCompra(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="orden-compra-${numCompra}.pdf"`);
      // La respuesta es binaria (no JSON): Fastify envía el Buffer tal cual. El tipo del `send` lo
      // infiere el type-provider de las respuestas DECLARADAS (solo errores), por eso el cast.
      return reply.send(buffer as unknown as never);
    },
  });

  // Crear (borrador).
  app.route({
    method: 'POST',
    url: '/ordenes-compra',
    preHandler: app.conPermiso('compras.administrar'),
    schema: {
      tags: ['compras'],
      summary: 'Crear una orden de compra (borrador)',
      security: SEGURIDAD_SESION,
      body: esquemaCompraCrear,
      response: { 201: esquemaCompraSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const oc = await crearOC(sesion, request.body);
      return reply.code(201).send(oc);
    },
  });

  // Actualizar encabezado + líneas (el dominio aplica la regla admin/autorizada, decisión (a)).
  app.route({
    method: 'PATCH',
    url: '/ordenes-compra/:id',
    preHandler: app.conPermiso('compras.administrar'),
    schema: {
      tags: ['compras'],
      summary: 'Actualizar una orden de compra (encabezado y líneas)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaCompraEditarCuerpo,
      response: { 200: esquemaCompraSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarOC(sesion, request.params.id, request.body);
    },
  });

  // Autorizar (permiso PROPIO).
  app.route({
    method: 'POST',
    url: '/ordenes-compra/:id/autorizar',
    preHandler: app.conPermiso('compras.autorizar'),
    schema: {
      tags: ['compras'],
      summary: 'Autorizar una orden de compra',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaCompraSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return autorizarOC(sesion, request.params.id);
    },
  });

  // Cancelar (cancelación suave; motivo obligatorio). Permiso PROPIO.
  app.route({
    method: 'POST',
    url: '/ordenes-compra/:id/cancelar',
    preHandler: app.conPermiso('compras.cancelar'),
    schema: {
      tags: ['compras'],
      summary: 'Cancelar una orden de compra (cancelación suave, motivo obligatorio)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaCompraCancelarCuerpo,
      response: { 200: esquemaCompraSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarOC(sesion, request.params.id, request.body);
    },
  });

  // Duplicar a una nueva OC en borrador (para todos con administrar).
  app.route({
    method: 'POST',
    url: '/ordenes-compra/:id/duplicar',
    preHandler: app.conPermiso('compras.administrar'),
    schema: {
      tags: ['compras'],
      summary: 'Duplicar una orden de compra a un borrador nuevo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 201: esquemaCompraSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const oc = await duplicarOC(sesion, request.params.id);
      return reply.code(201).send(oc);
    },
  });

  done();
};
