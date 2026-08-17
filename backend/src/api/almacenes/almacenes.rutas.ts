/**
 * Rutas REST de Almacenes — el ESTÁNDAR de ruta del backend (se replica en
 * todo el ERP). Cada handler hace SOLO tres cosas (rutas delgadas, A1):
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`
 *     (los mismos que documentan el OpenAPI) — vía `schema` del route.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `almacenes.ver` para leer, `almacenes.administrar` para mutar.
 *  3. **Delega** al servicio de dominio `dominio/admin/almacenes` (que reaplica
 *     el permiso, valida de nuevo, abre transacción y audita). CERO lógica de
 *     negocio o acceso a datos aquí.
 *
 * La sesión de dominio la entrega el plugin de auth (`req.obtenerSesion()`); el
 * `conPermiso` previo garantiza que no es `null` cuando el handler corre.
 * Los errores de dominio los traduce el error handler global (`src/api/errores.ts`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaAlmacenCrear,
  esquemaAlmacenEditar,
  esquemaAlmacenesPagina,
  esquemaAlmacenesQuery,
  esquemaAlmacenSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { AlmacenConCortador } from '../../dominio/admin/almacenes.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarAlmacen,
  crearAlmacen,
  desactivarAlmacen,
  listarAlmacenes,
  obtenerAlmacen,
} from '../../dominio/admin/almacenes.js';

/** Proyecta el modelo Prisma `Almacen` a la forma JSON del contrato (fechas ISO). */
function aAlmacenSalida(almacen: AlmacenConCortador): z.infer<typeof esquemaAlmacenSalida> {
  return {
    id: almacen.id,
    nombre: almacen.nombre,
    tipo: almacen.tipo,
    activo: almacen.activo,
    idEmpresa: almacen.idEmpresa,
    idCortador: almacen.idCortador,
    cortador: almacen.cortador?.nombre ?? null,
    esTransitoProceso: almacen.esTransitoProceso,
    creadoEn: almacen.creadoEn.toISOString(),
    creadoPorId: almacen.creadoPorId,
    modificadoEn: almacen.modificadoEn.toISOString(),
    modificadoPorId: almacen.modificadoPorId,
  };
}

/** Parámetro de ruta `:id` (entero positivo). Reutilizado por GET/PATCH/DELETE. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del almacén debe ser un número' })
    .int({ error: 'El id del almacén debe ser entero' })
    .positive({ error: 'El id del almacén debe ser positivo' })
    .describe('Id del almacén.'),
});

/**
 * El cuerpo del PATCH no repite el `id` (va en la URL). Se valida lo demás del
 * esquema de edición compartido y el servicio recibe `{ ...cuerpo, id }`.
 */
const esquemaAlmacenPatchCuerpo = esquemaAlmacenEditar.omit({ id: true });

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de almacenes (montadas bajo `/api`). */
export const rutasAlmacenes: FastifyPluginCallbackZod = (app, _opciones, done) => {
  // La sesión nunca es null tras `conPermiso`, pero el tipo es `| null`: este
  // helper la estrecha en un solo lugar (defensa: si faltara el guard, lanza).
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
    url: '/almacenes',
    preHandler: app.conPermiso('almacenes.ver'),
    schema: {
      tags: ['almacenes'],
      summary: 'Listar almacenes',
      security: SEGURIDAD_SESION,
      querystring: esquemaAlmacenesQuery,
      response: { 200: esquemaAlmacenesPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarAlmacenes(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aAlmacenSalida) };
    },
  });

  // ── Obtener uno ────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/almacenes/:id',
    preHandler: app.conPermiso('almacenes.ver'),
    schema: {
      tags: ['almacenes'],
      summary: 'Obtener un almacén',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaAlmacenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aAlmacenSalida(await obtenerAlmacen(sesion, request.params.id));
    },
  });

  // ── Crear ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/almacenes',
    preHandler: app.conPermiso('almacenes.administrar'),
    schema: {
      tags: ['almacenes'],
      summary: 'Crear un almacén',
      security: SEGURIDAD_SESION,
      body: esquemaAlmacenCrear,
      response: { 201: esquemaAlmacenSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const almacen = await crearAlmacen(sesion, request.body);
      return reply.code(201).send(aAlmacenSalida(almacen));
    },
  });

  // ── Actualizar (parcial; incluye activar/desactivar con `activo`) ──────────
  app.route({
    method: 'PATCH',
    url: '/almacenes/:id',
    preHandler: app.conPermiso('almacenes.administrar'),
    schema: {
      tags: ['almacenes'],
      summary: 'Actualizar un almacén',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaAlmacenPatchCuerpo,
      response: { 200: esquemaAlmacenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const almacen = await actualizarAlmacen(sesion, { ...request.body, id: request.params.id });
      return aAlmacenSalida(almacen);
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/almacenes/:id',
    preHandler: app.conPermiso('almacenes.administrar'),
    schema: {
      tags: ['almacenes'],
      summary: 'Desactivar un almacén (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaAlmacenSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aAlmacenSalida(await desactivarAlmacen(sesion, request.params.id));
    },
  });

  done();
};
