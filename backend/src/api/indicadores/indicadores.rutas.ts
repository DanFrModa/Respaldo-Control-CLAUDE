/**
 * Rutas REST de los TABLEROS DIRECTIVOS de indicadores (Módulo Indicadores, F7-E3; plan §11). Handlers
 * DELGADOS (A1): validan (Zod de `src/contrato`), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/indicadores/*`. Toda la lógica (SQL sobre las vistas materializadas, agregación, sello
 * "datos al:", A9) vive en el dominio. La CAPTURA nunca espera un recálculo (plan §11): el refresco es
 * un job en segundo plano y `POST /indicadores/refrescar` solo lo ENCOLA.
 *
 * Endpoints (todos por la empresa activa de la sesión = A9; todos exigen `indicadores.ver`):
 *  • `GET  /indicadores/rc`                     → KPIs de Ruta Crítica (D11).
 *  • `GET  /indicadores/rc/impreso`             → tablero RC en PDF (R9).
 *  • `GET  /indicadores/rc/excel`               → tablero RC en Excel.
 *  • `GET  /indicadores/calidad-maquileros`     → calidad por maquilero (F6).
 *  • `GET  /indicadores/calidad-maquileros/impreso` / `.../excel` → PDF / Excel.
 *  • `GET  /indicadores/wip`                     → WIP analítico (F3).
 *  • `GET  /indicadores/wip/impreso` / `.../excel` → PDF / Excel.
 *  • `POST /indicadores/refrescar`              → encola el refresco de las vistas (regresa de inmediato).
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaKpisCalidad,
  esquemaKpisCalidadQuery,
  esquemaKpisRc,
  esquemaKpisRcQuery,
  esquemaKpisWip,
  esquemaKpisWipQuery,
  esquemaRefrescoEncolado,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  encolarRefrescoKpis,
  kpisCalidadMaquilero,
  kpisRutaCritica,
  kpisWip,
} from '../../dominio/indicadores/kpis.js';
import {
  impresoKpisRc,
  impresoKpisCalidad,
  impresoKpisWip,
} from '../../dominio/indicadores/impresos/pdf.js';
import {
  excelKpisRc,
  excelKpisCalidad,
  excelKpisWip,
} from '../../dominio/indicadores/impresos/excel.js';

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Registra las rutas de indicadores (montadas bajo `/api`). */
export const rutasIndicadores: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Ruta Crítica ─────────────────────────────────────────────────────────────
  // ⭐ V1-E3t: estos tres endpoints piden LAS DOS llaves (`conTodosPermisos`) — son un tablero
  // directivo (`indicadores.ver`) SOBRE datos de la Ruta Crítica (`rc.ruta-ver`). Antes solo pedían
  // la primera, y es UNA DE LAS DOS superficies de RC que no cuelgan de un permiso `rc.*` (la otra
  // es el mosaico «Entregas a tiempo» de `GET /api/resumen`, misma vista, misma corrección): con el
  // módulo apagado (§Post-F9.36 punto 1) habría quedado un tablero de ceros vivo en el menú. Con RC
  // ENCENDIDA no cambia nada para nadie: `rc.ruta-ver` cascadea a todos los roles de sistema salvo
  // `Basico`, que tampoco tiene `indicadores.ver`.
  const guardKpisRc = app.conTodosPermisos('indicadores.ver', 'rc.ruta-ver');

  app.route({
    method: 'GET',
    url: '/indicadores/rc',
    preHandler: guardKpisRc,
    schema: {
      tags: ['indicadores'],
      summary: 'KPIs de la Ruta Crítica (entregas a tiempo, lead time, cuellos, desempeño)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKpisRcQuery,
      response: { 200: esquemaKpisRc, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return kpisRutaCritica(sesion, request.query);
    },
  });

  app.route({
    method: 'GET',
    url: '/indicadores/rc/impreso',
    preHandler: guardKpisRc,
    schema: {
      tags: ['indicadores'],
      summary: 'Tablero de KPIs de Ruta Crítica en PDF (R9)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKpisRcQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await impresoKpisRc(sesion, request.query);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'inline; filename="indicadores-ruta-critica.pdf"');
      return reply.send(buffer as unknown as never);
    },
  });

  app.route({
    method: 'GET',
    url: '/indicadores/rc/excel',
    preHandler: guardKpisRc,
    schema: {
      tags: ['indicadores'],
      summary: 'Tablero de KPIs de Ruta Crítica en Excel (.xlsx)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKpisRcQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await excelKpisRc(sesion, request.query);
      reply
        .header('Content-Type', XLSX)
        .header('Content-Disposition', 'attachment; filename="indicadores-ruta-critica.xlsx"');
      return reply.send(buffer as unknown as never);
    },
  });

  // ── Calidad por maquilero ──────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/indicadores/calidad-maquileros',
    preHandler: app.conPermiso('indicadores.ver'),
    schema: {
      tags: ['indicadores'],
      summary: 'Calidad por maquilero (% aprobación, defectos top, tendencia)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKpisCalidadQuery,
      response: { 200: esquemaKpisCalidad, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return kpisCalidadMaquilero(sesion, request.query);
    },
  });

  app.route({
    method: 'GET',
    url: '/indicadores/calidad-maquileros/impreso',
    preHandler: app.conPermiso('indicadores.ver'),
    schema: {
      tags: ['indicadores'],
      summary: 'Tablero de calidad por maquilero en PDF (R9)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKpisCalidadQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await impresoKpisCalidad(sesion, request.query);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'inline; filename="indicadores-calidad-maquileros.pdf"');
      return reply.send(buffer as unknown as never);
    },
  });

  app.route({
    method: 'GET',
    url: '/indicadores/calidad-maquileros/excel',
    preHandler: app.conPermiso('indicadores.ver'),
    schema: {
      tags: ['indicadores'],
      summary: 'Tablero de calidad por maquilero en Excel (.xlsx)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKpisCalidadQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await excelKpisCalidad(sesion, request.query);
      reply
        .header('Content-Type', XLSX)
        .header(
          'Content-Disposition',
          'attachment; filename="indicadores-calidad-maquileros.xlsx"',
        );
      return reply.send(buffer as unknown as never);
    },
  });

  // ── WIP analítico ──────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/indicadores/wip',
    preHandler: app.conPermiso('indicadores.ver'),
    schema: {
      tags: ['indicadores'],
      summary: 'WIP analítico (prendas atoradas por etapa, avance por orden)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKpisWipQuery,
      response: { 200: esquemaKpisWip, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return kpisWip(sesion, request.query);
    },
  });

  app.route({
    method: 'GET',
    url: '/indicadores/wip/impreso',
    preHandler: app.conPermiso('indicadores.ver'),
    schema: {
      tags: ['indicadores'],
      summary: 'Tablero WIP analítico en PDF (R9)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKpisWipQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await impresoKpisWip(sesion, request.query);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'inline; filename="indicadores-wip.pdf"');
      return reply.send(buffer as unknown as never);
    },
  });

  app.route({
    method: 'GET',
    url: '/indicadores/wip/excel',
    preHandler: app.conPermiso('indicadores.ver'),
    schema: {
      tags: ['indicadores'],
      summary: 'Tablero WIP analítico en Excel (.xlsx)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKpisWipQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await excelKpisWip(sesion, request.query);
      reply
        .header('Content-Type', XLSX)
        .header('Content-Disposition', 'attachment; filename="indicadores-wip.xlsx"');
      return reply.send(buffer as unknown as never);
    },
  });

  // ── Refresco on-demand (encola y regresa de inmediato) ───────────────────────────
  app.route({
    method: 'POST',
    url: '/indicadores/refrescar',
    preHandler: app.conPermiso('indicadores.ver'),
    schema: {
      tags: ['indicadores'],
      summary: 'Encola el refresco de las vistas de KPIs (la captura/consulta no espera)',
      security: SEGURIDAD_SESION,
      response: { 200: esquemaRefrescoEncolado, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return encolarRefrescoKpis(sesion);
    },
  });

  done();
};
