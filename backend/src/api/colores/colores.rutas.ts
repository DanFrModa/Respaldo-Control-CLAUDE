/**
 * Rutas REST de Colores — catálogo maestro global (F1-E1). Calca el ESTÁNDAR de ruta
 * de Almacenes (`api/almacenes/almacenes.rutas.ts`): cada handler solo (A1) valida
 * (Zod compartido), autoriza (`colores.ver`/`.administrar`, §9.2) y delega al servicio
 * `dominio/catalogos/colores`. CERO lógica de negocio o datos aquí (la normalización
 * del nombre vive en el dominio).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaColorCrear,
  esquemaColorEditar,
  esquemaColoresPagina,
  esquemaColoresQuery,
  esquemaColorFusionar,
  esquemaColorSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { Color } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarColor,
  crearColor,
  desactivarColor,
  fusionarColores,
  listarColores,
  obtenerColor,
} from '../../dominio/catalogos/colores.js';

/** Proyecta el modelo Prisma `Color` a la forma JSON del contrato (fechas ISO). */
function aColorSalida(color: Color): z.infer<typeof esquemaColorSalida> {
  return {
    id: color.id,
    nombre: color.nombre,
    activo: color.activo,
    creadoEn: color.creadoEn.toISOString(),
    creadoPorId: color.creadoPorId,
    modificadoEn: color.modificadoEn.toISOString(),
    modificadoPorId: color.modificadoPorId,
  };
}

/** Parámetro de ruta `:id` (entero positivo). Reutilizado por GET/PATCH/DELETE. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del color debe ser un número' })
    .int({ error: 'El id del color debe ser entero' })
    .positive({ error: 'El id del color debe ser positivo' })
    .describe('Id del color.'),
});

/** El cuerpo del PATCH no repite el `id` (va en la URL). */
const esquemaColorPatchCuerpo = esquemaColorEditar.omit({ id: true });

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de colores (montadas bajo `/api`). */
export const rutasColores: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/colores',
    preHandler: app.conPermiso('colores.ver'),
    schema: {
      tags: ['colores'],
      summary: 'Listar colores',
      security: SEGURIDAD_SESION,
      querystring: esquemaColoresQuery,
      response: { 200: esquemaColoresPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarColores(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aColorSalida) };
    },
  });

  // ── Obtener uno ────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/colores/:id',
    preHandler: app.conPermiso('colores.ver'),
    schema: {
      tags: ['colores'],
      summary: 'Obtener un color',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaColorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aColorSalida(await obtenerColor(sesion, request.params.id));
    },
  });

  // ── Crear ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/colores',
    preHandler: app.conPermiso('colores.administrar'),
    schema: {
      tags: ['colores'],
      summary: 'Crear un color',
      security: SEGURIDAD_SESION,
      body: esquemaColorCrear,
      response: { 201: esquemaColorSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const color = await crearColor(sesion, request.body);
      return reply.code(201).send(aColorSalida(color));
    },
  });

  // ── Actualizar (parcial; incluye activar/desactivar con `activo`) ──────────
  app.route({
    method: 'PATCH',
    url: '/colores/:id',
    preHandler: app.conPermiso('colores.administrar'),
    schema: {
      tags: ['colores'],
      summary: 'Actualizar un color',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaColorPatchCuerpo,
      response: { 200: esquemaColorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const color = await actualizarColor(sesion, { ...request.body, id: request.params.id });
      return aColorSalida(color);
    },
  });

  // ── Fusionar duplicados (origen(es) → destino canónico) ────────────────────
  app.route({
    method: 'POST',
    url: '/colores/fusionar',
    preHandler: app.conPermiso('colores.administrar'),
    schema: {
      tags: ['colores'],
      summary: 'Fusionar colores duplicados en uno canónico',
      security: SEGURIDAD_SESION,
      body: esquemaColorFusionar,
      response: { 200: esquemaColorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aColorSalida(await fusionarColores(sesion, request.body));
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/colores/:id',
    preHandler: app.conPermiso('colores.administrar'),
    schema: {
      tags: ['colores'],
      summary: 'Desactivar un color (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaColorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aColorSalida(await desactivarColor(sesion, request.params.id));
    },
  });

  done();
};
