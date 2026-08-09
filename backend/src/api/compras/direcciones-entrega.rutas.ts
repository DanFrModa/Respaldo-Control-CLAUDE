/**
 * Rutas REST del catálogo de DIRECCIONES DE ENTREGA (§Post-F9.18). Calca el estándar de
 * `api/temporadas/temporadas.rutas.ts`: cada handler solo (A1) valida con el Zod compartido,
 * autoriza y delega al servicio `dominio/catalogos/direcciones-entrega`. CERO lógica aquí.
 *
 * Vive bajo `compras/` porque es un catálogo de apoyo de la orden de compra y se gobierna con sus
 * permisos (`compras.ver` / `compras.administrar`) — sin permisos propios, así que estrenarlo no
 * requiere `SEED_ON_START`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaDireccionEntregaCrear,
  esquemaDireccionEntregaEditar,
  esquemaDireccionEntregaSalida,
  esquemaDireccionesEntregaPagina,
  esquemaDireccionesEntregaQuery,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { DireccionEntrega } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarDireccionEntrega,
  crearDireccionEntrega,
  desactivarDireccionEntrega,
  listarDireccionesEntrega,
  obtenerDireccionEntrega,
} from '../../dominio/catalogos/direcciones-entrega.js';

/** Proyecta el modelo Prisma a la forma JSON del contrato (fechas ISO). */
function aSalida(direccion: DireccionEntrega): z.infer<typeof esquemaDireccionEntregaSalida> {
  return {
    id: direccion.id,
    nombre: direccion.nombre,
    direccion: direccion.direccion,
    contacto: direccion.contacto,
    telefono: direccion.telefono,
    favorita: direccion.favorita,
    activo: direccion.activo,
    creadoEn: direccion.creadoEn.toISOString(),
    creadoPorId: direccion.creadoPorId,
    modificadoEn: direccion.modificadoEn.toISOString(),
    modificadoPorId: direccion.modificadoPorId,
  };
}

/** Parámetro de ruta `:id` (entero positivo). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la dirección debe ser un número' })
    .int({ error: 'El id de la dirección debe ser entero' })
    .positive({ error: 'El id de la dirección debe ser positivo' })
    .describe('Id de la dirección de entrega.'),
});

/** El cuerpo del PATCH no repite el `id` (va en la URL). */
const esquemaPatchCuerpo = esquemaDireccionEntregaEditar.omit({ id: true });

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del catálogo de direcciones de entrega (montadas bajo `/api`). */
export const rutasDireccionesEntrega: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Listar (la favorita sale primero) ──────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/compras/direcciones-entrega',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Listar direcciones de entrega',
      security: SEGURIDAD_SESION,
      querystring: esquemaDireccionesEntregaQuery,
      response: { 200: esquemaDireccionesEntregaPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarDireccionesEntrega(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aSalida) };
    },
  });

  // ── Obtener una ────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/compras/direcciones-entrega/:id',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Obtener una dirección de entrega',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaDireccionEntregaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aSalida(await obtenerDireccionEntrega(sesion, request.params.id));
    },
  });

  // ── Crear ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/compras/direcciones-entrega',
    preHandler: app.conPermiso('compras.administrar'),
    schema: {
      tags: ['compras'],
      summary: 'Crear una dirección de entrega',
      security: SEGURIDAD_SESION,
      body: esquemaDireccionEntregaCrear,
      response: { 201: esquemaDireccionEntregaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const direccion = await crearDireccionEntrega(sesion, request.body);
      return reply.code(201).send(aSalida(direccion));
    },
  });

  // ── Actualizar (parcial; incluye activar/desactivar y marcar favorita) ─────
  app.route({
    method: 'PATCH',
    url: '/compras/direcciones-entrega/:id',
    preHandler: app.conPermiso('compras.administrar'),
    schema: {
      tags: ['compras'],
      summary: 'Actualizar una dirección de entrega',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaPatchCuerpo,
      response: { 200: esquemaDireccionEntregaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aSalida(
        await actualizarDireccionEntrega(sesion, { ...request.body, id: request.params.id }),
      );
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/compras/direcciones-entrega/:id',
    preHandler: app.conPermiso('compras.administrar'),
    schema: {
      tags: ['compras'],
      summary: 'Desactivar una dirección de entrega (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaDireccionEntregaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aSalida(await desactivarDireccionEntrega(sesion, request.params.id));
    },
  });

  done();
};
