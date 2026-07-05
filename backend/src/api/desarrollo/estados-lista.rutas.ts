/**
 * Rutas REST de Estados de lista de precios (F8-E1a; CRUD patrón Tipos de proceso). Handlers
 * delgados (A1): validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/desarrollo/estados-lista`. La bandera `esCierre` es config editable (a diferencia del
 * `fijo` de conceptos): la ruta solo pasa la sesión y el cuerpo.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/index.js';
import {
  esquemaEstadoListaCrear,
  esquemaEstadoListaEditar,
  esquemaEstadoListaSalida,
  esquemaEstadosListaPagina,
  esquemaEstadosListaQuery,
} from '../../contrato/esquemas/estado-lista.js';
import type { EstadoLista } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarEstadoLista,
  crearEstadoLista,
  desactivarEstadoLista,
  listarEstadosLista,
  obtenerEstadoLista,
} from '../../dominio/desarrollo/estados-lista.js';

/** Proyecta el modelo Prisma `EstadoLista` a la forma JSON del contrato (fechas ISO). */
function aEstadoListaSalida(estado: EstadoLista): z.infer<typeof esquemaEstadoListaSalida> {
  return {
    id: estado.id,
    codigo: estado.codigo,
    nombre: estado.nombre,
    orden: estado.orden,
    esCierre: estado.esCierre,
    activo: estado.activo,
    creadoEn: estado.creadoEn.toISOString(),
    creadoPorId: estado.creadoPorId,
    modificadoEn: estado.modificadoEn.toISOString(),
    modificadoPorId: estado.modificadoPorId,
  };
}

/** Parámetro de ruta `:id`. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del estado de lista debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del estado de lista.'),
});

/** El cuerpo del PATCH no repite el `id` (va en la URL). */
const esquemaEstadoListaPatchCuerpo = esquemaEstadoListaEditar.omit({ id: true });

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de estados de lista (montadas bajo `/api`). */
export const rutasEstadosLista: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/estados-lista',
    preHandler: app.conPermiso('estado-lista.ver'),
    schema: {
      tags: ['estado-lista'],
      summary: 'Listar estados de lista de precios',
      security: SEGURIDAD_SESION,
      querystring: esquemaEstadosListaQuery,
      response: { 200: esquemaEstadosListaPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarEstadosLista(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aEstadoListaSalida) };
    },
  });

  app.route({
    method: 'GET',
    url: '/estados-lista/:id',
    preHandler: app.conPermiso('estado-lista.ver'),
    schema: {
      tags: ['estado-lista'],
      summary: 'Obtener un estado de lista',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaEstadoListaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aEstadoListaSalida(await obtenerEstadoLista(sesion, request.params.id));
    },
  });

  app.route({
    method: 'POST',
    url: '/estados-lista',
    preHandler: app.conPermiso('estado-lista.administrar'),
    schema: {
      tags: ['estado-lista'],
      summary: 'Crear un estado de lista',
      security: SEGURIDAD_SESION,
      body: esquemaEstadoListaCrear,
      response: { 201: esquemaEstadoListaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const estado = await crearEstadoLista(sesion, request.body);
      return reply.code(201).send(aEstadoListaSalida(estado));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/estados-lista/:id',
    preHandler: app.conPermiso('estado-lista.administrar'),
    schema: {
      tags: ['estado-lista'],
      summary: 'Actualizar un estado de lista',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaEstadoListaPatchCuerpo,
      response: { 200: esquemaEstadoListaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const estado = await actualizarEstadoLista(sesion, {
        ...request.body,
        id: request.params.id,
      });
      return aEstadoListaSalida(estado);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/estados-lista/:id',
    preHandler: app.conPermiso('estado-lista.administrar'),
    schema: {
      tags: ['estado-lista'],
      summary: 'Desactivar un estado de lista (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaEstadoListaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aEstadoListaSalida(await desactivarEstadoLista(sesion, request.params.id));
    },
  });

  done();
};
