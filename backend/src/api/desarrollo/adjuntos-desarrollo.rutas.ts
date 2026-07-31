/**
 * Rutas REST del TECH PACK / ADJUNTOS del DESARROLLO (rediseño R5, B16). Handlers delgados (A1):
 * validan (Zod compartido), autorizan (`conPermiso`, A4: `desarrollo.administrar` para subir/eliminar,
 * `desarrollo.ver` para listar) y delegan al dominio `dominio/desarrollo/adjuntos-desarrollo`. CERO
 * lógica de negocio aquí. NO crea permisos nuevos (reusa los `desarrollo.*`). Se registra en `app.ts`.
 *
 * Endpoints (bajo `/api`):
 *   `POST   /desarrollos/:idDesarrollo/adjuntos`            — preparar la subida (URL PUT prefirmada).
 *   `GET    /desarrollos/:idDesarrollo/adjuntos`            — listar los adjuntos (cada uno con URL GET).
 *   `DELETE /desarrollos/:idDesarrollo/adjuntos/:idArchivo` — quitar un adjunto (registro + objeto R2).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaDesarrolloAdjuntoCrear,
  esquemaDesarrolloAdjuntoSubida,
  esquemaDesarrolloAdjuntosLista,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { esquemaDesarrolloAdjuntoSalida } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  eliminarAdjunto,
  listarAdjuntos,
  solicitarSubidaAdjunto,
  type AdjuntoDesarrolloConUrl,
  type SubidaAdjuntoDesarrollo,
} from '../../dominio/desarrollo/adjuntos-desarrollo.js';

/** Parámetro de ruta `:idDesarrollo`. */
const esquemaParamIdDesarrollo = z.object({
  idDesarrollo: z.coerce
    .number({ error: 'El id del desarrollo debe ser un número' })
    .int({ error: 'El id del desarrollo debe ser entero' })
    .positive({ error: 'El id del desarrollo debe ser positivo' })
    .describe('Id del desarrollo.'),
});

/** Parámetros `:idDesarrollo` + `:idArchivo` (adjunto) para borrar un adjunto. */
const esquemaParamAdjunto = esquemaParamIdDesarrollo.extend({
  idArchivo: z.string({ error: 'El id del archivo es obligatorio' }).describe('Id del adjunto.'),
});

/** Respuestas de error comunes a toda ruta protegida. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Proyecta el resultado de preparar la subida a JSON. */
function aSubidaSalida(
  subida: SubidaAdjuntoDesarrollo,
): z.infer<typeof esquemaDesarrolloAdjuntoSubida> {
  return {
    idArchivo: subida.idArchivo,
    nombreOriginal: subida.nombreOriginal,
    urlSubida: subida.urlSubida,
    expiraEnSegundos: subida.expiraEnSegundos,
  };
}

/** Proyecta un adjunto (con URL) a su forma JSON (Date → ISO 8601). */
function aAdjuntoSalida(
  adjunto: AdjuntoDesarrolloConUrl,
): z.infer<typeof esquemaDesarrolloAdjuntoSalida> {
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

/** Registra las rutas de adjuntos del desarrollo (montadas bajo `/api`). */
export const rutasAdjuntosDesarrollo: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/desarrollos/:idDesarrollo/adjuntos',
    preHandler: [app.conPermiso('desarrollo.administrar'), app.conPermiso('desarrollo.ver')],
    schema: {
      tags: ['desarrollo'],
      summary: 'Preparar la subida de un adjunto (tech pack) del desarrollo (R5/B16)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdDesarrollo,
      body: esquemaDesarrolloAdjuntoCrear,
      response: { 201: esquemaDesarrolloAdjuntoSubida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const subida = await solicitarSubidaAdjunto(
        sesion,
        request.params.idDesarrollo,
        request.body,
      );
      return reply.code(201).send(aSubidaSalida(subida));
    },
  });

  // Listar los adjuntos de un desarrollo (cada uno con URL GET prefirmada).
  app.route({
    method: 'GET',
    url: '/desarrollos/:idDesarrollo/adjuntos',
    preHandler: app.conPermiso('desarrollo.ver'),
    schema: {
      tags: ['desarrollo'],
      summary: 'Listar los adjuntos (tech pack) de un desarrollo',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdDesarrollo,
      response: { 200: esquemaDesarrolloAdjuntosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const adjuntos = await listarAdjuntos(sesion, request.params.idDesarrollo);
      return { datos: adjuntos.map(aAdjuntoSalida) };
    },
  });

  // Quitar un adjunto del desarrollo.
  app.route({
    method: 'DELETE',
    url: '/desarrollos/:idDesarrollo/adjuntos/:idArchivo',
    preHandler: [app.conPermiso('desarrollo.administrar'), app.conPermiso('desarrollo.ver')],
    schema: {
      tags: ['desarrollo'],
      summary: 'Quitar un adjunto del desarrollo',
      security: SEGURIDAD_SESION,
      params: esquemaParamAdjunto,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await eliminarAdjunto(sesion, request.params.idDesarrollo, request.params.idArchivo);
      return reply.code(204).send(null);
    },
  });

  done();
};
