/**
 * Rutas REST de los PRECIOS DE TELA POR PROVEEDOR (F8-E1, D13/R17). Sub-recurso de la Tela
 * (`/telas/{idTela}/proveedores`), plugin INDEPENDIENTE (montado aparte, no dentro de
 * `telas.rutas.ts`). Calca el estándar de `api/avios/avios.rutas.ts`: cada handler solo
 * (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `telas.ver` para leer, `telas.administrar` para mutar (sin permiso propio: se gobierna
 *     con los de la Tela).
 *  3. **Delega** al servicio de dominio `dominio/catalogos/tela-proveedores`.
 *
 * El grid de precio por color viaja inline en el body de crear/editar. CERO lógica de
 * negocio o acceso a datos aquí; los errores de dominio los traduce el error handler global
 * (`src/api/errores.ts`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/index.js';
import {
  esquemaTelaProveedorCrear,
  esquemaTelaProveedorPatchCuerpo,
  esquemaTelaProveedorSalida,
  esquemaTelaProveedoresLista,
} from '../../contrato/esquemas/tela-proveedor.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarTelaProveedor,
  crearTelaProveedor,
  desactivarTelaProveedor,
  listarProveedoresDeTela,
  obtenerTelaProveedor,
  type TelaProveedorConColores,
} from '../../dominio/catalogos/tela-proveedores.js';

/** Proyecta un renglón de precio por color a la forma JSON del contrato (decimales → number). */
function aColorSalida(
  fila: TelaProveedorConColores['colores'][number],
): z.infer<typeof esquemaTelaProveedorSalida>['colores'][number] {
  return {
    idColor: fila.idColor,
    nombre: fila.color.nombre,
    precio: fila.precio === null ? null : Number(fila.precio),
  };
}

/** Proyecta el modelo Prisma `TelaProveedor` (con proveedor y colores) a la forma JSON del contrato. */
function aTelaProveedorSalida(
  tp: TelaProveedorConColores,
): z.infer<typeof esquemaTelaProveedorSalida> {
  return {
    id: tp.id,
    idTela: tp.idTela,
    idProveedor: tp.idProveedor,
    nombreProveedor: tp.proveedor.nombre,
    precio: tp.precio === null ? null : Number(tp.precio),
    manejaPrecioPorColor: tp.manejaPrecioPorColor,
    condiciones: tp.condiciones,
    activo: tp.activo,
    colores: tp.colores.map(aColorSalida),
    creadoEn: tp.creadoEn.toISOString(),
    creadoPorId: tp.creadoPorId,
    modificadoEn: tp.modificadoEn.toISOString(),
    modificadoPorId: tp.modificadoPorId,
  };
}

/** Parámetro de ruta `:idTela` (entero positivo). Para el listado. */
const esquemaParamTela = z.object({
  idTela: z.coerce
    .number({ error: 'El id de la tela debe ser un número' })
    .int({ error: 'El id de la tela debe ser entero' })
    .positive({ error: 'El id de la tela debe ser positivo' })
    .describe('Id de la tela.'),
});

/** Parámetros de ruta `:idTela` + `:id` (renglón tela–proveedor). GET uno / PATCH / DELETE. */
const esquemaParamTelaId = esquemaParamTela.extend({
  id: z.coerce
    .number({ error: 'El id del proveedor de la tela debe ser un número' })
    .int({ error: 'El id del proveedor de la tela debe ser entero' })
    .positive({ error: 'El id del proveedor de la tela debe ser positivo' })
    .describe('Id del renglón tela–proveedor.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de precios de tela por proveedor (montadas bajo `/api`). */
export const rutasTelaProveedores: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Listar los proveedores de una tela (con precio y precio por color) ───────
  app.route({
    method: 'GET',
    url: '/telas/:idTela/proveedores',
    preHandler: app.conPermiso('telas.ver'),
    schema: {
      tags: ['telas'],
      summary: 'Listar los proveedores de una tela (con su precio y precio por color)',
      security: SEGURIDAD_SESION,
      params: esquemaParamTela,
      response: { 200: esquemaTelaProveedoresLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const proveedores = await listarProveedoresDeTela(sesion, request.params.idTela);
      return { datos: proveedores.map(aTelaProveedorSalida) };
    },
  });

  // ── Obtener un proveedor de la tela ──────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/telas/:idTela/proveedores/:id',
    preHandler: app.conPermiso('telas.ver'),
    schema: {
      tags: ['telas'],
      summary: 'Obtener un proveedor de una tela',
      security: SEGURIDAD_SESION,
      params: esquemaParamTelaId,
      response: { 200: esquemaTelaProveedorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const tp = await obtenerTelaProveedor(sesion, request.params.idTela, request.params.id);
      return aTelaProveedorSalida(tp);
    },
  });

  // ── Crear (proveedor + precio + grid de precio por color inline en el body) ──
  app.route({
    method: 'POST',
    url: '/telas/:idTela/proveedores',
    preHandler: app.conPermiso('telas.administrar'),
    schema: {
      tags: ['telas'],
      summary: 'Asignar un proveedor con precio a una tela',
      security: SEGURIDAD_SESION,
      params: esquemaParamTela,
      body: esquemaTelaProveedorCrear,
      response: { 201: esquemaTelaProveedorSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const tp = await crearTelaProveedor(sesion, request.params.idTela, request.body);
      return reply.code(201).send(aTelaProveedorSalida(tp));
    },
  });

  // ── Actualizar (parcial; grid inline; activar/desactivar con `activo`) ───────
  app.route({
    method: 'PATCH',
    url: '/telas/:idTela/proveedores/:id',
    preHandler: app.conPermiso('telas.administrar'),
    schema: {
      tags: ['telas'],
      summary: 'Actualizar un proveedor de una tela',
      security: SEGURIDAD_SESION,
      params: esquemaParamTelaId,
      body: esquemaTelaProveedorPatchCuerpo,
      response: { 200: esquemaTelaProveedorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const tp = await actualizarTelaProveedor(sesion, request.params.idTela, {
        ...request.body,
        id: request.params.id,
      });
      return aTelaProveedorSalida(tp);
    },
  });

  // ── Desactivar (borrado SUAVE) ───────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/telas/:idTela/proveedores/:id',
    preHandler: app.conPermiso('telas.administrar'),
    schema: {
      tags: ['telas'],
      summary: 'Desactivar un proveedor de una tela (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamTelaId,
      response: { 200: esquemaTelaProveedorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const tp = await desactivarTelaProveedor(sesion, request.params.idTela, request.params.id);
      return aTelaProveedorSalida(tp);
    },
  });

  done();
};
