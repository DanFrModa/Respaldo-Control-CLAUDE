/**
 * Rutas REST de la COTIZACIÓN (V1-E7c, §Post-F9.109) — el documento que se le manda al cliente.
 * Handlers DELGADOS (A1): validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/desarrollo/cotizaciones`. El dominio devuelve ya la proyección del contrato (importes
 * ocultos sin `consultas.ver-importes`).
 *
 * RBAC — SIN permisos nuevos (menos rotación de seed, y el reparto ya dice lo correcto):
 *  • LEER (listado/detalle) → `listas.ver`.
 *  • EMITIR / CANCELAR      → `listas.negociar` + `listas.ver` (dueño y gerente comercial: quien
 *    está en la mesa es quien manda el papel). Mutar implica leer — preHandler en arreglo = AND,
 *    evita el 403-tras-commit (lección de F8-E3).
 *  • PDF                    → `listas.ver` + `consultas.ver-importes` (el impreso ES precios).
 *
 * NO hay endpoint de EDICIÓN, a propósito: la cotización es INMUTABLE (otra vuelta = otra
 * cotización). Tampoco de borrado: se cancela con motivo (D3).
 * Se registra en `app.ts`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/index.js';
import {
  esquemaCotizacionCancelar,
  esquemaCotizacionDetalle,
  esquemaCotizacionEmitir,
  esquemaCotizacionesLista,
  esquemaCotizacionesQuery,
} from '../../contrato/esquemas/cotizacion.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  cancelarCotizacion,
  emitirCotizacion,
  listarCotizaciones,
  obtenerCotizacion,
} from '../../dominio/desarrollo/cotizaciones.js';
import { impresoCotizacion } from '../../dominio/desarrollo/impresos/impreso-cotizacion.js';

/** Parámetro de ruta `:id` (cotización). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la cotización debe ser un número' })
    .int({ error: 'El id de la cotización debe ser entero' })
    .positive({ error: 'El id de la cotización debe ser positivo' })
    .describe('Id de la cotización.'),
});

/** Respuestas de error comunes a toda ruta protegida. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de cotizaciones (montadas bajo `/api`). */
export const rutasCotizaciones: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Listado de cotizaciones (filtrable; el detalle de una lista pide `idLista`).
  app.route({
    method: 'GET',
    url: '/cotizaciones',
    preHandler: app.conPermiso('listas.ver'),
    schema: {
      tags: ['listas'],
      summary: 'Listar cotizaciones emitidas (por lista/cliente/estado/fechas)',
      security: SEGURIDAD_SESION,
      querystring: esquemaCotizacionesQuery,
      response: { 200: esquemaCotizacionesLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await listarCotizaciones(sesion, request.query);
      return { datos };
    },
  });

  // EMITIR: nace ya emitida con TODOS los renglones de la lista (regla de Daniel).
  app.route({
    method: 'POST',
    url: '/cotizaciones',
    preHandler: [app.conPermiso('listas.negociar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Emitir la cotización de una lista de precios (con TODOS sus modelos, congelados)',
      security: SEGURIDAD_SESION,
      body: esquemaCotizacionEmitir,
      response: { 201: esquemaCotizacionDetalle, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const cotizacion = await emitirCotizacion(sesion, request.body);
      return reply.code(201).send(cotizacion);
    },
  });

  // Detalle de una cotización (valores congelados; NO refleja cambios posteriores de la lista).
  app.route({
    method: 'GET',
    url: '/cotizaciones/:id',
    preHandler: app.conPermiso('listas.ver'),
    schema: {
      tags: ['listas'],
      summary: 'Obtener una cotización (con sus renglones congelados)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaCotizacionDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerCotizacion(sesion, request.params.id);
    },
  });

  // CANCELAR con motivo (D3: nunca se borra ni se edita; se le pone un sello).
  app.route({
    method: 'POST',
    url: '/cotizaciones/:id/cancelar',
    preHandler: [app.conPermiso('listas.negociar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Cancelar una cotización con motivo (el documento se conserva íntegro)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaCotizacionCancelar,
      response: { 200: esquemaCotizacionDetalle, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarCotizacion(sesion, request.params.id, request.body);
    },
  });

  // Impreso PDF: ES el punto de toda la etapa (lo único que ve el cliente). Binario; exige importes.
  app.route({
    method: 'GET',
    url: '/cotizaciones/:id/pdf',
    preHandler: [app.conPermiso('listas.ver'), app.conPermiso('consultas.ver-importes')],
    schema: {
      tags: ['listas'],
      summary: 'Cotización en PDF (el documento que se le manda al cliente)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await impresoCotizacion(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="cotizacion-${folio}.pdf"`);
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
