/**
 * Rutas REST del PRECOSTO PERSISTIDO por desarrollo (F8-E3, D13/R17–R19). Handlers DELGADOS (A1):
 * validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan al dominio `dominio/desarrollo/
 * precostos`. Las LECTURAS exigen `desarrollo.ver`; las MUTACIONES exigen `desarrollo.precostear`
 * Y `desarrollo.ver` (preHandler en arreglo = AND): mutar un precosto implica poder leerlo, así el
 * contrato es honesto (nunca se commitea para luego responder 403 al releer). El dominio devuelve ya
 * la proyección del contrato (importes ocultos sin `consultas.ver-importes`). Errores de dominio los
 * traduce el handler global.
 *
 * Endpoints (todos por la empresa activa = A9):
 *  • `GET    /desarrollos/:idDesarrollo/precostos`         (ver)        → historial de versiones.
 *  • `POST   /desarrollos/:idDesarrollo/precostos`         (precostear) → genera un borrador vN+1.
 *  • `GET    /precostos/:id`                               (ver)        → precosto con renglones.
 *  • `POST   /precostos/:id/recalcular`                    (precostear) → refresca los renglones BOM.
 *  • `POST   /precostos/:id/lineas`                        (precostear) → agrega un renglón manual.
 *  • `PATCH  /precostos/:id/lineas/:idLinea`               (precostear) → edita un renglón manual.
 *  • `DELETE /precostos/:id/lineas/:idLinea`               (precostear) → elimina un renglón manual.
 *  • `POST   /precostos/:id/congelar`                      (precostear) → congela (inmutable).
 * Se registra en `app.ts`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/index.js';
import {
  esquemaPrecostoLineaEditar,
  esquemaPrecostoLineaManualCrear,
  esquemaPrecostoSalida,
  esquemaPrecostosDesarrolloLista,
} from '../../contrato/esquemas/precosto.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  agregarLineaManual,
  congelarVersion,
  editarLinea,
  eliminarLineaManual,
  generarPrecosto,
  listarPrecostosDeDesarrollo,
  obtenerPrecosto,
  recalcularDesdeBom,
} from '../../dominio/desarrollo/precostos.js';

/** Parámetro de ruta `:idDesarrollo`. */
const esquemaParamDesarrollo = z.object({
  idDesarrollo: z.coerce
    .number({ error: 'El id del desarrollo debe ser un número' })
    .int({ error: 'El id del desarrollo debe ser entero' })
    .positive({ error: 'El id del desarrollo debe ser positivo' })
    .describe('Id del desarrollo.'),
});

/** Parámetro de ruta `:id` (precosto). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del precosto debe ser un número' })
    .int({ error: 'El id del precosto debe ser entero' })
    .positive({ error: 'El id del precosto debe ser positivo' })
    .describe('Id del precosto.'),
});

/** Parámetro de ruta `:id` + `:idLinea`. */
const esquemaParamLinea = esquemaParamId.extend({
  idLinea: z.coerce
    .number({ error: 'El id del renglón debe ser un número' })
    .int({ error: 'El id del renglón debe ser entero' })
    .positive({ error: 'El id del renglón debe ser positivo' })
    .describe('Id del renglón de precosto.'),
});

/** Respuestas de error comunes a toda ruta protegida. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de precostos (montadas bajo `/api`). */
export const rutasPrecostos: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Historial de versiones de precosto de un desarrollo (más nuevo primero).
  app.route({
    method: 'GET',
    url: '/desarrollos/:idDesarrollo/precostos',
    preHandler: app.conPermiso('desarrollo.ver'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Historial de precostos de un desarrollo',
      security: SEGURIDAD_SESION,
      params: esquemaParamDesarrollo,
      response: { 200: esquemaPrecostosDesarrolloLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarPrecostosDeDesarrollo(sesion, request.params.idDesarrollo);
    },
  });

  // Generar un precosto borrador (siguiente versión) desde el BOM.
  app.route({
    method: 'POST',
    url: '/desarrollos/:idDesarrollo/precostos',
    preHandler: [app.conPermiso('desarrollo.precostear'), app.conPermiso('desarrollo.ver')],
    schema: {
      tags: ['desarrollo'],
      summary: 'Generar un precosto (borrador) desde el BOM del modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamDesarrollo,
      response: { 201: esquemaPrecostoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const precosto = await generarPrecosto(sesion, request.params.idDesarrollo);
      return reply.code(201).send(precosto);
    },
  });

  // Obtener un precosto con sus renglones.
  app.route({
    method: 'GET',
    url: '/precostos/:id',
    preHandler: app.conPermiso('desarrollo.ver'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Obtener un precosto (con renglones)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaPrecostoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerPrecosto(sesion, request.params.id);
    },
  });

  // Recalcular los renglones de origen BOM (sin tocar los manuales).
  app.route({
    method: 'POST',
    url: '/precostos/:id/recalcular',
    preHandler: [app.conPermiso('desarrollo.precostear'), app.conPermiso('desarrollo.ver')],
    schema: {
      tags: ['desarrollo'],
      summary: 'Recalcular los renglones BOM del precosto (respeta los manuales)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaPrecostoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return recalcularDesdeBom(sesion, request.params.id);
    },
  });

  // Agregar un renglón manual.
  app.route({
    method: 'POST',
    url: '/precostos/:id/lineas',
    preHandler: [app.conPermiso('desarrollo.precostear'), app.conPermiso('desarrollo.ver')],
    schema: {
      tags: ['desarrollo'],
      summary: 'Agregar un renglón manual al precosto',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaPrecostoLineaManualCrear,
      response: { 201: esquemaPrecostoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const precosto = await agregarLineaManual(sesion, request.params.id, request.body);
      return reply.code(201).send(precosto);
    },
  });

  // Editar un renglón manual (incluida la maquila).
  app.route({
    method: 'PATCH',
    url: '/precostos/:id/lineas/:idLinea',
    preHandler: [app.conPermiso('desarrollo.precostear'), app.conPermiso('desarrollo.ver')],
    schema: {
      tags: ['desarrollo'],
      summary: 'Editar un renglón manual del precosto',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      body: esquemaPrecostoLineaEditar,
      response: { 200: esquemaPrecostoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return editarLinea(sesion, request.params.id, request.params.idLinea, request.body);
    },
  });

  // Eliminar un renglón manual (concepto no fijo).
  app.route({
    method: 'DELETE',
    url: '/precostos/:id/lineas/:idLinea',
    preHandler: [app.conPermiso('desarrollo.precostear'), app.conPermiso('desarrollo.ver')],
    schema: {
      tags: ['desarrollo'],
      summary: 'Eliminar un renglón manual del precosto',
      security: SEGURIDAD_SESION,
      params: esquemaParamLinea,
      response: { 200: esquemaPrecostoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return eliminarLineaManual(sesion, request.params.id, request.params.idLinea);
    },
  });

  // Congelar la versión (inmutable).
  app.route({
    method: 'POST',
    url: '/precostos/:id/congelar',
    preHandler: [app.conPermiso('desarrollo.precostear'), app.conPermiso('desarrollo.ver')],
    schema: {
      tags: ['desarrollo'],
      summary: 'Congelar el precosto (versión inmutable)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaPrecostoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return congelarVersion(sesion, request.params.id);
    },
  });

  done();
};
