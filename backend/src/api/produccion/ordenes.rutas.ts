/**
 * Rutas REST del Módulo ÓRDENES de producción (F2-E2). Calca el ESTÁNDAR de las rutas de
 * Pedidos/Clientes/Modelos: cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `ordenes.ver` para leer, `ordenes.administrar` para mutar, `ordenes.cancelar` para cancelar.
 *  3. **Delega** a los servicios de dominio (`dominio/produccion/ordenes.ts`).
 *
 * Endpoints: `GET /ordenes` (listado/búsqueda combinada, incl. valor de OrdenReferencia D7),
 * `GET /ordenes/:id`, `POST /ordenes` (crear desde renglón de pedido), `PUT /ordenes/:id`
 * (encabezado), `PUT /ordenes/:id/matriz` (colores × tallas), `POST /ordenes/:id/copiar-matriz`,
 * `POST /ordenes/:id/cancelar` (motivo obligatorio), `PUT /ordenes/:id/referencias` (D7),
 * `POST /ordenes/:id/comentarios`. NO hay rutas de UPC (decisión Gabriel 16-jun-2026).
 * Rediseño R2 (§4.4.3): `GET /ordenes/:id/precios` (resumen, `ordenes.ver`; montos reales solo con
 * `ordenes.ver-precio-real-maquila`), `PATCH /ordenes/:id/precios` (capturar precio real,
 * `ordenes.precio-maquila`) y `GET /ordenes/:id/precios/eventos` (historial inmutable).
 *
 * CERO lógica de negocio o acceso a datos aquí; los errores de dominio los traduce el error
 * handler global (`src/api/errores.ts`).
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasOrdenes, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaListarOrdenes,
  esquemaOrdenCancelarCuerpo,
  esquemaOrdenComentarioCuerpo,
  esquemaOrdenCopiarMatrizCuerpo,
  esquemaOrdenCrear,
  esquemaOrdenMatrizCuerpo,
  esquemaOrdenPatchCuerpo,
  esquemaOrdenPrecioEventosLista,
  esquemaOrdenPreciosPatchCuerpo,
  esquemaOrdenPreciosSalida,
  esquemaOrdenReferenciasCuerpo,
  esquemaOrdenSalida,
  esquemaOrdenesPagina,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarOrden,
  agregarComentarioOrden,
  cancelarOrden,
  copiarDetalleOrden,
  crearOrden,
  guardarMatrizOrden,
  guardarReferenciasOrden,
  listarOrdenes,
  obtenerOrden,
} from '../../dominio/produccion/ordenes.js';
import {
  actualizarPreciosOrden,
  listarEventosPrecioOrden,
  obtenerPreciosOrden,
} from '../../dominio/produccion/precios-orden.js';

/** Parámetro de ruta `:id` (orden). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la orden debe ser un número' })
    .int({ error: 'El id de la orden debe ser entero' })
    .positive({ error: 'El id de la orden debe ser positivo' })
    .describe('Id de la orden.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de órdenes de producción (montadas bajo `/api`). */
