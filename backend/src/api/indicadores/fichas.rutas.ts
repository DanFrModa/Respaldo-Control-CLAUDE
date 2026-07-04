/**
 * Rutas REST de FICHAS CONFIABLES (Módulo Indicadores, F7-E4; doc 05 §A.2). Handlers DELGADOS (A1):
 * validan (Zod de `src/contrato`), autorizan (`conPermiso('indicadores.ip-confiabilidad')`, A4) y
 * delegan al dominio `dominio/indicadores/fichas.ts`. El checklist se modela por FILAS (reactivo ×
 * orden, A6); el indicador "% de fichas confiables" lo agrega el dominio en SQL.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaFichaOrdenSalida,
  esquemaFichasConfiables,
  esquemaFichasConfiablesQuery,
  esquemaReactivoFichaCrear,
  esquemaReactivoFichaEditar,
  esquemaReactivoFichaSalida,
  esquemaReactivosFichaLista,
  esquemaReactivosFichaQuery,
  esquemaVerificarFichaOrden,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarReactivoFicha,
  crearReactivoFicha,
  fichasConfiables,
  listarReactivosFicha,
  obtenerFichaOrden,
  verificarFichaOrden,
} from '../../dominio/indicadores/fichas.js';

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

const esquemaParamId = z.object({ id: z.coerce.number().int().positive() });
const esquemaParamOrden = z.object({ idOrden: z.coerce.number().int().positive() });
const cuerpoReactivoPatch = esquemaReactivoFichaEditar.omit({ id: true });

/** Registra las rutas de fichas confiables (montadas bajo `/api`). */
export const rutasFichas: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) throw new Error('Ruta protegida sin sesión: falta el guard.');
    return sesion;
  };
  const guard = app.conPermiso('indicadores.ip-confiabilidad');

  // ── Catálogo de reactivos ──────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/indicadores/fichas/reactivos',
    preHandler: guard,
    schema: {
      tags: ['indicadores'],
      summary: 'Listar los reactivos del checklist de confiabilidad',
      security: SEGURIDAD_SESION,
      querystring: esquemaReactivosFichaQuery,
      response: { 200: esquemaReactivosFichaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarReactivosFicha(sesion, request.query);
    },
  });

  app.route({
    method: 'POST',
    url: '/indicadores/fichas/reactivos',
    preHandler: guard,
    schema: {
      tags: ['indicadores'],
      summary: 'Crear un reactivo del checklist',
      security: SEGURIDAD_SESION,
      body: esquemaReactivoFichaCrear,
      response: { 201: esquemaReactivoFichaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return reply.code(201).send(await crearReactivoFicha(sesion, request.body));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/indicadores/fichas/reactivos/:id',
    preHandler: guard,
    schema: {
      tags: ['indicadores'],
      summary: 'Actualizar un reactivo del checklist',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: cuerpoReactivoPatch,
      response: { 200: esquemaReactivoFichaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarReactivoFicha(sesion, { ...request.body, id: request.params.id });
    },
  });

  // ── Checklist por orden ────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/indicadores/fichas/ordenes/:idOrden',
    preHandler: guard,
    schema: {
      tags: ['indicadores'],
      summary: 'Obtener el checklist de confiabilidad de una orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrden,
      response: { 200: esquemaFichaOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerFichaOrden(sesion, request.params.idOrden);
    },
  });

  app.route({
    method: 'PUT',
    url: '/indicadores/fichas/ordenes/:idOrden',
    preHandler: guard,
    schema: {
      tags: ['indicadores'],
      summary: 'Guardar (upsert) el checklist de confiabilidad de una orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrden,
      body: esquemaVerificarFichaOrden,
      response: { 200: esquemaFichaOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return verificarFichaOrden(sesion, request.params.idOrden, request.body);
    },
  });

  // ── Indicador agregado ─────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/indicadores/fichas/confiables',
    preHandler: guard,
    schema: {
      tags: ['indicadores'],
      summary: 'Indicador de % de fichas confiables (global + por orden)',
      security: SEGURIDAD_SESION,
      querystring: esquemaFichasConfiablesQuery,
      response: { 200: esquemaFichasConfiables, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return fichasConfiables(sesion, request.query);
    },
  });

  done();
};
