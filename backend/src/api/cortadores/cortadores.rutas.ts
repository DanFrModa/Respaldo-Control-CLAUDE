/**
 * Rutas REST de Cortadores — catálogo maestro global (F1-E1). Calca el ESTÁNDAR de
 * ruta de Almacenes (`api/almacenes/almacenes.rutas.ts`): cada handler solo (A1)
 * valida (Zod compartido), autoriza (`cortadores.ver`/`.administrar`, §9.2) y delega
 * al servicio `dominio/catalogos/cortadores`. CERO lógica de negocio o datos aquí.
 *
 * Particularidad: `precioReferencia` es Decimal en Prisma; al serializar a JSON se
 * convierte a `number` (o null) con `.toNumber()`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaCortadorCrear,
  esquemaCortadorEditar,
  esquemaCortadoresPagina,
  esquemaCortadoresQuery,
  esquemaCortadorSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { Cortador } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarCortador,
  crearCortador,
  desactivarCortador,
  listarCortadores,
  obtenerCortador,
} from '../../dominio/catalogos/cortadores.js';

/** Proyecta el modelo Prisma `Cortador` a la forma JSON del contrato (Decimal→number, fechas ISO). */
function aCortadorSalida(cortador: Cortador): z.infer<typeof esquemaCortadorSalida> {
  return {
    id: cortador.id,
    nombre: cortador.nombre,
    precioReferencia: cortador.precioReferencia?.toNumber() ?? null,
    telefonos: cortador.telefonos,
    activo: cortador.activo,
    creadoEn: cortador.creadoEn.toISOString(),
    creadoPorId: cortador.creadoPorId,
    modificadoEn: cortador.modificadoEn.toISOString(),
    modificadoPorId: cortador.modificadoPorId,
  };
}

/** Parámetro de ruta `:id` (entero positivo). Reutilizado por GET/PATCH/DELETE. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del cortador debe ser un número' })
    .int({ error: 'El id del cortador debe ser entero' })
    .positive({ error: 'El id del cortador debe ser positivo' })
    .describe('Id del cortador.'),
});

/** El cuerpo del PATCH no repite el `id` (va en la URL). */
const esquemaCortadorPatchCuerpo = esquemaCortadorEditar.omit({ id: true });

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de cortadores (montadas bajo `/api`). */
export const rutasCortadores: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/cortadores',
    preHandler: app.conPermiso('cortadores.ver'),
    schema: {
      tags: ['cortadores'],
      summary: 'Listar cortadores',
      security: SEGURIDAD_SESION,
      querystring: esquemaCortadoresQuery,
      response: { 200: esquemaCortadoresPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarCortadores(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aCortadorSalida) };
    },
  });

  // ── Obtener uno ────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/cortadores/:id',
    preHandler: app.conPermiso('cortadores.ver'),
    schema: {
      tags: ['cortadores'],
      summary: 'Obtener un cortador',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaCortadorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aCortadorSalida(await obtenerCortador(sesion, request.params.id));
    },
  });

  // ── Crear ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/cortadores',
    preHandler: app.conPermiso('cortadores.administrar'),
    schema: {
      tags: ['cortadores'],
      summary: 'Crear un cortador',
      security: SEGURIDAD_SESION,
      body: esquemaCortadorCrear,
      response: { 201: esquemaCortadorSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const cortador = await crearCortador(sesion, request.body);
      return reply.code(201).send(aCortadorSalida(cortador));
    },
  });

  // ── Actualizar (parcial; incluye activar/desactivar con `activo`) ──────────
  app.route({
    method: 'PATCH',
    url: '/cortadores/:id',
    preHandler: app.conPermiso('cortadores.administrar'),
    schema: {
      tags: ['cortadores'],
      summary: 'Actualizar un cortador',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaCortadorPatchCuerpo,
      response: { 200: esquemaCortadorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const cortador = await actualizarCortador(sesion, { ...request.body, id: request.params.id });
      return aCortadorSalida(cortador);
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/cortadores/:id',
    preHandler: app.conPermiso('cortadores.administrar'),
    schema: {
      tags: ['cortadores'],
      summary: 'Desactivar un cortador (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaCortadorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aCortadorSalida(await desactivarCortador(sesion, request.params.id));
    },
  });

  done();
};
