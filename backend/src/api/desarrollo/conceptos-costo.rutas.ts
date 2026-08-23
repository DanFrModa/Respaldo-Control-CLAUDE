/**
 * Rutas REST de Conceptos de costo (F8-E1a; CRUD patrón Tipos de proceso). Handlers delgados (A1):
 * validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/desarrollo/conceptos-costo`. La regla de "un concepto fijo no se desactiva" y "fijo no
 * es editable por API" viven en el dominio (no aquí): la ruta solo pasa la sesión y el cuerpo.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/index.js';
import {
  esquemaConceptoCostoCrear,
  esquemaConceptoCostoEditar,
  esquemaConceptoCostoSalida,
  esquemaConceptosCostoPagina,
  esquemaConceptosCostoQuery,
} from '../../contrato/esquemas/concepto-costo.js';
import type { ConceptoCosto } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarConceptoCosto,
  crearConceptoCosto,
  desactivarConceptoCosto,
  listarConceptosCosto,
  obtenerConceptoCosto,
} from '../../dominio/desarrollo/conceptos-costo.js';

/** Proyecta el modelo Prisma `ConceptoCosto` a la forma JSON del contrato (fechas ISO). */
function aConceptoCostoSalida(concepto: ConceptoCosto): z.infer<typeof esquemaConceptoCostoSalida> {
  return {
    id: concepto.id,
    codigo: concepto.codigo,
    nombre: concepto.nombre,
    orden: concepto.orden,
    fijo: concepto.fijo,
    activo: concepto.activo,
    creadoEn: concepto.creadoEn.toISOString(),
    creadoPorId: concepto.creadoPorId,
    modificadoEn: concepto.modificadoEn.toISOString(),
    modificadoPorId: concepto.modificadoPorId,
  };
}

/** Parámetro de ruta `:id`. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del concepto de costo debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del concepto de costo.'),
});

/** El cuerpo del PATCH no repite el `id` (va en la URL). */
const esquemaConceptoCostoPatchCuerpo = esquemaConceptoCostoEditar.omit({ id: true });

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de conceptos de costo (montadas bajo `/api`). */
export const rutasConceptosCosto: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  app.route({
    method: 'GET',
    url: '/conceptos-costo',
    preHandler: app.conPermiso('concepto-costo.ver'),
    schema: {
      tags: ['concepto-costo'],
      summary: 'Listar conceptos de costo',
      security: SEGURIDAD_SESION,
      querystring: esquemaConceptosCostoQuery,
      response: { 200: esquemaConceptosCostoPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarConceptosCosto(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aConceptoCostoSalida) };
    },
  });

  app.route({
    method: 'GET',
    url: '/conceptos-costo/:id',
    preHandler: app.conPermiso('concepto-costo.ver'),
    schema: {
      tags: ['concepto-costo'],
      summary: 'Obtener un concepto de costo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaConceptoCostoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aConceptoCostoSalida(await obtenerConceptoCosto(sesion, request.params.id));
    },
  });

  app.route({
    method: 'POST',
    url: '/conceptos-costo',
    preHandler: app.conPermiso('concepto-costo.administrar'),
    schema: {
      tags: ['concepto-costo'],
      summary: 'Crear un concepto de costo',
      security: SEGURIDAD_SESION,
      body: esquemaConceptoCostoCrear,
      response: { 201: esquemaConceptoCostoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const concepto = await crearConceptoCosto(sesion, request.body);
      return reply.code(201).send(aConceptoCostoSalida(concepto));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/conceptos-costo/:id',
    preHandler: app.conPermiso('concepto-costo.administrar'),
    schema: {
      tags: ['concepto-costo'],
      summary: 'Actualizar un concepto de costo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaConceptoCostoPatchCuerpo,
      response: { 200: esquemaConceptoCostoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const concepto = await actualizarConceptoCosto(sesion, {
        ...request.body,
        id: request.params.id,
      });
      return aConceptoCostoSalida(concepto);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/conceptos-costo/:id',
    preHandler: app.conPermiso('concepto-costo.administrar'),
    schema: {
      tags: ['concepto-costo'],
      summary: 'Desactivar un concepto de costo (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaConceptoCostoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aConceptoCostoSalida(await desactivarConceptoCosto(sesion, request.params.id));
    },
  });

  done();
};
