/**
 * Rutas REST del Módulo PEDIDOS (F2-E1): el pedido INTERNO (CRUD + copiar + cancelar) y el
 * pedido REAL (crear desde un pedido, listar, editar y seguimiento). Calca el ESTÁNDAR de las
 * rutas de Clientes/Modelos: cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `pedidos.ver` para leer, `pedidos.administrar` para mutar el pedido interno,
 *     `pedidos-reales.administrar` para los pedidos reales. El ocultamiento de IMPORTES
 *     (`pedidos.importes`) lo decide el DOMINIO en la serialización (no se filtra aquí).
 *  3. **Delega** a los servicios de dominio (`dominio/pedidos/*`).
 *
 * Endpoints: CRUD `/pedidos` (+ `:id`), `POST /pedidos/:id/copiar`, `POST /pedidos/:id/cancelar`,
 * y los pedidos reales anidados `/pedidos/:id/reales` (POST crear, GET listar) +
 * `/pedidos-reales/:idReal` (PATCH encabezado) + `/pedidos-reales/:idReal/seguimiento` (PATCH).
 * CERO lógica de negocio o acceso a datos aquí; los errores de dominio los traduce el error
 * handler global (`src/api/errores.ts`).
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasPedidos, { prefix: '/api' })`).
 *
 * DIFERIDO (F2-E1): NO hay ruta de cancelación de pedido real (pendiente de decisión de Daniel).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaListarPedidos,
  esquemaPedidoCopiarCuerpo,
  esquemaPedidoCrear,
  esquemaPedidoPatchCuerpo,
  esquemaPedidoRealCrear,
  esquemaPedidoRealEditar,
  esquemaPedidoRealesLista,
  esquemaPedidoRealSalida,
  esquemaPedidoRealSeguimientoCuerpo,
  esquemaPedidoSalida,
  esquemaPedidosPagina,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarPedido,
  cancelarPedido,
  copiarPedido,
  crearPedido,
  listarPedidos,
  obtenerPedido,
} from '../../dominio/pedidos/pedidos.js';
import {
  actualizarPedidoReal,
  actualizarSeguimientoPedidoReal,
  crearPedidoReal,
  listarPedidosReales,
} from '../../dominio/pedidos/pedidos-reales.js';

/** Parámetro de ruta `:id` (pedido interno). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del pedido debe ser un número' })
    .int({ error: 'El id del pedido debe ser entero' })
    .positive({ error: 'El id del pedido debe ser positivo' })
    .describe('Id del pedido.'),
});

/** Parámetro de ruta `:idReal` (pedido real). */
const esquemaParamIdReal = z.object({
  idReal: z.coerce
    .number({ error: 'El id del pedido real debe ser un número' })
    .int({ error: 'El id del pedido real debe ser entero' })
    .positive({ error: 'El id del pedido real debe ser positivo' })
    .describe('Id del pedido real.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de pedidos y pedidos reales (montadas bajo `/api`). */
export const rutasPedidos: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Pedidos internos ────────────────────────────────────────────────────────

  // Listar (búsqueda + filtro por cliente + orden + paginación en servidor).
  app.route({
    method: 'GET',
    url: '/pedidos',
    preHandler: app.conPermiso('pedidos.ver'),
    schema: {
      tags: ['pedidos'],
      summary: 'Listar pedidos internos',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarPedidos,
      response: { 200: esquemaPedidosPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarPedidos(sesion, request.query);
    },
  });

  // Obtener uno (con renglones + fotos de modelo).
  app.route({
    method: 'GET',
    url: '/pedidos/:id',
    preHandler: app.conPermiso('pedidos.ver'),
    schema: {
      tags: ['pedidos'],
      summary: 'Obtener un pedido interno',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaPedidoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerPedido(sesion, request.params.id);
    },
  });

  // Crear.
  app.route({
    method: 'POST',
    url: '/pedidos',
    preHandler: app.conPermiso('pedidos.administrar'),
    schema: {
      tags: ['pedidos'],
      summary: 'Crear un pedido interno',
      security: SEGURIDAD_SESION,
      body: esquemaPedidoCrear,
      response: { 201: esquemaPedidoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pedido = await crearPedido(sesion, request.body);
      return reply.code(201).send(pedido);
    },
  });

  // Actualizar (encabezado + set de renglones).
  app.route({
    method: 'PATCH',
    url: '/pedidos/:id',
    preHandler: app.conPermiso('pedidos.administrar'),
    schema: {
      tags: ['pedidos'],
      summary: 'Actualizar un pedido interno',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaPedidoPatchCuerpo,
      response: { 200: esquemaPedidoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarPedido(sesion, { ...request.body, id: request.params.id });
    },
  });

  // Copiar (clon + renglones seleccionados, folio nuevo).
  app.route({
    method: 'POST',
    url: '/pedidos/:id/copiar',
    preHandler: app.conPermiso('pedidos.administrar'),
    schema: {
      tags: ['pedidos'],
      summary: 'Copiar un pedido en uno nuevo (renglones seleccionados)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaPedidoCopiarCuerpo,
      response: { 201: esquemaPedidoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pedido = await copiarPedido(sesion, request.params.id, request.body);
      return reply.code(201).send(pedido);
    },
  });

  // Cancelar (cancelación suave).
  app.route({
    method: 'POST',
    url: '/pedidos/:id/cancelar',
    preHandler: app.conPermiso('pedidos.administrar'),
    schema: {
      tags: ['pedidos'],
      summary: 'Cancelar un pedido (cancelación suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaPedidoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarPedido(sesion, request.params.id);
    },
  });

  // ── Pedidos reales (anidados al pedido interno) ───────────────────────────────

  // Listar los pedidos reales de un pedido.
  app.route({
    method: 'GET',
    url: '/pedidos/:id/reales',
    preHandler: app.conPermiso('pedidos.ver'),
    schema: {
      tags: ['pedidos'],
      summary: 'Listar los pedidos reales de un pedido interno',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaPedidoRealesLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await listarPedidosReales(sesion, request.params.id);
      return { datos };
    },
  });

  // Crear un pedido real desde un pedido (réplica automática de renglones).
  app.route({
    method: 'POST',
    url: '/pedidos/:id/reales',
    preHandler: app.conPermiso('pedidos-reales.administrar'),
    schema: {
      tags: ['pedidos'],
      summary: 'Crear un pedido real desde un pedido interno',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaPedidoRealCrear,
      response: { 201: esquemaPedidoRealSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const real = await crearPedidoReal(sesion, request.params.id, request.body);
      return reply.code(201).send(real);
    },
  });

  // Actualizar el ENCABEZADO de un pedido real.
  app.route({
    method: 'PATCH',
    url: '/pedidos-reales/:idReal',
    preHandler: app.conPermiso('pedidos-reales.administrar'),
    schema: {
      tags: ['pedidos'],
      summary: 'Actualizar el encabezado de un pedido real',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdReal,
      body: esquemaPedidoRealEditar,
      response: { 200: esquemaPedidoRealSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarPedidoReal(sesion, request.params.idReal, request.body);
    },
  });

  // Capturar el SEGUIMIENTO por renglón de un pedido real.
  app.route({
    method: 'PATCH',
    url: '/pedidos-reales/:idReal/seguimiento',
    preHandler: app.conPermiso('pedidos-reales.administrar'),
    schema: {
      tags: ['pedidos'],
      summary: 'Capturar el seguimiento por renglón de un pedido real',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdReal,
      body: esquemaPedidoRealSeguimientoCuerpo,
      response: { 200: esquemaPedidoRealSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarSeguimientoPedidoReal(sesion, request.params.idReal, request.body);
    },
  });

  done();
};
