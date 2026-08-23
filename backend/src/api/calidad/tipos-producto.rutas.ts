/**
 * Rutas REST del catálogo de TIPOS DE PRODUCTO (Calidad, F6-E1). Rutas delgadas (A1): validan con
 * los esquemas Zod compartidos de `src/contrato`, autorizan server-side con `app.conPermiso`
 * (deny-by-default, §9.2: `calidad.ver` para leer, `calidad.administrar-catalogo` para mutar) y
 * delegan al servicio de dominio `dominio/calidad/tipos-producto`. CERO lógica de negocio aquí.
 *
 * Montadas bajo `/api` (`await app.register(rutasTiposProducto, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaTipoProductoCrear,
  esquemaTipoProductoEditar,
  esquemaTipoProductoSalida,
  esquemaTiposProductoPagina,
  esquemaTiposProductoQuery,
} from '../../contrato/index.js';
import type { TipoProducto } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarTipoProducto,
  crearTipoProducto,
  desactivarTipoProducto,
  listarTiposProducto,
  obtenerTipoProducto,
} from '../../dominio/calidad/tipos-producto.js';

/** Proyecta el modelo Prisma a la forma JSON del contrato (fechas ISO). */
function aSalida(tipo: TipoProducto): z.infer<typeof esquemaTipoProductoSalida> {
  return {
    id: tipo.id,
    nombre: tipo.nombre,
    digitoConcepto: tipo.digitoConcepto,
    activo: tipo.activo,
    creadoEn: tipo.creadoEn.toISOString(),
    creadoPorId: tipo.creadoPorId,
    modificadoEn: tipo.modificadoEn.toISOString(),
    modificadoPorId: tipo.modificadoPorId,
  };
}

const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del tipo de producto debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del tipo de producto.'),
});

const esquemaPatchCuerpo = esquemaTipoProductoEditar.omit({ id: true });

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

export const rutasTiposProducto: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/calidad/tipos-producto',
    preHandler: app.conPermiso('calidad.ver'),
    schema: {
      tags: ['calidad'],
      summary: 'Listar tipos de producto',
      security: SEGURIDAD_SESION,
      querystring: esquemaTiposProductoQuery,
      response: { 200: esquemaTiposProductoPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarTiposProducto(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aSalida) };
    },
  });

  app.route({
    method: 'GET',
    url: '/calidad/tipos-producto/:id',
    preHandler: app.conPermiso('calidad.ver'),
    schema: {
      tags: ['calidad'],
      summary: 'Obtener un tipo de producto',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaTipoProductoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aSalida(await obtenerTipoProducto(sesion, request.params.id));
    },
  });

  app.route({
    method: 'POST',
    url: '/calidad/tipos-producto',
    preHandler: app.conPermiso('calidad.administrar-catalogo'),
    schema: {
      tags: ['calidad'],
      summary: 'Crear un tipo de producto',
      security: SEGURIDAD_SESION,
      body: esquemaTipoProductoCrear,
      response: { 201: esquemaTipoProductoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const tipo = await crearTipoProducto(sesion, request.body);
      return reply.code(201).send(aSalida(tipo));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/calidad/tipos-producto/:id',
    preHandler: app.conPermiso('calidad.administrar-catalogo'),
    schema: {
      tags: ['calidad'],
      summary: 'Actualizar un tipo de producto',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaPatchCuerpo,
      response: { 200: esquemaTipoProductoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const tipo = await actualizarTipoProducto(sesion, { ...request.body, id: request.params.id });
      return aSalida(tipo);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/calidad/tipos-producto/:id',
    preHandler: app.conPermiso('calidad.administrar-catalogo'),
    schema: {
      tags: ['calidad'],
      summary: 'Desactivar un tipo de producto (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaTipoProductoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aSalida(await desactivarTipoProducto(sesion, request.params.id));
    },
  });

  done();
};
