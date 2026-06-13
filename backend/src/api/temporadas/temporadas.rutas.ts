/**
 * Rutas REST de Temporadas — catálogo maestro global (F1-E1). Calca el ESTÁNDAR de
 * ruta de Almacenes (`api/almacenes/almacenes.rutas.ts`): cada handler solo (A1)
 * valida (Zod compartido), autoriza (`temporadas.ver`/`.administrar`, §9.2) y delega
 * al servicio `dominio/catalogos/temporadas`. CERO lógica de negocio o datos aquí.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaTemporadaCrear,
  esquemaTemporadaEditar,
  esquemaTemporadasPagina,
  esquemaTemporadasQuery,
  esquemaTemporadaSalida,
} from '../../contrato/index.js';
import type { Temporada } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarTemporada,
  crearTemporada,
  desactivarTemporada,
  listarTemporadas,
  obtenerTemporada,
} from '../../dominio/catalogos/temporadas.js';

/** Proyecta el modelo Prisma `Temporada` a la forma JSON del contrato (fechas ISO). */
function aTemporadaSalida(temporada: Temporada): z.infer<typeof esquemaTemporadaSalida> {
  return {
    id: temporada.id,
    nombre: temporada.nombre,
    activo: temporada.activo,
    creadoEn: temporada.creadoEn.toISOString(),
    creadoPorId: temporada.creadoPorId,
    modificadoEn: temporada.modificadoEn.toISOString(),
    modificadoPorId: temporada.modificadoPorId,
  };
}

/** Parámetro de ruta `:id` (entero positivo). Reutilizado por GET/PATCH/DELETE. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la temporada debe ser un número' })
    .int({ error: 'El id de la temporada debe ser entero' })
    .positive({ error: 'El id de la temporada debe ser positivo' })
    .describe('Id de la temporada.'),
});

/** El cuerpo del PATCH no repite el `id` (va en la URL). */
const esquemaTemporadaPatchCuerpo = esquemaTemporadaEditar.omit({ id: true });

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de temporadas (montadas bajo `/api`). */
export const rutasTemporadas: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Listar (búsqueda + orden + paginación en servidor) ─────────────────────
  app.route({
    method: 'GET',
    url: '/temporadas',
    preHandler: app.conPermiso('temporadas.ver'),
    schema: {
      tags: ['temporadas'],
      summary: 'Listar temporadas',
      security: SEGURIDAD_SESION,
      querystring: esquemaTemporadasQuery,
      response: { 200: esquemaTemporadasPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarTemporadas(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aTemporadaSalida) };
    },
  });

  // ── Obtener una ────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/temporadas/:id',
    preHandler: app.conPermiso('temporadas.ver'),
    schema: {
      tags: ['temporadas'],
      summary: 'Obtener una temporada',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaTemporadaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aTemporadaSalida(await obtenerTemporada(sesion, request.params.id));
    },
  });

  // ── Crear ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/temporadas',
    preHandler: app.conPermiso('temporadas.administrar'),
    schema: {
      tags: ['temporadas'],
      summary: 'Crear una temporada',
      security: SEGURIDAD_SESION,
      body: esquemaTemporadaCrear,
      response: { 201: esquemaTemporadaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const temporada = await crearTemporada(sesion, request.body);
      return reply.code(201).send(aTemporadaSalida(temporada));
    },
  });

  // ── Actualizar (parcial; incluye activar/desactivar con `activo`) ──────────
  app.route({
    method: 'PATCH',
    url: '/temporadas/:id',
    preHandler: app.conPermiso('temporadas.administrar'),
    schema: {
      tags: ['temporadas'],
      summary: 'Actualizar una temporada',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaTemporadaPatchCuerpo,
      response: { 200: esquemaTemporadaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const temporada = await actualizarTemporada(sesion, {
        ...request.body,
        id: request.params.id,
      });
      return aTemporadaSalida(temporada);
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/temporadas/:id',
    preHandler: app.conPermiso('temporadas.administrar'),
    schema: {
      tags: ['temporadas'],
      summary: 'Desactivar una temporada (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaTemporadaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aTemporadaSalida(await desactivarTemporada(sesion, request.params.id));
    },
  });

  done();
};
