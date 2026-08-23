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
  esquemaAuditoriaCancelarCuerpo,
  esquemaAuditoriaContexto,
  esquemaAuditoriaCrear,
  esquemaAuditoriaModificarCuerpo,
  esquemaAuditoriaResultadoCuerpo,
  esquemaAuditoriaSalida,
  esquemaAuditoriasPagina,
  esquemaAuditoriasQuery,
  esquemaErrorApi,
  esquemaHistorialMaquileroQuery,
  esquemaHistorialMaquileroSalida,
  esquemaReclasificacionCuerpo,
  esquemaResumenAuditorias,
  esquemaResumenAuditoriasQuery,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import {
  cancelarAuditoria,
  capturarResultado,
  crearAuditoria,
  historialPorMaquilero,
  listarAuditorias,
  modificarAuditoria,
  obtenerAuditoria,
  obtenerContextoOrden,
  reclasificar,
  resumenAuditorias,
} from '../../dominio/calidad/auditorias.js';
import { impresoAuditoria } from '../../dominio/calidad/impresos/impreso-auditoria.js';
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

const esquemaParamIdMaquilero = z.object({
  idMaquilero: z.coerce
    .number({ error: 'El id del maquilero debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del maquilero.'),
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

  // ── Listado paginado + filtros (consulta, F6-E3) ─────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/calidad/auditorias',
    preHandler: app.conPermiso('calidad.ver'),
    schema: {
      tags: ['calidad'],
      summary: 'Listar auditorías (paginado + filtros por orden/maquilero/resultado/tipo/fechas)',
      security: SEGURIDAD_SESION,
      querystring: esquemaAuditoriasQuery,
      response: { 200: esquemaAuditoriasPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarAuditorias(sesion, request.query);
    },
  });

  // ── Resumen de cabecera (KPIs vCalidad, R9): defecto principal del conjunto filtrado ─────────────
  // Ruta ESTÁTICA (declarada antes de la paramétrica `/:id`; Fastify prioriza estáticas). `calidad.ver`.
  app.route({
    method: 'GET',
    url: '/calidad/auditorias/resumen',
    preHandler: app.conPermiso('calidad.ver'),
    schema: {
      tags: ['calidad'],
      summary: 'Resumen de cabecera de auditorías (defecto principal del conjunto filtrado)',
      security: SEGURIDAD_SESION,
      querystring: esquemaResumenAuditoriasQuery,
      response: { 200: esquemaResumenAuditorias, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return resumenAuditorias(sesion, request.query);
    },
  });

  // ── Historial por maquilero (+ % de aprobación operativo, F6-E3) ─────────────────────────────────
  app.route({
    method: 'GET',
    url: '/calidad/auditorias/maquilero/:idMaquilero',
    preHandler: app.conPermiso('calidad.ver'),
    schema: {
      tags: ['calidad'],
      summary: 'Historial de auditorías de un maquilero con su % de aprobación operativo',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdMaquilero,
      querystring: esquemaHistorialMaquileroQuery,
      response: { 200: esquemaHistorialMaquileroSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return historialPorMaquilero(sesion, {
        idMaquilero: request.params.idMaquilero,
        ...request.query,
      });
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

  // ── Modificar datos de ENCABEZADO (F6-E3) ────────────────────────────────────────────────────────
  app.route({
    method: 'PATCH',
    url: '/calidad/auditorias/:id',
    preHandler: app.conPermiso('calidad.modificar-auditorias'),
    schema: {
      tags: ['calidad'],
      summary: 'Modificar los datos de encabezado de una auditoría (no toca las fallas)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaAuditoriaModificarCuerpo,
      response: { 200: esquemaAuditoriaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return modificarAuditoria(sesion, request.params.id, request.body);
    },
  });

  // ── Cancelación (borrado suave + motivo, F6-E3) ──────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/calidad/auditorias/:id/cancelacion',
    preHandler: app.conPermiso('calidad.modificar-auditorias'),
    schema: {
      tags: ['calidad'],
      summary: 'Cancelar una auditoría (borrado suave con motivo; des-completa la RC)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaAuditoriaCancelarCuerpo,
      response: { 200: esquemaAuditoriaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarAuditoria(sesion, request.params.id, request.body);
    },
  });

  // ── Impreso (binario application/pdf; solo se documentan los errores) ─────────────────────────────
  app.route({
    method: 'GET',
    url: '/calidad/auditorias/:id/impreso',
    preHandler: app.conPermiso('calidad.ver'),
    schema: {
      tags: ['calidad'],
      summary: 'Impreso de una auditoría de calidad (PDF)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await impresoAuditoria(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="auditoria-${String(folio)}.pdf"`);
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
