/**
 * Rutas REST de MUESTRARIOS PENDIENTES (Módulo Indicadores, F7-E4; doc 05 §A.3). Handlers DELGADOS
 * (A1): validan (Zod de `src/contrato`), autorizan (`conPermiso('indicadores.ip-muestrarios')`, A4) y
 * delegan al dominio `dominio/indicadores/muestrarios.ts`. Solicitud → seguimiento → entrega, con KPI
 * de cumplimiento; cancelación suave con motivo (A7). A9 por empresa activa.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaMuestrarioCancelar,
  esquemaMuestrarioCrear,
  esquemaMuestrarioEditar,
  esquemaMuestrarioEntregar,
  esquemaMuestrarioSalida,
  esquemaMuestrariosCumplimiento,
  esquemaMuestrariosCumplimientoQuery,
  esquemaMuestrariosPagina,
  esquemaMuestrariosQuery,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarMuestrario,
  cancelarMuestrario,
  crearMuestrario,
  cumplimientoMuestrarios,
  entregarMuestrario,
  listarMuestrarios,
  obtenerMuestrario,
} from '../../dominio/indicadores/muestrarios.js';

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

const esquemaParamId = z.object({ id: z.coerce.number().int().positive() });

/** Registra las rutas de muestrarios (montadas bajo `/api`). */
export const rutasMuestrarios: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) throw new Error('Ruta protegida sin sesión: falta el guard.');
    return sesion;
  };
  const guard = app.conPermiso('indicadores.ip-muestrarios');

  app.route({
    method: 'GET',
    url: '/indicadores/muestrarios',
    preHandler: guard,
    schema: {
      tags: ['indicadores'],
      summary: 'Listar muestrarios (con estado y cumplimiento)',
      security: SEGURIDAD_SESION,
      querystring: esquemaMuestrariosQuery,
      response: { 200: esquemaMuestrariosPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarMuestrarios(sesion, request.query);
    },
  });

  app.route({
    method: 'GET',
    url: '/indicadores/muestrarios/cumplimiento',
    preHandler: guard,
    schema: {
      tags: ['indicadores'],
      summary: 'KPI de cumplimiento de muestrarios',
      security: SEGURIDAD_SESION,
      querystring: esquemaMuestrariosCumplimientoQuery,
      response: { 200: esquemaMuestrariosCumplimiento, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cumplimientoMuestrarios(sesion, request.query);
    },
  });

  app.route({
    method: 'GET',
    url: '/indicadores/muestrarios/:id',
    preHandler: guard,
    schema: {
      tags: ['indicadores'],
      summary: 'Obtener un muestrario',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaMuestrarioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerMuestrario(sesion, request.params.id);
    },
  });

  app.route({
    method: 'POST',
    url: '/indicadores/muestrarios',
    preHandler: guard,
    schema: {
      tags: ['indicadores'],
      summary: 'Solicitar (crear) un muestrario',
      security: SEGURIDAD_SESION,
      body: esquemaMuestrarioCrear,
      response: { 201: esquemaMuestrarioSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return reply.code(201).send(await crearMuestrario(sesion, request.body));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/indicadores/muestrarios/:id',
    preHandler: guard,
    schema: {
      tags: ['indicadores'],
      summary: 'Actualizar el seguimiento de un muestrario',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaMuestrarioEditar,
      response: { 200: esquemaMuestrarioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarMuestrario(sesion, request.params.id, request.body);
    },
  });

  app.route({
    method: 'POST',
    url: '/indicadores/muestrarios/:id/entregar',
    preHandler: guard,
    schema: {
      tags: ['indicadores'],
      summary: 'Registrar la entrega de un muestrario',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaMuestrarioEntregar,
      response: { 200: esquemaMuestrarioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return entregarMuestrario(sesion, request.params.id, request.body);
    },
  });

  app.route({
    method: 'POST',
    url: '/indicadores/muestrarios/:id/cancelar',
    preHandler: guard,
    schema: {
      tags: ['indicadores'],
      summary: 'Cancelar (suave) un muestrario',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaMuestrarioCancelar,
      response: { 200: esquemaMuestrarioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarMuestrario(sesion, request.params.id, request.body);
    },
  });

  done();
};
