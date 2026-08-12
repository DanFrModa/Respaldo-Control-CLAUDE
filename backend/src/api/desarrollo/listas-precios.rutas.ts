/**
 * Rutas REST de la LISTA DE PRECIOS por Cliente+Departamento (F8-E4, D13/R20a). Handlers DELGADOS
 * (A1): validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/desarrollo/listas-precios`. El dominio devuelve ya la proyección del contrato (importes
 * ocultos sin `consultas.ver-importes`).
 *
 * RBAC (mutar implica leer — preHandler en arreglo = AND; evita 403-tras-commit, lección de E3):
 *  • LEER (listado/detalle/candidatos)        → `listas.ver`.
 *  • CREAR / editar factores                  → `listas.administrar` + `listas.ver`.
 *  • APROBAR / teclear precio de un renglón    → `listas.aprobar` + `listas.ver`.
 *  • NEGOCIAR (rondas/acuerdos/cambiar estado) → `listas.negociar` + `listas.ver` (F8-E5).
 *  • Historial de eventos de un renglón        → `listas.ver` (F8-E5).
 *  • PDF / Excel                              → `listas.ver` + `consultas.ver-importes` (el impreso ES
 *    la exportación de precios; sin ver-importes no tiene sentido → 403).
 * Se registra en `app.ts`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/index.js';
import {
  esquemaAjustarPrecioLinea,
  esquemaCandidatosLista,
  esquemaCandidatosQuery,
  esquemaDesgloseCostoLinea,
  esquemaListaFactoresEditar,
  esquemaListaPreciosCrear,
  esquemaListaPreciosDetalle,
  esquemaListasPreciosLista,
  esquemaListasPreciosQuery,
} from '../../contrato/esquemas/lista-precios.js';
import {
  esquemaAcuerdoRegistrar,
  esquemaCambiarEstadoLista,
  esquemaNegociacionEventos,
  esquemaRondaRegistrar,
  esquemaSimulacionNegociacion,
  esquemaSimularNegociacionQuery,
} from '../../contrato/esquemas/negociacion.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  ajustarPrecioLinea,
  aprobarLinea,
  candidatosParaLista,
  crearLista,
  desgloseCostoLinea,
  editarFactoresLista,
  listarListas,
  obtenerLista,
} from '../../dominio/desarrollo/listas-precios.js';
import {
  cambiarEstadoLista,
  listarEventosDeLinea,
  registrarAcuerdo,
  registrarRonda,
  simularNegociacion,
} from '../../dominio/desarrollo/negociacion.js';
import { impresoListaPrecios } from '../../dominio/desarrollo/impresos/impreso-lista-precios.js';
import { excelListaPrecios } from '../../dominio/desarrollo/impresos/excel-lista-precios.js';

/** Parámetro de ruta `:id` (lista). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la lista debe ser un número' })
    .int({ error: 'El id de la lista debe ser entero' })
    .positive({ error: 'El id de la lista debe ser positivo' })
    .describe('Id de la lista de precios.'),
});

/** Parámetro de ruta `:idLinea` (renglón). */
const esquemaParamLinea = z.object({
  idLinea: z.coerce
    .number({ error: 'El id del renglón debe ser un número' })
    .int({ error: 'El id del renglón debe ser entero' })
    .positive({ error: 'El id del renglón debe ser positivo' })
    .describe('Id del renglón de la lista.'),
});

