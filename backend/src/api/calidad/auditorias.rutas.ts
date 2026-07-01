/**
 * Rutas REST del NÚCLEO de AUDITORÍAS de calidad (F6-E2). Alta + captura de resultados + reclasificación
 * + los GET mínimos para las pantallas (detalle de una auditoría con su sugerencia, contexto de la orden
 * para el alta). RBAC por ruta (A4, deny-by-default): `calidad.generar-auditorias` gobierna el alta y el
 * contexto; `calidad.actualizar-auditorias` la captura y la reclasificación; `calidad.ver` el detalle.
 * Rutas DELGADAS (A1): validan, autorizan y delegan al servicio de dominio `dominio/calidad/auditorias`.
 * Montadas bajo `/api`. (La consulta/listado general, impresión PDF y modificar/cancelar son F6-E3.)
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaAuditoriaContexto,
  esquemaAuditoriaCrear,
  esquemaAuditoriaResultadoCuerpo,
  esquemaAuditoriaSalida,
  esquemaErrorApi,
  esquemaReclasificacionCuerpo,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import {
  capturarResultado,
  crearAuditoria,
  obtenerAuditoria,
  obtenerContextoOrden,
  reclasificar,
} from '../../dominio/calidad/auditorias.js';
import { SEGURIDAD_SESION } from '../../openapi.js';

const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la auditoría debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id de la auditoría.'),
});

const esquemaParamIdOrden = z.object({
  idOrden: z.coerce
    .number({ error: 'El id de la orden debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id de la orden.'),
});

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

export const rutasAuditorias: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Contexto de la orden para el alta (cantidad + maquileros + muestra) ──────────────────────────
  app.route({
    method: 'GET',
    url: '/calidad/auditorias/orden/:idOrden/contexto',
    preHandler: app.conPermiso('calidad.generar-auditorias'),
    schema: {
      tags: ['calidad'],
      summary:
        'Contexto de una orden para dar de alta su auditoría (cantidad, maquileros, muestra)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdOrden,
      response: { 200: esquemaAuditoriaContexto, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerContextoOrden(sesion, request.params.idOrden);
    },
  });

  // ── Detalle de una auditoría (con su sugerencia AQL) ─────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/calidad/auditorias/:id',
    preHandler: app.conPermiso('calidad.ver'),
    schema: {
      tags: ['calidad'],
      summary: 'Obtener una auditoría con sus renglones y la sugerencia AQL',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaAuditoriaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerAuditoria(sesion, request.params.id);
    },
  });

  // ── Alta de auditoría ────────────────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/calidad/auditorias',
    preHandler: app.conPermiso('calidad.generar-auditorias'),
    schema: {
      tags: ['calidad'],
      summary: 'Dar de alta una auditoría de calidad (folio, muestra y favoritos automáticos)',
      security: SEGURIDAD_SESION,
      body: esquemaAuditoriaCrear,
      response: { 201: esquemaAuditoriaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const auditoria = await crearAuditoria(sesion, request.body);
      return reply.code(201).send(auditoria);
    },
  });

  // ── Captura de resultados (resultado MANUAL + fallas por defecto) ────────────────────────────────
  app.route({
    method: 'PATCH',
    url: '/calidad/auditorias/:id/resultado',
    preHandler: app.conPermiso('calidad.actualizar-auditorias'),
    schema: {
      tags: ['calidad'],
      summary: 'Capturar el resultado de una auditoría (veredicto manual + fallas por defecto)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaAuditoriaResultadoCuerpo,
      response: { 200: esquemaAuditoriaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return capturarResultado(sesion, request.params.id, request.body);
    },
  });

  // ── Reclasificación Primeras↔Segundas (traspaso de kardex) ───────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/calidad/auditorias/:id/reclasificacion',
    preHandler: app.conPermiso('calidad.actualizar-auditorias'),
    schema: {
      tags: ['calidad'],
      summary: 'Reclasificar prendas Primeras↔Segundas tras la auditoría (traspaso de kardex)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaReclasificacionCuerpo,
      response: { 200: esquemaAuditoriaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return reclasificar(sesion, request.params.id, request.body);
    },
  });

  done();
};
