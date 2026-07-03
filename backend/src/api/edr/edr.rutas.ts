/**
 * Rutas REST del ESTADO DE RESULTADOS (EDR, Módulo 6, F7-E2; doc 06-Costos-y-EDR §4). Handlers
 * DELGADOS (A1): validan (Zod de `src/contrato`), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/edr/*`. Toda la lógica (generación idempotente, costo actual, cortes, reconciliación) vive
 * en el dominio. El EDR es CONSOLIDADO (no se acota a la empresa activa).
 *
 * Endpoints:
 *  • `POST /edr/generar`            (`edr.capturar`) → genera/reconcilia el EDR de un mes.
 *  • `GET  /edr/por-mes`            (`edr.ver`)      → EDR de un mes (o existe:false).
 *  • `GET  /edr/por-anio`           (`edr.ver`)      → comparativo mensual del año.
 *  • `GET  /edr/por-anio/impreso`   (`edr.ver`)      → EDR anual en PDF (R9).
 *  • `GET  /edr/:id`                (`edr.ver`)      → EDR calculado (encabezado + totales + cortes).
 *  • `PUT  /edr/:id`                (`edr.capturar`) → actualiza el encabezado global del mes.
 *  • `GET  /edr/:id/lineas`         (`edr.ver`)      → conciliación de líneas (filtrable).
 *  • `POST /edr/:id/lineas`         (`edr.capturar`) → agrega una línea manual.
 *  • `PUT  /edr/lineas/:idLinea`    (`edr.capturar`) → ajusta cantidad/precio de una línea.
 *  • `DELETE /edr/lineas/:idLinea`  (`edr.capturar`) → elimina una línea manual.
 *  • `GET  /edr/:id/impreso`        (`edr.ver`)      → EDR mensual en PDF (R9).
 *  • `GET  /edr/:id/excel`          (`edr.ver`)      → EDR mensual en Excel (.xlsx).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaEdrCalculado,
  esquemaEdrEncabezadoCuerpo,
  esquemaEdrGenerarCuerpo,
  esquemaEdrLineaAjustarCuerpo,
  esquemaEdrLineaManualCuerpo,
  esquemaEdrLineaSalida,
  esquemaEdrLineasQuery,
  esquemaEdrLineasSalida,
  esquemaEdrPorAnioQuery,
  esquemaEdrPorAnioSalida,
  esquemaEdrPorMesQuery,
  esquemaEdrPorMesSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarEncabezado,
  agregarLineaManual,
  ajustarLineaEdr,
  calcularEdr,
  edrPorAnio,
  edrPorMes,
  eliminarLineaManual,
  generarEdrMes,
  listarLineasEdr,
} from '../../dominio/edr/edr.js';
import { impresoEdrMensual } from '../../dominio/edr/impresos/impreso-edr-mensual.js';
import { impresoEdrAnual } from '../../dominio/edr/impresos/impreso-edr-anual.js';
import { excelEdr } from '../../dominio/edr/impresos/excel-edr.js';

/** Parámetro de ruta `:id` (EDR). */
const esquemaParamEdr = z.object({
  id: z.coerce.number().int().positive().describe('Id del EDR.'),
});

/** Parámetro de ruta `:idLinea`. */
const esquemaParamLinea = z.object({
  idLinea: z.coerce.number().int().positive().describe('Id de la línea del EDR.'),
});