export const rutasOrdenes: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Listar (búsqueda combinada folio/modelo/cliente/referencia + filtros + orden + paginación).
  app.route({
    method: 'GET',
    url: '/ordenes',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Listar órdenes de producción',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarOrdenes,
      response: { 200: esquemaOrdenesPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarOrdenes(sesion, request.query);
    },
  });

  // Obtener una (con matriz, total derivado, referencias y comentarios).
  app.route({
    method: 'GET',
    url: '/ordenes/:id',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Obtener una orden de producción',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerOrden(sesion, request.params.id);
    },
  });

  // Crear (desde un renglón de pedido; autorrelleno de modelo/cliente/empresa).
  app.route({
    method: 'POST',
    url: '/ordenes',
    preHandler: app.conPermiso('ordenes.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Crear una orden de producción desde un renglón de pedido',
      security: SEGURIDAD_SESION,
      body: esquemaOrdenCrear,
      response: { 201: esquemaOrdenSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const orden = await crearOrden(sesion, request.body);
      return reply.code(201).send(orden);
    },
  });

  // Actualizar el ENCABEZADO (fechas, etiqueta, tela, maquilero, composición, observaciones…).
  // PATCH: el update del encabezado es PARCIAL (cuerpo `esquemaOrdenPatchCuerpo`); uniforme con el
  // gemelo `pedidos.rutas.ts`. La matriz y las referencias sí usan PUT (reemplazo del set completo).
  app.route({
    method: 'PATCH',
    url: '/ordenes/:id',
    preHandler: app.conPermiso('ordenes.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Actualizar el encabezado de una orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaOrdenPatchCuerpo,
      response: { 200: esquemaOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarOrden(sesion, { ...request.body, id: request.params.id });
    },
  });

  // Guardar la MATRIZ (colores × tallas). Deriva estado='completa' en el primer guardado.
  app.route({
    method: 'PUT',
    url: '/ordenes/:id/matriz',
    preHandler: app.conPermiso('ordenes.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Guardar la matriz de una orden (colores y tallas)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaOrdenMatrizCuerpo,
      response: { 200: esquemaOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return guardarMatrizOrden(sesion, request.params.id, request.body);
    },
  });

  // Copiar la matriz de OTRA orden (mapeo por etiqueta de talla).
  app.route({
    method: 'POST',
    url: '/ordenes/:id/copiar-matriz',
    preHandler: app.conPermiso('ordenes.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Copiar la matriz de otra orden a esta',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaOrdenCopiarMatrizCuerpo,
      response: { 200: esquemaOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return copiarDetalleOrden(sesion, request.params.id, request.body);
    },
  });

  // Cancelar (cancelación suave; motivo obligatorio). Permiso PROPIO.
  app.route({
    method: 'POST',
    url: '/ordenes/:id/cancelar',
    preHandler: app.conPermiso('ordenes.cancelar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Cancelar una orden (cancelación suave, motivo obligatorio)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaOrdenCancelarCuerpo,
      response: { 200: esquemaOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarOrden(sesion, request.params.id, request.body);
    },
  });

  // Guardar el SET de referencias del cliente (D7).
  app.route({
    method: 'PUT',
    url: '/ordenes/:id/referencias',
    preHandler: app.conPermiso('ordenes.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Guardar las referencias (campos de cliente) de una orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaOrdenReferenciasCuerpo,
      response: { 200: esquemaOrdenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return guardarReferenciasOrden(sesion, request.params.id, request.body);
    },
  });

  // ── Precios de la orden con rastro inmutable (rediseño R2, §4.4.3) ──────────
  // Resumen para el panel (los montos reales van null sin `ordenes.ver-precio-real-maquila`).
  app.route({
    method: 'GET',
    url: '/ordenes/:id/precios',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Resumen de precios de la orden (venta/maquila/aplicación) con su rastro',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaOrdenPreciosSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerPreciosOrden(sesion, request.params.id);
    },
  });

  // Capturar el precio REAL negociado (permiso LEGADO `ordenes.precio-maquila`, acceso 4 del viejo).
  app.route({
    method: 'PATCH',
    url: '/ordenes/:id/precios',
    preHandler: app.conPermiso('ordenes.precio-maquila'),
    schema: {
      tags: ['ordenes'],
      summary: 'Capturar el precio real de maquila/aplicación (deja rastro inmutable)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaOrdenPreciosPatchCuerpo,
      response: { 200: esquemaOrdenPreciosSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return actualizarPreciosOrden(sesion, request.params.id, request.body);
    },
  });

  // Historial completo (con montos): permiso LEGADO `ordenes.ver-precio-real-maquila` (acceso 36).
  app.route({
    method: 'GET',
    url: '/ordenes/:id/precios/eventos',
    preHandler: app.conPermiso('ordenes.ver-precio-real-maquila'),
    schema: {
      tags: ['ordenes'],
      summary: 'Historial inmutable de cambios de precio de la orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaOrdenPrecioEventosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarEventosPrecioOrden(sesion, request.params.id);
    },
  });

  // Agregar un comentario inmutable.
  app.route({
    method: 'POST',
    url: '/ordenes/:id/comentarios',
    preHandler: app.conPermiso('ordenes.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Agregar un comentario a una orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaOrdenComentarioCuerpo,
      response: { 201: esquemaOrdenSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const orden = await agregarComentarioOrden(sesion, request.params.id, request.body);
      return reply.code(201).send(orden);
    },
  });

  done();
};
