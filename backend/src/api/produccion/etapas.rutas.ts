/**
 * Rutas REST de las ETAPAS de producción (F3-E2: corte + envío a maquila unificado). Handlers
 * DELGADOS (A1): validan (Zod compartido de `src/contrato`), autorizan (`conPermiso`, A4) y delegan
 * al dominio `dominio/produccion/etapas`. Las reglas de negocio (sobre-corte libre, sobre-envío
 * estricto, mapeo proceso→rol, concurrencia) viven en el dominio.
 *
 * Endpoints (todos por la empresa activa de la sesión = A9; si una orden/etapa no es de la empresa
 * activa → 404):
 *  • `POST /produccion/cortes`               (perm `produccion.corte`)  → crea un corte.
 *  • `POST /produccion/envios`               (perm `produccion.envio`)  → crea un envío a maquila.
 *  • `POST /produccion/cortes/:id/cancelar`  (perm `produccion.cancelar`) → cancela un corte (suave).
 *  • `POST /produccion/envios/:id/cancelar`  (perm `produccion.cancelar`) → cancela un envío (suave).
 *  • `GET  /produccion/ordenes/:id/pendientes` (perm `produccion.wip-ver`) → pendientes derivados.
 *  • `GET  /produccion/ordenes/:id/etapas`   (perm `produccion.wip-ver`) → historial (cortes/envíos).
 *  • `GET  /produccion/corte-semanal`        (perm `produccion.wip-ver`) → corte semanal por cortador.
 *  • `GET  /produccion/envios/:id/impreso`   (perm `produccion.wip-ver`) → documento de envío (PDF).
 *  • `GET  /produccion/envios/:id/ficha-estampado` → PDF de la ficha de estampado (binario).
 *
 * Las dos rutas de cancelación comparten el MISMO servicio de dominio (`cancelarEtapaMovimiento`):
 * se exponen por separado por claridad de URL, pero el dominio valida el tipo de la etapa.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaCorteCrear,
  esquemaEnvioCrear,
  esquemaEtapaCancelarCuerpo,
  esquemaEtapaSalida,
  esquemaEtapasOrdenLista,
  esquemaEtapasOrdenQuery,
  esquemaPendientesOrden,
  esquemaCorteSemanalQuery,
  esquemaCorteSemanalLista,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  cancelarEtapaMovimiento,
  corteSemanalPorCortador,
  listarEtapasOrden,
  pendientesPorOrden,
  registrarCorte,
  registrarEnvioMaquila,
} from '../../dominio/produccion/etapas.js';
import {
  impresoEnvioMaquila,
  impresoFichaEstampado,
} from '../../dominio/produccion/impresos/impreso-envio-maquila.js';

/** Parámetro de ruta `:id`. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del recurso.'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de etapas de producción (montadas bajo `/api`). */
export const rutasEtapasProduccion: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Corte ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/produccion/cortes',
    preHandler: app.conPermiso('produccion.corte'),
    schema: {
      tags: ['produccion'],
      summary: 'Registrar un corte de una orden (color×talla; sobre-corte libre)',
      security: SEGURIDAD_SESION,
      body: esquemaCorteCrear,
      response: { 201: esquemaEtapaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const etapa = await registrarCorte(sesion, request.body);
      return reply.code(201).send(etapa);
    },
  });

  app.route({
    method: 'POST',
    url: '/produccion/cortes/:id/cancelar',
    preHandler: app.conPermiso('produccion.cancelar'),
    schema: {
      tags: ['produccion'],
      summary: 'Cancelar (suave) un corte',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaEtapaCancelarCuerpo,
      response: { 200: esquemaEtapaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarEtapaMovimiento(sesion, request.params.id, request.body);
    },
  });

  // ── Envío a maquila ──────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/produccion/envios',
    preHandler: app.conPermiso('produccion.envio'),
    schema: {
      tags: ['produccion'],
      summary: 'Registrar un envío a maquila (costura/estampado/…; sobre-envío estricto)',
      security: SEGURIDAD_SESION,
      body: esquemaEnvioCrear,
      response: { 201: esquemaEtapaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const etapa = await registrarEnvioMaquila(sesion, request.body);
      return reply.code(201).send(etapa);
    },
  });

  app.route({
    method: 'POST',
    url: '/produccion/envios/:id/cancelar',
    preHandler: app.conPermiso('produccion.cancelar'),
    schema: {
      tags: ['produccion'],
      summary: 'Cancelar (suave) un envío a maquila',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaEtapaCancelarCuerpo,
      response: { 200: esquemaEtapaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarEtapaMovimiento(sesion, request.params.id, request.body);
    },
  });

  // ── Consultas ──────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/produccion/ordenes/:id/pendientes',
    preHandler: app.conPermiso('produccion.wip-ver'),
    schema: {
      tags: ['produccion'],
      summary: 'Pendientes derivados de una orden (por cortar / cortado por enviar)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaPendientesOrden, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return pendientesPorOrden(sesion, request.params.id);
    },
  });

  app.route({
    method: 'GET',
    url: '/produccion/ordenes/:id/etapas',
    preHandler: app.conPermiso('produccion.wip-ver'),
    schema: {
      tags: ['produccion'],
      summary:
        'Historial de etapas (cortes y envíos; con incluirRecibos también recibos) de una orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      querystring: esquemaEtapasOrdenQuery,
      response: { 200: esquemaEtapasOrdenLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarEtapasOrden(sesion, request.params.id, undefined, {
        incluirRecibos: request.query.incluirRecibos,
      });
    },
  });

  app.route({
    method: 'GET',
    url: '/produccion/corte-semanal',
    preHandler: app.conPermiso('produccion.wip-ver'),
    schema: {
      tags: ['produccion'],
      summary: 'Corte semanal por cortador (consulta agrupada por cortador y semana)',
      security: SEGURIDAD_SESION,
      querystring: esquemaCorteSemanalQuery,
      response: { 200: esquemaCorteSemanalLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return corteSemanalPorCortador(sesion, request.query);
    },
  });

  // ── Impresos (binarios application/pdf; solo se documentan los errores) ───────
  app.route({
    method: 'GET',
    url: '/produccion/envios/:id/impreso',
    preHandler: app.conPermiso('produccion.wip-ver'),
    schema: {
      tags: ['produccion'],
      summary: 'Documento de envío/entrega a maquila (PDF)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await impresoEnvioMaquila(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="envio-maquila-${folio}.pdf"`);
      return reply.send(buffer as unknown as never);
    },
  });

  app.route({
    method: 'GET',
    url: '/produccion/envios/:id/ficha-estampado',
    preHandler: app.conPermiso('produccion.wip-ver'),
    schema: {
      tags: ['produccion'],
      summary: 'Ficha de estampado que acompaña un envío de proceso (PDF)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await impresoFichaEstampado(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="ficha-estampado-${folio}.pdf"`);
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
