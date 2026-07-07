/**
 * Rutas REST de los ADJUNTOS de la orden de producción (F8-E6, R6). Handlers delgados (A1): validan
 * (Zod compartido), autorizan (`conPermiso`, A4: `ordenes.administrar` para subir/eliminar,
 * `ordenes.ver` para listar) y delegan al dominio `dominio/produccion/adjuntos-orden`. CERO lógica de
 * negocio aquí. NO crea permisos nuevos (reusa los `ordenes.*`). Se registra en `app.ts`.
 *
 * Endpoints (bajo `/api`):
 *   `POST   /ordenes/:idOrden/adjuntos`            — preparar la subida (URL PUT prefirmada).
 *   `GET    /ordenes/:idOrden/adjuntos`            — listar los adjuntos (cada uno con URL GET).
 *   `DELETE /ordenes/:idOrden/adjuntos/:idArchivo` — quitar un adjunto (borra registro + objeto R2).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaOrdenAdjuntoCrear,
  esquemaOrdenAdjuntoSubida,
  esquemaOrdenAdjuntosLista,
} from '../../contrato/index.js';
import type { esquemaOrdenAdjuntoSalida } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  eliminarAdjunto,
  listarAdjuntos,
  solicitarSubidaAdjunto,
  type AdjuntoOrdenConUrl,
  type SubidaAdjuntoOrden,
} from '../../dominio/produccion/adjuntos-orden.js';

/** Parámetro de ruta `:idOrden` (orden de producción). */
const esquemaParamIdOrden = z.object({
  idOrden: z.coerce
    .number({ error: 'El id de la orden debe ser un número' })
    .int({ error: 'El id de la orden debe ser entero' })
    .positive({ error: 'El id de la orden debe ser positivo' })
    .describe('Id de la orden de producción.'),
});

/** Parámetros `:idOrden` + `:idArchivo` (adjunto) para borrar un adjunto. */
const esquemaParamAdjunto = esquemaParamIdOrden.extend({
  idArchivo: z.string({ error: 'El id del archivo es obligatorio' }).describe('Id del adjunto.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Proyecta el resultado de preparar la subida a JSON. */
function aSubidaSalida(subida: SubidaAdjuntoOrden): z.infer<typeof esquemaOrdenAdjuntoSubida> {
  return {
    idArchivo: subida.idArchivo,
    nombreOriginal: subida.nombreOriginal,
    urlSubida: subida.urlSubida,
    expiraEnSegundos: subida.expiraEnSegundos,
  };
}

/** Proyecta un adjunto (con URL) a su forma JSON (Date → ISO 8601). */
function aAdjuntoSalida(adjunto: AdjuntoOrdenConUrl): z.infer<typeof esquemaOrdenAdjuntoSalida> {
  return {
    idArchivo: adjunto.idArchivo,
    nombreOriginal: adjunto.nombreOriginal,
    tipoMime: adjunto.tipoMime,
    tamanoBytes: adjunto.tamanoBytes,
    urlDescarga: adjunto.urlDescarga,
    subidoPorId: adjunto.subidoPorId,
    creadoEn: adjunto.creadoEn.toISOString(),
  };
}

/** Registra las rutas de adjuntos de la orden (montadas bajo `/api`). */
export const rutasAdjuntosOrden: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Preparar la subida de un adjunto (devuelve URL PUT prefirmada).
  app.route({
    method: 'POST',
    url: '/ordenes/:idOrden/adjuntos',
    preHandler: app.conPermiso('ordenes.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Preparar la subida de un adjunto de la orden (R6/E6)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdOrden,
      body: esquemaOrdenAdjuntoCrear,
      response: { 201: esquemaOrdenAdjuntoSubida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const subida = await solicitarSubidaAdjunto(sesion, request.params.idOrden, request.body);
      return reply.code(201).send(aSubidaSalida(subida));
    },
  });

  // Listar los adjuntos de una orden (cada uno con URL GET prefirmada).
  app.route({
    method: 'GET',
    url: '/ordenes/:idOrden/adjuntos',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Listar los adjuntos de una orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdOrden,
      response: { 200: esquemaOrdenAdjuntosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const adjuntos = await listarAdjuntos(sesion, request.params.idOrden);
      return { datos: adjuntos.map(aAdjuntoSalida) };
    },
  });

  // Quitar un adjunto de la orden.
  app.route({
    method: 'DELETE',
    url: '/ordenes/:idOrden/adjuntos/:idArchivo',
    preHandler: app.conPermiso('ordenes.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Quitar un adjunto de la orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamAdjunto,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await eliminarAdjunto(sesion, request.params.idOrden, request.params.idArchivo);
      return reply.code(204).send(null);
    },
  });

  done();
};
