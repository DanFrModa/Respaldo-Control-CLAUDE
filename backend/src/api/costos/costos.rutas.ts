/**
 * Rutas REST del MOTOR DE COSTEO (Módulo 6, F7-E1; doc 06-Costos-y-EDR). Handlers DELGADOS (A1):
 * validan (Zod de `src/contrato`), autorizan (`conPermiso`, A4) y delegan al dominio `dominio/costos/*`.
 * Toda la lógica (fórmulas, ocultamiento de importes, base de prorrateo, rechazo de `noCostear`) vive
 * en el dominio.
 *
 * Endpoints (todos por la empresa activa de la sesión = A9):
 *  • `GET  /costos/pre-costo/:idModelo`      (`precostos.consultar`) → pre-costo estimado del modelo.
 *  • `GET  /costos/lista-precios`            (`precostos.consultar`) → lista de precios sugeridos.
 *  • `GET  /costos/lista-precios/impreso`    (`precostos.consultar`) → lista de precios en PDF (R9).
 *  • `GET  /costos/ordenes`                  (`costos.ver`)          → lista de órdenes costeadas.
 *  • `GET  /costos/ordenes/:idOrden`         (`costos.ver`)          → costo de una orden (teórico+guardado).
 *  • `PUT  /costos/ordenes/:idOrden`         (`costos.capturar`)     → guarda/ajusta el costo de una orden.
 *  • `GET  /costos/margenes-por-pedido`      (`costos.ver`)          → costos y márgenes por pedido.
 *  • `GET  /costos/margenes-por-pedido/impreso` (`costos.ver`)       → márgenes en PDF (R9).
 *  • `GET  /costos/margenes-por-pedido/excel`   (`costos.ver`)       → márgenes en Excel.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaCostoOrdenGuardarCuerpo,
  esquemaCostoOrdenSalida,
  esquemaErrorApi,
  esquemaListaCostosPagina,
  esquemaListaCostosQuery,
  esquemaListaPreciosQuery,
  esquemaListaPreciosSalida,
  esquemaMargenesQuery,
  esquemaMargenesSalida,
  esquemaPreCostoModelo,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { calcularPreCosto, listaPrecios } from '../../dominio/costos/pre-costo.js';
import {
  guardarCostoOrden,
  listarCostos,
  obtenerCostoOrden,
} from '../../dominio/costos/costo-orden.js';
import { margenesPorPedido } from '../../dominio/costos/margenes.js';
import { impresoListaPrecios } from '../../dominio/costos/impresos/impreso-lista-precios.js';
import { impresoMargenes } from '../../dominio/costos/impresos/impreso-margenes.js';
import { excelMargenes } from '../../dominio/costos/impresos/excel-margenes.js';

/** Parámetro de ruta `:idModelo`. */
const esquemaParamModelo = z.object({
  idModelo: z.coerce.number().int().positive().describe('Id del modelo.'),
});

/** Parámetro de ruta `:idOrden`. */
const esquemaParamOrden = z.object({
  idOrden: z.coerce.number().int().positive().describe('Id de la orden.'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de costos (montadas bajo `/api`). */
export const rutasCostos: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Pre-costo por modelo ─────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/costos/pre-costo/:idModelo',
    preHandler: app.conPermiso('precostos.consultar'),
    schema: {
      tags: ['costos'],
      summary: 'Pre-costo estimado de un modelo (receta × catálogo + maquila)',
      security: SEGURIDAD_SESION,
      params: esquemaParamModelo,
      response: { 200: esquemaPreCostoModelo, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return calcularPreCosto(sesion, request.params.idModelo);
    },
  });

  // ── Lista de precios ─────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/costos/lista-precios',
    preHandler: app.conPermiso('precostos.consultar'),
    schema: {
      tags: ['costos'],
      summary: 'Lista de precios sugeridos por modelo (parametrizada)',
      security: SEGURIDAD_SESION,
      querystring: esquemaListaPreciosQuery,
      response: { 200: esquemaListaPreciosSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listaPrecios(sesion, request.query);
    },
  });

  app.route({
    method: 'GET',
    url: '/costos/lista-precios/impreso',
    preHandler: app.conPermiso('precostos.consultar'),
    schema: {
      tags: ['costos'],
      summary: 'Lista de precios en PDF (R9)',
      security: SEGURIDAD_SESION,
      querystring: esquemaListaPreciosQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await impresoListaPrecios(sesion, request.query);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'inline; filename="lista-precios.pdf"');
      return reply.send(buffer as unknown as never);
    },
  });

  // ── Lista de costos (órdenes costeadas) ──────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/costos/ordenes',
    preHandler: app.conPermiso('costos.ver'),
    schema: {
      tags: ['costos'],
      summary: 'Lista de órdenes costeadas (con costo total y unitario)',
      security: SEGURIDAD_SESION,
      querystring: esquemaListaCostosQuery,
      response: { 200: esquemaListaCostosPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarCostos(sesion, request.query);
    },
  });

  // ── Costo de una orden: obtener + guardar ────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/costos/ordenes/:idOrden',
    preHandler: app.conPermiso('costos.ver'),
    schema: {
      tags: ['costos'],
      summary: 'Costo de una orden (teórico + guardado + unitario)',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrden,
      response: { 200: esquemaCostoOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerCostoOrden(sesion, request.params.idOrden);
    },
  });

  app.route({
    method: 'PUT',
    url: '/costos/ordenes/:idOrden',
    preHandler: app.conPermiso('costos.capturar'),
    schema: {
      tags: ['costos'],
      summary: 'Guardar o ajustar el costo de una orden (rechaza si es noCostear)',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrden,
      body: esquemaCostoOrdenGuardarCuerpo,
      response: { 200: esquemaCostoOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return guardarCostoOrden(sesion, request.params.idOrden, request.body);
    },
  });

  // ── Costos y márgenes por pedido ─────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/costos/margenes-por-pedido',
    preHandler: app.conPermiso('costos.ver'),
    schema: {
      tags: ['costos'],
      summary: 'Costos y márgenes por pedido (fórmula D2)',
      security: SEGURIDAD_SESION,
      querystring: esquemaMargenesQuery,
      response: { 200: esquemaMargenesSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return margenesPorPedido(sesion, request.query);
    },
  });

  app.route({
    method: 'GET',
    url: '/costos/margenes-por-pedido/impreso',
    preHandler: app.conPermiso('costos.ver'),
    schema: {
      tags: ['costos'],
      summary: 'Costos y márgenes por pedido en PDF (R9)',
      security: SEGURIDAD_SESION,
      querystring: esquemaMargenesQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await impresoMargenes(sesion, request.query);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'inline; filename="margenes-por-pedido.pdf"');
      return reply.send(buffer as unknown as never);
    },
  });

  app.route({
    method: 'GET',
    url: '/costos/margenes-por-pedido/excel',
    preHandler: app.conPermiso('costos.ver'),
    schema: {
      tags: ['costos'],
      summary: 'Costos y márgenes por pedido en Excel (.xlsx)',
      security: SEGURIDAD_SESION,
      querystring: esquemaMargenesQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await excelMargenes(sesion, request.query);
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="margenes-por-pedido.xlsx"');
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