/** Respuesta de una eliminación. */
const esquemaEliminado = z
  .object({ eliminada: z.boolean() })
  .describe('Resultado de la eliminación.');

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del EDR (montadas bajo `/api`). */
export const rutasEdr: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Generar / reconciliar el mes ──────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/edr/generar',
    preHandler: app.conPermiso('edr.capturar'),
    schema: {
      tags: ['edr'],
      summary: 'Genera (o reconcilia) el EDR de un mes desde las entregas a cliente',
      security: SEGURIDAD_SESION,
      body: esquemaEdrGenerarCuerpo,
      response: { 200: esquemaEdrCalculado, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return generarEdrMes(sesion, request.body.anio, request.body.mes);
    },
  });

  // ── Consultas por mes / año ───────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/edr/por-mes',
    preHandler: app.conPermiso('edr.ver'),
    schema: {
      tags: ['edr'],
      summary: 'EDR de un mes (o existe:false si aún no se genera)',
      security: SEGURIDAD_SESION,
      querystring: esquemaEdrPorMesQuery,
      response: { 200: esquemaEdrPorMesSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return edrPorMes(sesion, request.query.anio, request.query.mes);
    },
  });

  app.route({
    method: 'GET',
    url: '/edr/por-anio',
    preHandler: app.conPermiso('edr.ver'),
    schema: {
      tags: ['edr'],
      summary: 'Comparativo mensual del EDR de un año (con corte por empresa)',
      security: SEGURIDAD_SESION,
      querystring: esquemaEdrPorAnioQuery,
      response: { 200: esquemaEdrPorAnioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return edrPorAnio(sesion, request.query.anio);
    },
  });

  app.route({
    method: 'GET',
    url: '/edr/por-anio/impreso',
    preHandler: app.conPermiso('edr.ver'),
    schema: {
      tags: ['edr'],
      summary: 'EDR anual en PDF (R9)',
      security: SEGURIDAD_SESION,
      querystring: esquemaEdrPorAnioQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await impresoEdrAnual(sesion, request.query.anio);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="edr-${request.query.anio}.pdf"`);
      return reply.send(buffer as unknown as never);
    },
  });

  // ── Líneas por id estático ANTES del paramétrico `:id` (find-my-way prioriza estático) ──
  app.route({
    method: 'PUT',
    url: '/edr/lineas/:idLinea',
    preHandler: app.conPermiso('edr.capturar'),
    schema: {
      tags: ['edr'],
      summary: 'Ajusta la cantidad/precio facturado de una línea (marca ajustada)',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      body: esquemaEdrLineaAjustarCuerpo,
      response: { 200: esquemaEdrLineaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return ajustarLineaEdr(sesion, request.params.idLinea, request.body);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/edr/lineas/:idLinea',
    preHandler: app.conPermiso('edr.capturar'),
    schema: {
      tags: ['edr'],
      summary: 'Elimina una línea manual (rechaza automáticas/ajustadas)',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      response: { 200: esquemaEliminado, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await eliminarLineaManual(sesion, request.params.idLinea);
      return { eliminada: true };
    },
  });

  // ── EDR por id: calcular + actualizar encabezado ──────────────────────────────
  app.route({
    method: 'GET',
    url: '/edr/:id',
    preHandler: app.conPermiso('edr.ver'),
    schema: {
      tags: ['edr'],
      summary: 'EDR calculado (encabezado + totales a costo actual + cortes)',
      security: SEGURIDAD_SESION,
      params: esquemaParamEdr,
      response: { 200: esquemaEdrCalculado, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return calcularEdr(sesion, request.params.id);
    },
  });

  app.route({
    method: 'PUT',
    url: '/edr/:id',
    preHandler: app.conPermiso('edr.capturar'),
    schema: {
      tags: ['edr'],
      summary: 'Actualiza el encabezado global del mes (gastos/intereses/…)',
      security: SEGURIDAD_SESION,
      params: esquemaParamEdr,
      body: esquemaEdrEncabezadoCuerpo,
      response: { 200: esquemaEdrCalculado, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarEncabezado(sesion, request.params.id, request.body);
    },
  });

  // ── Conciliación de líneas ────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/edr/:id/lineas',
    preHandler: app.conPermiso('edr.ver'),
    schema: {
      tags: ['edr'],
      summary: 'Conciliación de líneas del EDR (a costo actual, filtrable)',
      security: SEGURIDAD_SESION,
      params: esquemaParamEdr,
      querystring: esquemaEdrLineasQuery,
      response: { 200: esquemaEdrLineasSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarLineasEdr(sesion, request.params.id, request.query);
    },
  });

  app.route({
    method: 'POST',
    url: '/edr/:id/lineas',
    preHandler: app.conPermiso('edr.capturar'),
    schema: {
      tags: ['edr'],
      summary: 'Agrega una línea manual al EDR (sin orden, costo 0)',
      security: SEGURIDAD_SESION,
      params: esquemaParamEdr,
      body: esquemaEdrLineaManualCuerpo,
      response: { 200: esquemaEdrLineaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return agregarLineaManual(sesion, request.params.id, request.body);
    },
  });

  // ── Impresos del mes (PDF + Excel) ────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/edr/:id/impreso',
    preHandler: app.conPermiso('edr.ver'),
    schema: {
      tags: ['edr'],
      summary: 'EDR mensual en PDF (R9)',
      security: SEGURIDAD_SESION,
      params: esquemaParamEdr,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await impresoEdrMensual(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'inline; filename="edr-mensual.pdf"');
      return reply.send(buffer as unknown as never);
    },
  });

  app.route({
    method: 'GET',
    url: '/edr/:id/excel',
    preHandler: app.conPermiso('edr.ver'),
    schema: {
      tags: ['edr'],
      summary: 'EDR mensual en Excel (.xlsx)',
      security: SEGURIDAD_SESION,
      params: esquemaParamEdr,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await excelEdr(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="edr-mensual.xlsx"');
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
