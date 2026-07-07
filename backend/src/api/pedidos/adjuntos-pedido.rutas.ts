/**
 * Rutas REST de los ADJUNTOS del pedido interno (rediseño R3, B3). Handlers delgados (A1): validan
 * (Zod compartido), autorizan (`conPermiso`, A4: `pedidos.administrar` para subir/eliminar,
 * `pedidos.ver` para listar) y delegan al dominio `dominio/pedidos/adjuntos-pedido`. CERO lógica
 * de negocio aquí. NO crea permisos nuevos (reusa los `pedidos.*` — espejo de los adjuntos de
 * orden con `ordenes.*`). Se registra en `app.ts`.
 *
 * Endpoints (bajo `/api`):
 *   `POST   /pedidos/:idPedido/adjuntos`            — preparar la subida (URL PUT prefirmada).
 *   `GET    /pedidos/:idPedido/adjuntos`            — listar los adjuntos (cada uno con URL GET).
 *   `DELETE /pedidos/:idPedido/adjuntos/:idArchivo` — quitar un adjunto (borra registro + objeto R2).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaPedidoAdjuntoCrear,
  esquemaPedidoAdjuntoSubida,
  esquemaPedidoAdjuntosLista,
} from '../../contrato/index.js';
import type { esquemaPedidoAdjuntoSalida } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  eliminarAdjuntoPedido,
  listarAdjuntosPedido,
  solicitarSubidaAdjuntoPedido,
  type AdjuntoPedidoConUrl,
  type SubidaAdjuntoPedido,
} from '../../dominio/pedidos/adjuntos-pedido.js';

/** Parámetro de ruta `:idPedido` (pedido interno). */
const esquemaParamIdPedido = z.object({
  idPedido: z.coerce
    .number({ error: 'El id del pedido debe ser un número' })
    .int({ error: 'El id del pedido debe ser entero' })
    .positive({ error: 'El id del pedido debe ser positivo' })
    .describe('Id del pedido interno.'),
});

/** Parámetros `:idPedido` + `:idArchivo` (adjunto) para borrar un adjunto. */
const esquemaParamAdjunto = esquemaParamIdPedido.extend({
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
function aSubidaSalida(subida: SubidaAdjuntoPedido): z.infer<typeof esquemaPedidoAdjuntoSubida> {
  return {
    idArchivo: subida.idArchivo,
    nombreOriginal: subida.nombreOriginal,
    urlSubida: subida.urlSubida,
    expiraEnSegundos: subida.expiraEnSegundos,
  };
}

/** Proyecta un adjunto (con URL) a su forma JSON (Date → ISO 8601). */
function aAdjuntoSalida(adjunto: AdjuntoPedidoConUrl): z.infer<typeof esquemaPedidoAdjuntoSalida> {
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

/** Registra las rutas de adjuntos del pedido (montadas bajo `/api`). */
export const rutasAdjuntosPedido: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/pedidos/:idPedido/adjuntos',
    preHandler: app.conPermiso('pedidos.administrar'),
    schema: {
      tags: ['pedidos'],
      summary: 'Preparar la subida de un adjunto del pedido (R3, B3 — la OC original del cliente)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdPedido,
      body: esquemaPedidoAdjuntoCrear,
      response: { 201: esquemaPedidoAdjuntoSubida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const subida = await solicitarSubidaAdjuntoPedido(
        sesion,
        request.params.idPedido,
        request.body,
      );
      return reply.code(201).send(aSubidaSalida(subida));
    },
  });

  // Listar los adjuntos de un pedido (cada uno con URL GET prefirmada).
  app.route({
    method: 'GET',
    url: '/pedidos/:idPedido/adjuntos',
    preHandler: app.conPermiso('pedidos.ver'),
    schema: {
      tags: ['pedidos'],
      summary: 'Listar los adjuntos de un pedido',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdPedido,
      response: { 200: esquemaPedidoAdjuntosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const adjuntos = await listarAdjuntosPedido(sesion, request.params.idPedido);
      return { datos: adjuntos.map(aAdjuntoSalida) };
    },
  });

  // Quitar un adjunto del pedido.
  app.route({
    method: 'DELETE',
    url: '/pedidos/:idPedido/adjuntos/:idArchivo',
    preHandler: app.conPermiso('pedidos.administrar'),
    schema: {
      tags: ['pedidos'],
      summary: 'Quitar un adjunto del pedido',
      security: SEGURIDAD_SESION,
      params: esquemaParamAdjunto,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await eliminarAdjuntoPedido(sesion, request.params.idPedido, request.params.idArchivo);
      return reply.code(204).send(null);
    },
  });

  done();
};
