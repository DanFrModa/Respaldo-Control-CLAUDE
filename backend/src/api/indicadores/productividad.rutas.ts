/**
 * Rutas REST del MOTOR DE PRODUCTIVIDAD unificado IP/Almacén (Módulo Indicadores, F7-E4; doc 05
 * §A.1/§B.1). Handlers DELGADOS (A1): validan (Zod de `src/contrato`), autorizan (`conPermiso`/
 * `conAlgunPermiso`, A4) y delegan al dominio `dominio/indicadores/productividad.ts`. La CAPTURA de
 * cada área exige su permiso (`indicadores.ip-productividad` / `indicadores.almacen-productividad`);
 * la LECTURA, cualquiera de los dos. El dominio reaplica el permiso fino por área.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaActividadCrear,
  esquemaActividadEditar,
  esquemaActividadPagina,
  esquemaActividadQuery,
  esquemaActividadSalida,
  esquemaErrorApi,
  esquemaPersonalCrear,
  esquemaPersonalEditar,
  esquemaPersonalPagina,
  esquemaPersonalQuery,
  esquemaPersonalSalida,
  esquemaRegistroProductividadCancelar,
  esquemaRegistroProductividadCrear,
  esquemaRegistroProductividadPagina,
  esquemaRegistroProductividadQuery,
  esquemaRegistroProductividadSalida,
  esquemaTableroProductividad,
  esquemaTableroProductividadQuery,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarActividad,
  actualizarPersonal,
  cancelarRegistroProductividad,
  crearActividad,
  crearPersonal,
  listarActividades,
  listarPersonal,
  listarRegistrosProductividad,
  registrarProductividad,
  tableroProductividad,
} from '../../dominio/indicadores/productividad.js';

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

const esquemaParamId = z.object({
  id: z.coerce.number().int().positive().describe('Id.'),
});

/** Cuerpos de PATCH (el `id` viaja en la URL). */
const cuerpoPersonalPatch = esquemaPersonalEditar.omit({ id: true });
const cuerpoActividadPatch = esquemaActividadEditar.omit({ id: true });

/** Registra las rutas de productividad (montadas bajo `/api`). */
export const rutasProductividad: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) throw new Error('Ruta protegida sin sesión: falta el guard.');
    return sesion;
  };
  const captura = app.conAlgunPermiso(
    'indicadores.ip-productividad',
    'indicadores.almacen-productividad',
  );

  // ── Personal del área ──────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/indicadores/productividad/personal',
    preHandler: captura,
    schema: {
      tags: ['indicadores'],
      summary: 'Listar personal del área (productividad)',
      security: SEGURIDAD_SESION,
      querystring: esquemaPersonalQuery,
      response: { 200: esquemaPersonalPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarPersonal(sesion, request.query);
    },
  });

  app.route({
    method: 'POST',
    url: '/indicadores/productividad/personal',
    preHandler: captura,
    schema: {
      tags: ['indicadores'],
      summary: 'Crear una persona del área',
      security: SEGURIDAD_SESION,
      body: esquemaPersonalCrear,
      response: { 201: esquemaPersonalSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return reply.code(201).send(await crearPersonal(sesion, request.body));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/indicadores/productividad/personal/:id',
    preHandler: captura,
    schema: {
      tags: ['indicadores'],
      summary: 'Actualizar una persona del área',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: cuerpoPersonalPatch,
      response: { 200: esquemaPersonalSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarPersonal(sesion, { ...request.body, id: request.params.id });
    },
  });

  // ── Actividades ─────────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/indicadores/productividad/actividades',
    preHandler: captura,
    schema: {
      tags: ['indicadores'],
      summary: 'Listar actividades productivas',
      security: SEGURIDAD_SESION,
      querystring: esquemaActividadQuery,
      response: { 200: esquemaActividadPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarActividades(sesion, request.query);
    },
  });

  app.route({
    method: 'POST',
    url: '/indicadores/productividad/actividades',
    preHandler: captura,
    schema: {
      tags: ['indicadores'],
      summary: 'Crear una actividad productiva',
      security: SEGURIDAD_SESION,
      body: esquemaActividadCrear,
      response: { 201: esquemaActividadSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return reply.code(201).send(await crearActividad(sesion, request.body));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/indicadores/productividad/actividades/:id',
    preHandler: captura,
    schema: {
      tags: ['indicadores'],
      summary: 'Actualizar una actividad productiva',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: cuerpoActividadPatch,
      response: { 200: esquemaActividadSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarActividad(sesion, { ...request.body, id: request.params.id });
    },
  });

  // ── Registros diarios ────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/indicadores/productividad/registros',
    preHandler: captura,
    schema: {
      tags: ['indicadores'],
      summary: 'Listar registros de productividad (con índice calculado)',
      security: SEGURIDAD_SESION,
      querystring: esquemaRegistroProductividadQuery,
      response: { 200: esquemaRegistroProductividadPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarRegistrosProductividad(sesion, request.query);
    },
  });

  app.route({
    method: 'POST',
    url: '/indicadores/productividad/registros',
    preHandler: captura,
    schema: {
      tags: ['indicadores'],
      summary: 'Registrar productividad de un día (IP o almacén)',
      security: SEGURIDAD_SESION,
      body: esquemaRegistroProductividadCrear,
      response: { 201: esquemaRegistroProductividadSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return reply.code(201).send(await registrarProductividad(sesion, request.body));
    },
  });

  app.route({
    method: 'POST',
    url: '/indicadores/productividad/registros/:id/cancelar',
    preHandler: captura,
    schema: {
      tags: ['indicadores'],
      summary: 'Cancelar (suave) un registro de productividad',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaRegistroProductividadCancelar,
      response: { 200: esquemaRegistroProductividadSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarRegistroProductividad(sesion, request.params.id, request.body);
    },
  });

  // ── Tablero vs estándar (agregado en servidor) ──────────────────────────────────
  app.route({
    method: 'GET',
    url: '/indicadores/productividad/tablero',
    preHandler: captura,
    schema: {
      tags: ['indicadores'],
      summary: 'Tablero de productividad vs estándar (por periodo/actividad/persona)',
      security: SEGURIDAD_SESION,
      querystring: esquemaTableroProductividadQuery,
      response: { 200: esquemaTableroProductividad, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return tableroProductividad(sesion, request.query);
    },
  });

  done();
};