/** Respuestas de error comunes a toda ruta protegida. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de listas de precios (montadas bajo `/api`). */
export const rutasListasPrecios: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Candidatos para una lista (desarrollos cotizados sin renglón en una lista).
  app.route({
    method: 'GET',
    url: '/listas-precios/candidatos',
    preHandler: app.conPermiso('listas.ver'),
    schema: {
      tags: ['listas'],
      summary: 'Desarrollos candidatos para una lista (cotizados, sin renglón en una lista)',
      security: SEGURIDAD_SESION,
      querystring: esquemaCandidatosQuery,
      response: { 200: esquemaCandidatosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await candidatosParaLista(sesion, {
        idCliente: request.query.idCliente,
        idClienteDepartamento: request.query.idClienteDepartamento,
        ...(request.query.idProyecto === undefined ? {} : { idProyecto: request.query.idProyecto }),
      });
      return { datos };
    },
  });

  // Listado de listas (filtrable).
  app.route({
    method: 'GET',
    url: '/listas-precios',
    preHandler: app.conPermiso('listas.ver'),
    schema: {
      tags: ['listas'],
      summary: 'Listar listas de precios (por cliente/departamento/estado/fechas)',
      security: SEGURIDAD_SESION,
      querystring: esquemaListasPreciosQuery,
      response: { 200: esquemaListasPreciosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await listarListas(sesion, request.query);
      return { datos };
    },
  });

  // Crear una lista.
  app.route({
    method: 'POST',
    url: '/listas-precios',
    preHandler: [app.conPermiso('listas.administrar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary:
        'Crear una lista de precios desde los precostos congelados y los factores del cliente',
      security: SEGURIDAD_SESION,
      body: esquemaListaPreciosCrear,
      response: { 201: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const lista = await crearLista(sesion, request.body);
      return reply.code(201).send(lista);
    },
  });

  // Detalle de una lista.
  app.route({
    method: 'GET',
    url: '/listas-precios/:id',
    preHandler: app.conPermiso('listas.ver'),
    schema: {
      tags: ['listas'],
      summary: 'Obtener una lista de precios (con renglones)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerLista(sesion, request.params.id);
    },
  });

  // Editar el snapshot de factores (recalcula precios calculados; no toca aprobados).
  app.route({
    method: 'PATCH',
    url: '/listas-precios/:id/factores',
    preHandler: [app.conPermiso('listas.administrar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Editar los factores de una lista y recalcular sus precios calculados',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaListaFactoresEditar,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return editarFactoresLista(sesion, request.params.id, request.body);
    },
  });

  // Aprobar un renglón (precioAprobado = precioCalculado).
  app.route({
    method: 'POST',
    url: '/listas-precios/lineas/:idLinea/aprobar',
    preHandler: [app.conPermiso('listas.aprobar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Aprobar el precio calculado de un renglón (el dueño)',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aprobarLinea(sesion, request.params.idLinea);
    },
  });

  // Teclear el precio aprobado de un renglón.
  app.route({
    method: 'PATCH',
    url: '/listas-precios/lineas/:idLinea/precio',
    preHandler: [app.conPermiso('listas.aprobar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Teclear el precio aprobado de un renglón (el dueño)',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      body: esquemaAjustarPrecioLinea,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return ajustarPrecioLinea(sesion, request.params.idLinea, request.body);
    },
  });

  // ── Negociación por versiones (F8-E5) ─────────────────────────────────────────────

  // Registrar una RONDA sobre un renglón (re-apunta a una versión congelada nueva + evento).
  app.route({
    method: 'POST',
    url: '/listas-precios/lineas/:idLinea/rondas',
    preHandler: [app.conPermiso('listas.negociar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Registrar una ronda de negociación (re-costeo) sobre un renglón',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      body: esquemaRondaRegistrar,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return registrarRonda(sesion, request.params.idLinea, request.body);
    },
  });

  // Registrar un ACUERDO sin re-costeo sobre un renglón (sólo evento).
  app.route({
    method: 'POST',
    url: '/listas-precios/lineas/:idLinea/acuerdos',
    preHandler: [app.conPermiso('listas.negociar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Registrar un acuerdo (sin re-costeo) sobre un renglón',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      body: esquemaAcuerdoRegistrar,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return registrarAcuerdo(sesion, request.params.idLinea, request.body);
    },
  });

  // Historial de eventos de negociación de un renglón (cronológico).
  app.route({
    method: 'GET',
    url: '/listas-precios/lineas/:idLinea/eventos',
    preHandler: app.conPermiso('listas.ver'),
    schema: {
      tags: ['listas'],
      summary: 'Historial de negociación de un renglón (rondas y acuerdos)',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      response: { 200: esquemaNegociacionEventos, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await listarEventosDeLinea(sesion, request.params.idLinea);
      return { datos };
    },
  });

  // Calculadora de negociación (§4.8): simula el margen de un precio objetivo. Todo es importes → se
  // exige además `consultas.ver-importes` (como el PDF/Excel); es una lectura pura (no muta nada).
  app.route({
    method: 'GET',
    url: '/listas-precios/lineas/:idLinea/simular',
    preHandler: [
      app.conPermiso('listas.negociar'),
      app.conPermiso('listas.ver'),
      app.conPermiso('consultas.ver-importes'),
    ],
    schema: {
      tags: ['listas'],
      summary:
        'Simular el margen de un precio objetivo sobre un renglón (calculadora de negociación)',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      querystring: esquemaSimularNegociacionQuery,
      response: { 200: esquemaSimulacionNegociacion, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return simularNegociacion(sesion, request.params.idLinea, request.query);
    },
  });

  // Desglose de costo por concepto de un renglón (§4.8): renglón expandible en la lista.
  app.route({
    method: 'GET',
    url: '/listas-precios/lineas/:idLinea/desglose-costo',
    preHandler: app.conPermiso('listas.ver'),
    schema: {
      tags: ['listas'],
      summary: 'Desglose de costo por concepto del precosto congelado de un renglón',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      response: { 200: esquemaDesgloseCostoLinea, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return desgloseCostoLinea(sesion, request.params.idLinea);
    },
  });

  // Cambiar el estado de la lista (incluida la reapertura de una lista cerrada, auditada).
  app.route({
    method: 'PATCH',
    url: '/listas-precios/:id/estado',
    preHandler: [app.conPermiso('listas.negociar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Cambiar el estado de una lista de precios (negociación / cierre / reapertura)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaCambiarEstadoLista,
      response: { 200: esquemaListaPreciosDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cambiarEstadoLista(sesion, request.params.id, request.body);
    },
  });

  // Impreso PDF de la lista (R9). Binario; exige ver importes (el impreso ES precios).
  app.route({
    method: 'GET',
    url: '/listas-precios/:id/pdf',
    preHandler: [app.conPermiso('listas.ver'), app.conPermiso('consultas.ver-importes')],
    schema: {
      tags: ['listas'],
      summary: 'Lista de precios en PDF (modelo / número del cliente / precio)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await impresoListaPrecios(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="lista-precios-${folio}.pdf"`);
      return reply.send(buffer as unknown as never);
    },
  });

  // Export a Excel de la lista. Binario; exige ver importes.
  app.route({
    method: 'GET',
    url: '/listas-precios/:id/excel',
    preHandler: [app.conPermiso('listas.ver'), app.conPermiso('consultas.ver-importes')],
    schema: {
      tags: ['listas'],
      summary: 'Lista de precios en Excel (.xlsx)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await excelListaPrecios(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="lista-precios-${folio}.xlsx"`);
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
