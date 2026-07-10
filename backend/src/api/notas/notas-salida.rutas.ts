/**
 * Rutas REST de las NOTAS DE SALIDA estructuradas (Módulo 5, F4-E5 — doc
 * `Documentacion_MJD/03-Produccion.md` §"Notas de Salida"; R4/R9). Calca el ESTÁNDAR de las rutas de
 * Órdenes de compra / recepciones: cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `notas.ver` para leer; `notas.administrar` para crear/editar/confirmar; `notas.cancelar`.
 *  3. **Delega** a los servicios de dominio (`dominio/notas/notas-salida.ts`).
 *
 * Endpoints (montados bajo `/api`):
 *  • `POST   /notas-salida`              — alta en borrador → **201** con la nota creada.
 *  • `GET    /notas-salida`             — listado paginado (filtros: maquilero/estatus/orden) (200).
 *  • `GET    /notas-salida/:id`         — obtener una nota (200).
 *  • `GET    /notas-salida/:id/impreso` — PDF de la nota (binario, `application/pdf`).
 *  • `PATCH  /notas-salida/:id`         — editar el cuerpo/renglones de una nota en borrador (200).
 *  • `POST   /notas-salida/:id/confirmar` — confirmar (descuenta los avíos del kardex) (200).
 *  • `POST   /notas-salida/:id/cancelar`  — cancelación suave (reverso de avíos), motivo obligatorio (200).
 *
 * CERO lógica de negocio o acceso a datos aquí; los errores de dominio los traduce el error handler
 * global. NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasNotasSalida, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaNotaSalidaCrear,
  esquemaNotaSalidaEditarCuerpo,
  esquemaNotaSalidaCancelarCuerpo,
  esquemaNotaSalidaSalida,
  esquemaNotasSalidaQuery,
  esquemaNotasSalidaPagina,
  esquemaResumenNotasQuery,
  esquemaResumenNotasSalida,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarNotaSalida,
  cancelarNotaSalida,
  confirmarNotaSalida,
  crearNotaSalida,
  listarNotasSalida,
  obtenerNotaSalida,
  resumenNotasSalida,
} from '../../dominio/notas/notas-salida.js';
import { impresoNotaSalida } from '../../dominio/notas/impresos/impreso-nota-salida.js';

/** Parámetro de ruta `:id` (nota de salida). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la nota debe ser un número' })
    .int({ error: 'El id de la nota debe ser entero' })
    .positive({ error: 'El id de la nota debe ser positivo' })
    .describe('Id de la nota de salida.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de notas de salida (montadas bajo `/api`). */
export const rutasNotasSalida: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Alta de una nota en borrador. Permiso `notas.administrar`.
  app.route({
    method: 'POST',
    url: '/notas-salida',
    preHandler: app.conPermiso('notas.administrar'),
    schema: {
      tags: ['notas'],
      summary: 'Crear una nota de salida (borrador)',
      security: SEGURIDAD_SESION,
      body: esquemaNotaSalidaCrear,
      response: { 201: esquemaNotaSalidaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const nota = await crearNotaSalida(sesion, request.body);
      return reply.code(201).send(nota);
    },
  });

  // Listado paginado (filtros por maquilero/estatus/orden). Permiso `notas.ver`.
  app.route({
    method: 'GET',
    url: '/notas-salida',
    preHandler: app.conPermiso('notas.ver'),
    schema: {
      tags: ['notas'],
      summary: 'Listar notas de salida (paginado, con filtros)',
      security: SEGURIDAD_SESION,
      querystring: esquemaNotasSalidaQuery,
      response: { 200: esquemaNotasSalidaPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarNotasSalida(sesion, request.query);
    },
  });

  // Resumen de cabecera (KPIs vNotasSalida, R9): conteos por estatus + órdenes surtidas, sobre el
  // mismo universo del listado. Ruta ESTÁTICA antes de la paramétrica `:id` (Fastify prioriza
  // estáticas; se declara antes por claridad — mismo criterio que el resumen de OC). Reúsa `notas.ver`.
  app.route({
    method: 'GET',
    url: '/notas-salida/resumen',
    preHandler: app.conPermiso('notas.ver'),
    schema: {
      tags: ['notas'],
      summary: 'Resumen de cabecera de notas de salida (conteos por estatus + órdenes surtidas)',
      security: SEGURIDAD_SESION,
      querystring: esquemaResumenNotasQuery,
      response: { 200: esquemaResumenNotasSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return resumenNotasSalida(sesion, request.query);
    },
  });

  // Obtener una nota por id. Permiso `notas.ver`.
  app.route({
    method: 'GET',
    url: '/notas-salida/:id',
    preHandler: app.conPermiso('notas.ver'),
    schema: {
      tags: ['notas'],
      summary: 'Obtener una nota de salida',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaNotaSalidaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerNotaSalida(sesion, request.params.id);
    },
  });

  // Impreso (PDF) de una nota de salida. Respuesta BINARIA (application/pdf); el frontend solo abre
  // el blob. Permiso `notas.ver` (mismo que leer la nota).
  app.route({
    method: 'GET',
    url: '/notas-salida/:id/impreso',
    preHandler: app.conPermiso('notas.ver'),
    schema: {
      tags: ['notas'],
      summary: 'Imprimir una nota de salida (PDF)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      // La respuesta 200 es binaria (application/pdf); solo se documentan los errores.
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, numNota } = await impresoNotaSalida(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="nota-salida-${numNota}.pdf"`);
      // La respuesta es binaria (no JSON): Fastify envía el Buffer tal cual. El tipo del `send` lo
      // infiere el type-provider de las respuestas DECLARADAS (solo errores), por eso el cast.
      return reply.send(buffer as unknown as never);
    },
  });

  // Editar el cuerpo/renglones de una nota en borrador. Permiso `notas.administrar`.
  app.route({
    method: 'PATCH',
    url: '/notas-salida/:id',
    preHandler: app.conPermiso('notas.administrar'),
    schema: {
      tags: ['notas'],
      summary: 'Editar una nota de salida en borrador',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaNotaSalidaEditarCuerpo,
      response: { 200: esquemaNotaSalidaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarNotaSalida(sesion, request.params.id, request.body);
    },
  });

  // Confirmar una nota (descuenta los avíos del kardex). Permiso `notas.administrar`.
  app.route({
    method: 'POST',
    url: '/notas-salida/:id/confirmar',
    preHandler: app.conPermiso('notas.administrar'),
    schema: {
      tags: ['notas'],
      summary: 'Confirmar una nota de salida (descuenta los avíos del kardex, R4)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaNotaSalidaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return confirmarNotaSalida(sesion, request.params.id);
    },
  });

  // Cancelar una nota (cancelación suave; reversa los avíos; motivo obligatorio). Permiso `notas.cancelar`.
  app.route({
    method: 'POST',
    url: '/notas-salida/:id/cancelar',
    preHandler: app.conPermiso('notas.cancelar'),
    schema: {
      tags: ['notas'],
      summary: 'Cancelar una nota de salida (reverso auditado de avíos, motivo obligatorio)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaNotaSalidaCancelarCuerpo,
      response: { 200: esquemaNotaSalidaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarNotaSalida(sesion, request.params.id, request.body);
    },
  });

  done();
};
