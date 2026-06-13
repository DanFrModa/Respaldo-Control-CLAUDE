/**
 * Rutas REST de Proveedores — catálogo maestro global (F1-E1). Calca el ESTÁNDAR de
 * ruta de Almacenes (`api/almacenes/almacenes.rutas.ts`): cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `proveedores.ver` para leer, `proveedores.administrar` para mutar.
 *  3. **Delega** al servicio de dominio `dominio/catalogos/proveedores`.
 *
 * CERO lógica de negocio o acceso a datos aquí. Los errores de dominio los traduce el
 * error handler global (`src/api/errores.ts`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaProveedorCrear,
  esquemaProveedorEditar,
  esquemaProveedoresPagina,
  esquemaProveedoresQuery,
  esquemaProveedorSalida,
} from '../../contrato/index.js';
import type { Proveedor } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarProveedor,
  crearProveedor,
  desactivarProveedor,
  listarProveedores,
  obtenerProveedor,
} from '../../dominio/catalogos/proveedores.js';

/** Proyecta el modelo Prisma `Proveedor` a la forma JSON del contrato (fechas ISO). */
function aProveedorSalida(proveedor: Proveedor): z.infer<typeof esquemaProveedorSalida> {
  return {
    id: proveedor.id,
    nombre: proveedor.nombre,
    razonSocial: proveedor.razonSocial,
    tipo: proveedor.tipo,
    telefono: proveedor.telefono,
    contacto: proveedor.contacto,
    condiciones: proveedor.condiciones,
    activo: proveedor.activo,
    creadoEn: proveedor.creadoEn.toISOString(),
    creadoPorId: proveedor.creadoPorId,
    modificadoEn: proveedor.modificadoEn.toISOString(),
    modificadoPorId: proveedor.modificadoPorId,
  };
}

/** Parámetro de ruta `:id` (entero positivo). Reutilizado por GET/PATCH/DELETE. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del proveedor debe ser un número' })
    .int({ error: 'El id del proveedor debe ser entero' })
    .positive({ error: 'El id del proveedor debe ser positivo' })
    .describe('Id del proveedor.'),
});

/** El cuerpo del PATCH no repite el `id` (va en la URL). */
const esquemaProveedorPatchCuerpo = esquemaProveedorEditar.omit({ id: true });

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de proveedores (montadas bajo `/api`). */
export const rutasProveedores: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Listar (búsqueda + filtro por tipo + orden + paginación en servidor) ───
  app.route({
    method: 'GET',
    url: '/proveedores',
    preHandler: app.conPermiso('proveedores.ver'),
    schema: {
      tags: ['proveedores'],
      summary: 'Listar proveedores',
      security: SEGURIDAD_SESION,
      querystring: esquemaProveedoresQuery,
      response: { 200: esquemaProveedoresPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarProveedores(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aProveedorSalida) };
    },
  });

  // ── Obtener uno ────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/proveedores/:id',
    preHandler: app.conPermiso('proveedores.ver'),
    schema: {
      tags: ['proveedores'],
      summary: 'Obtener un proveedor',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaProveedorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aProveedorSalida(await obtenerProveedor(sesion, request.params.id));
    },
  });

  // ── Crear ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/proveedores',
    preHandler: app.conPermiso('proveedores.administrar'),
    schema: {
      tags: ['proveedores'],
      summary: 'Crear un proveedor',
      security: SEGURIDAD_SESION,
      body: esquemaProveedorCrear,
      response: { 201: esquemaProveedorSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const proveedor = await crearProveedor(sesion, request.body);
      return reply.code(201).send(aProveedorSalida(proveedor));
    },
  });

  // ── Actualizar (parcial; incluye activar/desactivar con `activo`) ──────────
  app.route({
    method: 'PATCH',
    url: '/proveedores/:id',
    preHandler: app.conPermiso('proveedores.administrar'),
    schema: {
      tags: ['proveedores'],
      summary: 'Actualizar un proveedor',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaProveedorPatchCuerpo,
      response: { 200: esquemaProveedorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const proveedor = await actualizarProveedor(sesion, {
        ...request.body,
        id: request.params.id,
      });
      return aProveedorSalida(proveedor);
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/proveedores/:id',
    preHandler: app.conPermiso('proveedores.administrar'),
    schema: {
      tags: ['proveedores'],
      summary: 'Desactivar un proveedor (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaProveedorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aProveedorSalida(await desactivarProveedor(sesion, request.params.id));
    },
  });

  done();
};
