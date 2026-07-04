/**
 * Rutas REST de los PLANES DE MUESTREO AQL (F6-E1). CRUD con renglones (`calidad.administrar-catalogo`
 * para mutar, `calidad.ver` para leer) + un GET de resolución/preview (lote+nivel → muestra/límites)
 * que solo necesita `calidad.ver`. Rutas delgadas (A1): validan, autorizan y delegan al servicio de
 * dominio `dominio/calidad/planes-aql`. Montadas bajo `/api`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaPlanAqlCrear,
  esquemaPlanAqlEditar,
  esquemaPlanAqlSalida,
  esquemaPlanesAqlPagina,
  esquemaPlanesAqlQuery,
  esquemaResolverPlanQuery,
  esquemaResolverPlanSalida,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarPlanAql,
  crearPlanAql,
  desactivarPlanAql,
  listarPlanesAql,
  obtenerPlanAql,
  resolverPlan,
  type PlanConRenglones,
} from '../../dominio/calidad/planes-aql.js';

/** Proyecta el plan (con renglones/límites) a la forma JSON del contrato (Decimal→número, ISO). */
function aSalida(plan: PlanConRenglones): z.infer<typeof esquemaPlanAqlSalida> {
  return {
    id: plan.id,
    nombre: plan.nombre,
    activo: plan.activo,
    renglones: plan.renglones.map((r) => ({
      id: r.id,
      loteMin: r.loteMin,
      loteMax: r.loteMax,
      tamanoMuestra: r.tamanoMuestra,
      limites: r.limites.map((l) => ({
        nivelAQL: l.nivelAQL.toNumber(),
        aceptar: l.aceptar,
        rechazar: l.rechazar,
      })),
    })),
    creadoEn: plan.creadoEn.toISOString(),
    creadoPorId: plan.creadoPorId,
    modificadoEn: plan.modificadoEn.toISOString(),
    modificadoPorId: plan.modificadoPorId,
  };
}

const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del plan debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del plan AQL.'),
});

const esquemaPatchCuerpo = esquemaPlanAqlEditar.omit({ id: true });

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

export const rutasPlanesAql: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Resolución / preview: lote + nivel → muestra y límites del plan default activo ──────────────
  app.route({
    method: 'GET',
    url: '/calidad/planes-aql/resolver',
    preHandler: app.conPermiso('calidad.ver'),
    schema: {
      tags: ['calidad'],
      summary: 'Resolver muestra y límites del plan AQL default para (lote, nivel)',
      security: SEGURIDAD_SESION,
      querystring: esquemaResolverPlanQuery,
      response: { 200: esquemaResolverPlanSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return resolverPlan(sesion, request.query);
    },
  });

  app.route({
    method: 'GET',
    url: '/calidad/planes-aql',
    preHandler: app.conPermiso('calidad.ver'),
    schema: {
      tags: ['calidad'],
      summary: 'Listar planes de muestreo AQL',
      security: SEGURIDAD_SESION,
      querystring: esquemaPlanesAqlQuery,
      response: { 200: esquemaPlanesAqlPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarPlanesAql(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aSalida) };
    },
  });

  app.route({
    method: 'GET',
    url: '/calidad/planes-aql/:id',
    preHandler: app.conPermiso('calidad.ver'),
    schema: {
      tags: ['calidad'],
      summary: 'Obtener un plan AQL con sus renglones',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaPlanAqlSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aSalida(await obtenerPlanAql(sesion, request.params.id));
    },
  });

  app.route({
    method: 'POST',
    url: '/calidad/planes-aql',
    preHandler: app.conPermiso('calidad.administrar-catalogo'),
    schema: {
      tags: ['calidad'],
      summary: 'Crear un plan AQL con sus renglones',
      security: SEGURIDAD_SESION,
      body: esquemaPlanAqlCrear,
      response: { 201: esquemaPlanAqlSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const plan = await crearPlanAql(sesion, request.body);
      return reply.code(201).send(aSalida(plan));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/calidad/planes-aql/:id',
    preHandler: app.conPermiso('calidad.administrar-catalogo'),
    schema: {
      tags: ['calidad'],
      summary: 'Actualizar un plan AQL (reemplaza renglones si vienen)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaPatchCuerpo,
      response: { 200: esquemaPlanAqlSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const plan = await actualizarPlanAql(sesion, { ...request.body, id: request.params.id });
      return aSalida(plan);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/calidad/planes-aql/:id',
    preHandler: app.conPermiso('calidad.administrar-catalogo'),
    schema: {
      tags: ['calidad'],
      summary: 'Desactivar un plan AQL (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaPlanAqlSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aSalida(await desactivarPlanAql(sesion, request.params.id));
    },
  });

  done();
};
