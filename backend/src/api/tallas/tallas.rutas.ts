/**
 * Rutas REST de Tallas y Curvas — catálogo estructurado global (F1-E2, PIEZA B — D4).
 * Calca el ESTÁNDAR de ruta de Cortadores/Proveedores (`api/cortadores`, `api/proveedores`):
 * cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `tallas.ver` para leer, `tallas.administrar` para mutar (un solo permiso cubre
 *     tallas y curvas).
 *  3. **Delega** al servicio de dominio `dominio/catalogos/tallas-curvas`.
 *
 * Las curvas son maestro-detalle ORDENADO: `items` (ids de talla en orden) viaja en el
 * body de crear/editar; la salida trae los items proyectados con su etiqueta y posición.
 *
 * CERO lógica de negocio o acceso a datos aquí. Los errores de dominio los traduce el
 * error handler global (`src/api/errores.ts`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaCurvaCrear,
  esquemaCurvaEditar,
  esquemaCurvasPagina,
  esquemaCurvaSalida,
  esquemaErrorApi,
  esquemaListarCurvas,
  esquemaListarTallas,
  esquemaTallaCrear,
  esquemaTallaEditar,
  esquemaTallasPagina,
  esquemaTallaSalida,
} from '../../contrato/index.js';
import type { Talla } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarCurva,
  actualizarTalla,
  crearCurva,
  crearTalla,
  desactivarCurva,
  desactivarTalla,
  listarCurvas,
  listarTallas,
  obtenerCurva,
  obtenerTalla,
  type CurvaConItems,
} from '../../dominio/catalogos/tallas-curvas.js';

/** Proyecta el modelo Prisma `Talla` a la forma JSON del contrato (fechas ISO). */
function aTallaSalida(talla: Talla): z.infer<typeof esquemaTallaSalida> {
  return {
    id: talla.id,
    etiqueta: talla.etiqueta,
    orden: talla.orden,
    activo: talla.activo,
    creadoEn: talla.creadoEn.toISOString(),
    creadoPorId: talla.creadoPorId,
    modificadoEn: talla.modificadoEn.toISOString(),
    modificadoPorId: talla.modificadoPorId,
  };
}

/** Proyecta una curva (con items ordenados) a la forma JSON del contrato. */
function aCurvaSalida(curva: CurvaConItems): z.infer<typeof esquemaCurvaSalida> {
  return {
    id: curva.id,
    nombre: curva.nombre,
    activo: curva.activo,
    items: curva.items.map((item) => ({
      idTalla: item.idTalla,
      etiqueta: item.talla.etiqueta,
      posicion: item.posicion,
    })),
    creadoEn: curva.creadoEn.toISOString(),
    creadoPorId: curva.creadoPorId,
    modificadoEn: curva.modificadoEn.toISOString(),
    modificadoPorId: curva.modificadoPorId,
  };
}

/** Parámetro de ruta `:id` de talla (entero positivo). */
const esquemaParamIdTalla = z.object({
  id: z.coerce
    .number({ error: 'El id de la talla debe ser un número' })
    .int({ error: 'El id de la talla debe ser entero' })
    .positive({ error: 'El id de la talla debe ser positivo' })
    .describe('Id de la talla.'),
});

/** Parámetro de ruta `:id` de curva (entero positivo). */
const esquemaParamIdCurva = z.object({
  id: z.coerce
    .number({ error: 'El id de la curva debe ser un número' })
    .int({ error: 'El id de la curva debe ser entero' })
    .positive({ error: 'El id de la curva debe ser positivo' })
    .describe('Id de la curva.'),
});

