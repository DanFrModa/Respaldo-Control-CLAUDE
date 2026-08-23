/**
 * Rutas REST de Tipos de proceso (F3-E1; CRUD patrón Almacenes). Handlers delgados (A1):
 * validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/produccion/tipos-proceso`. La regla de "solo admin edita `generaEntradaPt`" vive en
 * el dominio (no aquí): la ruta solo pasa la sesión y el cuerpo.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaTipoProcesoCrear,
  esquemaTipoProcesoEditar,
  esquemaTipoProcesoSalida,
  esquemaTiposProcesoPagina,
  esquemaTiposProcesoQuery,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarTipoProceso,
  crearTipoProceso,
  desactivarTipoProceso,
  listarTiposProceso,
  obtenerTipoProceso,
  type TipoProcesoDetalle,
} from '../../dominio/produccion/tipos-proceso.js';

/** Proyecta el tipo de proceso del dominio a la forma JSON del contrato (fechas ISO). */
function aTipoProcesoSalida(tipo: TipoProcesoDetalle): z.infer<typeof esquemaTipoProcesoSalida> {
  return {
    id: tipo.id,
    codigo: tipo.codigo,
    nombre: tipo.nombre,
    generaEntradaPt: tipo.generaEntradaPt,
    esArte: tipo.esArte,
    usaPuntadas: tipo.usaPuntadas,
    codigoRolProveedor: tipo.codigoRolProveedor,
    activo: tipo.activo,
    creadoEn: tipo.creadoEn.toISOString(),
    creadoPorId: tipo.creadoPorId,
    modificadoEn: tipo.modificadoEn.toISOString(),
    modificadoPorId: tipo.modificadoPorId,
  };
}

/** Parámetro de ruta `:id`. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del tipo de proceso debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del tipo de proceso.'),
});

/** El cuerpo del PATCH no repite el `id` (va en la URL). */
const esquemaTipoProcesoPatchCuerpo = esquemaTipoProcesoEditar.omit({ id: true });

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de tipos de proceso (montadas bajo `/api`). */
export const rutasTiposProceso: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/tipos-proceso',
    preHandler: app.conPermiso('tipos-proceso.ver'),
    schema: {
      tags: ['tipos-proceso'],
      summary: 'Listar tipos de proceso',
      security: SEGURIDAD_SESION,
      querystring: esquemaTiposProcesoQuery,
      response: { 200: esquemaTiposProcesoPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarTiposProceso(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aTipoProcesoSalida) };
    },
  });

  app.route({
    method: 'GET',
    url: '/tipos-proceso/:id',
    preHandler: app.conPermiso('tipos-proceso.ver'),
    schema: {
      tags: ['tipos-proceso'],
      summary: 'Obtener un tipo de proceso',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaTipoProcesoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aTipoProcesoSalida(await obtenerTipoProceso(sesion, request.params.id));
    },
  });

  app.route({
    method: 'POST',
    url: '/tipos-proceso',
    preHandler: app.conPermiso('tipos-proceso.administrar'),
    schema: {
      tags: ['tipos-proceso'],
      summary: 'Crear un tipo de proceso',
      security: SEGURIDAD_SESION,
      body: esquemaTipoProcesoCrear,
      response: { 201: esquemaTipoProcesoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const tipo = await crearTipoProceso(sesion, request.body);
      return reply.code(201).send(aTipoProcesoSalida(tipo));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/tipos-proceso/:id',
    preHandler: app.conPermiso('tipos-proceso.administrar'),
    schema: {
      tags: ['tipos-proceso'],
      summary: 'Actualizar un tipo de proceso',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaTipoProcesoPatchCuerpo,
      response: { 200: esquemaTipoProcesoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const tipo = await actualizarTipoProceso(sesion, { ...request.body, id: request.params.id });
      return aTipoProcesoSalida(tipo);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/tipos-proceso/:id',
    preHandler: app.conPermiso('tipos-proceso.administrar'),
    schema: {
      tags: ['tipos-proceso'],
      summary: 'Desactivar un tipo de proceso (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaTipoProcesoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aTipoProcesoSalida(await desactivarTipoProceso(sesion, request.params.id));
    },
  });

  done();
};
