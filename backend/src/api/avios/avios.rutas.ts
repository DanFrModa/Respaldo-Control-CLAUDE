/**
 * Rutas REST de Avíos (F1-E3, PIEZA B — R1). Calca el ESTÁNDAR de ruta de
 * Maquileros/Proveedores (`api/maquileros/maquileros.rutas.ts`): cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `avios.ver` para leer, `avios.administrar` para mutar.
 *  3. **Delega** al servicio de dominio `dominio/catalogos/avios`.
 *
 * Particularidades: los `proveedores` (N:N CON datos propios — precio/condiciones, R1) van
 * inline en el body de crear/editar; `GET /avios/{id}/proveedores` expone el precio por
 * proveedor (no lleva permiso propio: se protege con `avios.ver`, mismo criterio que
 * `tipos-proceso` con `maquileros.ver` en E2). CERO lógica de negocio o acceso a datos
 * aquí; los errores de dominio los traduce el error handler global (`src/api/errores.ts`).
 *
 * NOTA (integración): los esquemas de avío AÚN no se re-exportan desde `contrato/index.ts`
 * (lo cablea la integración); se importan directo del archivo. `esquemaErrorApi` sí está en
 * el barril. Este plugin NO se registra aquí — lo monta la integración en `app.ts`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/index.js';
import {
  esquemaAvioCrear,
  esquemaAvioPatchCuerpo,
  esquemaAvioProveedoresLista,
  esquemaAvioSalida,
  esquemaAviosPagina,
  esquemaListarAvios,
} from '../../contrato/esquemas/avio.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarAvio,
  crearAvio,
  desactivarAvio,
  listarAvios,
  listarProveedoresDeAvio,
  obtenerAvio,
  type AvioConProveedores,
} from '../../dominio/catalogos/avios.js';

/** Proyecta un renglón de proveedor de avío a la forma JSON del contrato (decimales → number). */
function aProveedorSalida(
  fila: AvioConProveedores['proveedores'][number],
): z.infer<typeof esquemaAvioProveedoresLista>['datos'][number] {
  return {
    idProveedor: fila.idProveedor,
    nombreProveedor: fila.proveedor.nombre,
    precio: fila.precio === null ? null : Number(fila.precio),
    condiciones: fila.condiciones,
  };
}

/** Proyecta el modelo Prisma `Avio` (con proveedores) a la forma JSON del contrato. */
function aAvioSalida(avio: AvioConProveedores): z.infer<typeof esquemaAvioSalida> {
  return {
    id: avio.id,
    clave: avio.clave,
    descripcion: avio.descripcion,
    unidad: avio.unidad,
    presentacion: avio.presentacion,
    favorito: avio.favorito,
    cantFav: avio.cantFav === null ? null : Number(avio.cantFav),
    esGenerico: avio.esGenerico,
    precioReferencia: avio.precioReferencia === null ? null : Number(avio.precioReferencia),
    proveedores: avio.proveedores.map(aProveedorSalida),
    activo: avio.activo,
    creadoEn: avio.creadoEn.toISOString(),
    creadoPorId: avio.creadoPorId,
    modificadoEn: avio.modificadoEn.toISOString(),
    modificadoPorId: avio.modificadoPorId,
  };
}

/** Parámetro de ruta `:id` (entero positivo). Reutilizado por GET/PATCH/DELETE. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del avío debe ser un número' })
    .int({ error: 'El id del avío debe ser entero' })
    .positive({ error: 'El id del avío debe ser positivo' })
    .describe('Id del avío.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de avíos (montadas bajo `/api`). */
export const rutasAvios: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Listar (búsqueda + filtro esGenerico + orden + paginación) ──────────────
  app.route({
    method: 'GET',
    url: '/avios',
    preHandler: app.conPermiso('avios.ver'),
    schema: {
      tags: ['avios'],
      summary: 'Listar avíos',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarAvios,
      response: { 200: esquemaAviosPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarAvios(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aAvioSalida) };
    },
  });

  // ── Obtener uno (con sus proveedores) ───────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/avios/:id',
    preHandler: app.conPermiso('avios.ver'),
    schema: {
      tags: ['avios'],
      summary: 'Obtener un avío',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaAvioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aAvioSalida(await obtenerAvio(sesion, request.params.id));
    },
  });

  // ── Proveedores de un avío (precio por proveedor; R1) ───────────────────────
  app.route({
    method: 'GET',
    url: '/avios/:id/proveedores',
    preHandler: app.conPermiso('avios.ver'),
    schema: {
      tags: ['avios'],
      summary: 'Listar los proveedores de un avío (con su precio y condiciones)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaAvioProveedoresLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const proveedores = await listarProveedoresDeAvio(sesion, request.params.id);
      return { datos: proveedores.map(aProveedorSalida) };
    },
  });

  // ── Crear (proveedores inline con precio/condiciones en el body) ────────────
  app.route({
    method: 'POST',
    url: '/avios',
    preHandler: app.conPermiso('avios.administrar'),
    schema: {
      tags: ['avios'],
      summary: 'Crear un avío',
      security: SEGURIDAD_SESION,
      body: esquemaAvioCrear,
      response: { 201: esquemaAvioSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const avio = await crearAvio(sesion, request.body);
      return reply.code(201).send(aAvioSalida(avio));
    },
  });

  // ── Actualizar (parcial; proveedores inline; activar/desactivar con `activo`) ─
  app.route({
    method: 'PATCH',
    url: '/avios/:id',
    preHandler: app.conPermiso('avios.administrar'),
    schema: {
      tags: ['avios'],
      summary: 'Actualizar un avío',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaAvioPatchCuerpo,
      response: { 200: esquemaAvioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const avio = await actualizarAvio(sesion, { ...request.body, id: request.params.id });
      return aAvioSalida(avio);
    },
  });

  // ── Desactivar (borrado SUAVE) ───────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/avios/:id',
    preHandler: app.conPermiso('avios.administrar'),
    schema: {
      tags: ['avios'],
      summary: 'Desactivar un avío (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaAvioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aAvioSalida(await desactivarAvio(sesion, request.params.id));
    },
  });

  done();
};