/** El cuerpo del PATCH no repite el `id` (va en la URL). */
const esquemaTallaPatchCuerpo = esquemaTallaEditar.omit({ id: true });
const esquemaCurvaPatchCuerpo = esquemaCurvaEditar.omit({ id: true });

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de tallas y curvas (montadas bajo `/api`). */
export const rutasTallas: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ══ Tallas ════════════════════════════════════════════════════════════════════

  // ── Listar (búsqueda + orden + paginación en servidor) ─────────────────────
  app.route({
    method: 'GET',
    url: '/tallas',
    preHandler: app.conPermiso('tallas.ver'),
    schema: {
      tags: ['tallas'],
      summary: 'Listar tallas',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarTallas,
      response: { 200: esquemaTallasPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarTallas(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aTallaSalida) };
    },
  });

  // ── Obtener una ────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/tallas/:id',
    preHandler: app.conPermiso('tallas.ver'),
    schema: {
      tags: ['tallas'],
      summary: 'Obtener una talla',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdTalla,
      response: { 200: esquemaTallaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aTallaSalida(await obtenerTalla(sesion, request.params.id));
    },
  });

  // ── Crear ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/tallas',
    preHandler: app.conPermiso('tallas.administrar'),
    schema: {
      tags: ['tallas'],
      summary: 'Crear una talla',
      security: SEGURIDAD_SESION,
      body: esquemaTallaCrear,
      response: { 201: esquemaTallaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const talla = await crearTalla(sesion, request.body);
      return reply.code(201).send(aTallaSalida(talla));
    },
  });

  // ── Actualizar (parcial; incluye activar/desactivar con `activo`) ──────────
  app.route({
    method: 'PATCH',
    url: '/tallas/:id',
    preHandler: app.conPermiso('tallas.administrar'),
    schema: {
      tags: ['tallas'],
      summary: 'Actualizar una talla',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdTalla,
      body: esquemaTallaPatchCuerpo,
      response: { 200: esquemaTallaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const talla = await actualizarTalla(sesion, { ...request.body, id: request.params.id });
      return aTallaSalida(talla);
    },
  });

  // ── Desactivar (borrado SUAVE; rechaza si la usa una curva activa) ─────────
  app.route({
    method: 'DELETE',
    url: '/tallas/:id',
    preHandler: app.conPermiso('tallas.administrar'),
    schema: {
      tags: ['tallas'],
      summary: 'Desactivar una talla (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdTalla,
      response: { 200: esquemaTallaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aTallaSalida(await desactivarTalla(sesion, request.params.id));
    },
  });

  // ══ Curvas (maestro-detalle ordenado) ═════════════════════════════════════════

  // ── Listar (búsqueda + orden + paginación en servidor) ─────────────────────
  app.route({
    method: 'GET',
    url: '/curvas-talla',
    preHandler: app.conPermiso('tallas.ver'),
    schema: {
      tags: ['tallas'],
      summary: 'Listar curvas de tallas',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarCurvas,
      response: { 200: esquemaCurvasPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarCurvas(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aCurvaSalida) };
    },
  });

  // ── Obtener una (con items ordenados) ──────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/curvas-talla/:id',
    preHandler: app.conPermiso('tallas.ver'),
    schema: {
      tags: ['tallas'],
      summary: 'Obtener una curva (con sus tallas en orden)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdCurva,
      response: { 200: esquemaCurvaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aCurvaSalida(await obtenerCurva(sesion, request.params.id));
    },
  });

  // ── Crear (items ordenados en el body) ──────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/curvas-talla',
    preHandler: app.conPermiso('tallas.administrar'),
    schema: {
      tags: ['tallas'],
      summary: 'Crear una curva de tallas',
      security: SEGURIDAD_SESION,
      body: esquemaCurvaCrear,
      response: { 201: esquemaCurvaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const curva = await crearCurva(sesion, request.body);
      return reply.code(201).send(aCurvaSalida(curva));
    },
  });

  // ── Actualizar (parcial; items reemplazan el set; activar/desactivar) ──────
  app.route({
    method: 'PATCH',
    url: '/curvas-talla/:id',
    preHandler: app.conPermiso('tallas.administrar'),
    schema: {
      tags: ['tallas'],
      summary: 'Actualizar una curva de tallas',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdCurva,
      body: esquemaCurvaPatchCuerpo,
      response: { 200: esquemaCurvaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const curva = await actualizarCurva(sesion, { ...request.body, id: request.params.id });
      return aCurvaSalida(curva);
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/curvas-talla/:id',
    preHandler: app.conPermiso('tallas.administrar'),
    schema: {
      tags: ['tallas'],
      summary: 'Desactivar una curva (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdCurva,
      response: { 200: esquemaCurvaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aCurvaSalida(await desactivarCurva(sesion, request.params.id));
    },
  });

  done();
};
