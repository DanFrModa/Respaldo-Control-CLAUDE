/**
 * Rutas REST del catálogo de DEFECTOS de calidad (F6-E1 — ex `CC_Catalogo`). Rutas delgadas (A1):
 * validan con los esquemas Zod compartidos, autorizan server-side (`calidad.ver` lee,
 * `calidad.administrar-catalogo` muta — deny-by-default, §9.2) y delegan al servicio de dominio
 * `dominio/calidad/defectos`. Montadas bajo `/api`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaDefectoCrear,
  esquemaDefectoEditar,
  esquemaDefectoSalida,
  esquemaDefectosPagina,
  esquemaDefectosQuery,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarDefecto,
  crearDefecto,
  desactivarDefecto,
  listarDefectos,
  obtenerDefecto,
  type DefectoConTipos,
} from '../../dominio/calidad/defectos.js';

/** Proyecta el defecto (con sus tipos ligados) a la forma JSON del contrato (Decimal→número, ISO). */
function aSalida(defecto: DefectoConTipos): z.infer<typeof esquemaDefectoSalida> {
  return {
    id: defecto.id,
    clave: defecto.clave,
    descripcion: defecto.descripcion,
    pag: defecto.pag,
    nivelAQL: defecto.nivelAQL.toNumber(),
    favorito: defecto.favorito,
    categoria: defecto.categoria,
    severidad: defecto.severidad,
    aplicaGeneral: defecto.aplicaGeneral,
    tiposProducto: defecto.tiposLigados.map((l) => ({
      id: l.tipoProducto.id,
      nombre: l.tipoProducto.nombre,
    })),
    activo: defecto.activo,
    creadoEn: defecto.creadoEn.toISOString(),
    creadoPorId: defecto.creadoPorId,
    modificadoEn: defecto.modificadoEn.toISOString(),
    modificadoPorId: defecto.modificadoPorId,
  };
}

const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del defecto debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del defecto.'),
});

const esquemaPatchCuerpo = esquemaDefectoEditar.omit({ id: true });

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

export const rutasDefectos: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/calidad/defectos',
    preHandler: app.conPermiso('calidad.ver'),
    schema: {
      tags: ['calidad'],
      summary: 'Listar defectos del catálogo',
      security: SEGURIDAD_SESION,
      querystring: esquemaDefectosQuery,
      response: { 200: esquemaDefectosPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarDefectos(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aSalida) };
    },
  });

  app.route({
    method: 'GET',
    url: '/calidad/defectos/:id',
    preHandler: app.conPermiso('calidad.ver'),
    schema: {
      tags: ['calidad'],
      summary: 'Obtener un defecto',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaDefectoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aSalida(await obtenerDefecto(sesion, request.params.id));
    },
  });

  app.route({
    method: 'POST',
    url: '/calidad/defectos',
    preHandler: app.conPermiso('calidad.administrar-catalogo'),
    schema: {
      tags: ['calidad'],
      summary: 'Crear un defecto',
      security: SEGURIDAD_SESION,
      body: esquemaDefectoCrear,
      response: { 201: esquemaDefectoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const defecto = await crearDefecto(sesion, request.body);
      return reply.code(201).send(aSalida(defecto));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/calidad/defectos/:id',
    preHandler: app.conPermiso('calidad.administrar-catalogo'),
    schema: {
      tags: ['calidad'],
      summary: 'Actualizar un defecto',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaPatchCuerpo,
      response: { 200: esquemaDefectoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const defecto = await actualizarDefecto(sesion, { ...request.body, id: request.params.id });
      return aSalida(defecto);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/calidad/defectos/:id',
    preHandler: app.conPermiso('calidad.administrar-catalogo'),
    schema: {
      tags: ['calidad'],
      summary: 'Desactivar un defecto (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaDefectoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aSalida(await desactivarDefecto(sesion, request.params.id));
    },
  });

  done();
};
