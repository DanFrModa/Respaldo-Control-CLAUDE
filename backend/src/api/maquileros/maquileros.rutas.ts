/**
 * Rutas REST de Maquileros + TipoProceso — catálogo maestro global (F1-E2, PIEZA A —
 * Maquila unificada). Calca el ESTÁNDAR de ruta de Cortadores/Proveedores
 * (`api/cortadores/cortadores.rutas.ts`, `api/proveedores/proveedores.rutas.ts`): cada
 * handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `maquileros.ver` para leer, `maquileros.administrar` para mutar.
 *  3. **Delega** al servicio de dominio `dominio/catalogos/maquileros`.
 *
 * Particularidades: los `tipos` (capacidades, N:N) van inline en el body de crear/editar;
 * el selector `GET /tipos-proceso` se protege con `maquileros.ver` (no lleva permiso
 * propio — mismo criterio que `roles-proveedor` con `proveedores.ver` en E1B; su ABM fino
 * queda diferido). CERO lógica de negocio o acceso a datos aquí; los errores de dominio
 * los traduce el error handler global (`src/api/errores.ts`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaListarMaquileros,
  esquemaMaquileroCrear,
  esquemaMaquileroEditar,
  esquemaMaquileroSalida,
  esquemaMaquilerosPagina,
  esquemaTipoProcesoSalida,
} from '../../contrato/index.js';
import type { TipoProceso } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarMaquilero,
  crearMaquilero,
  desactivarMaquilero,
  listarMaquileros,
  listarTiposProceso,
  obtenerMaquilero,
  type MaquileroConTipos,
} from '../../dominio/catalogos/maquileros.js';

/** Proyecta el modelo Prisma `Maquilero` (con tipos) a la forma JSON del contrato. */
function aMaquileroSalida(maquilero: MaquileroConTipos): z.infer<typeof esquemaMaquileroSalida> {
  return {
    id: maquilero.id,
    corto: maquilero.corto,
    nombre: maquilero.nombre,
    apellidos: maquilero.apellidos,
    telefonos: maquilero.telefonos,
    direccion: maquilero.direccion,
    observaciones: maquilero.observaciones,
    obsPago: maquilero.obsPago,
    asegurado: maquilero.asegurado,
    tipos: maquilero.tipos.map((t) => ({
      id: t.tipoProceso.id,
      codigo: t.tipoProceso.codigo,
      nombre: t.tipoProceso.nombre,
    })),
    activo: maquilero.activo,
    creadoEn: maquilero.creadoEn.toISOString(),
    creadoPorId: maquilero.creadoPorId,
    modificadoEn: maquilero.modificadoEn.toISOString(),
    modificadoPorId: maquilero.modificadoPorId,
  };
}

/** Proyecta un `TipoProceso` a la forma JSON del selector. */
function aTipoProcesoSalida(tipo: TipoProceso): z.infer<typeof esquemaTipoProcesoSalida> {
  return { id: tipo.id, codigo: tipo.codigo, nombre: tipo.nombre, activo: tipo.activo };
}

/** Parámetro de ruta `:id` (entero positivo). Reutilizado por GET/PATCH/DELETE. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del maquilero debe ser un número' })
    .int({ error: 'El id del maquilero debe ser entero' })
    .positive({ error: 'El id del maquilero debe ser positivo' })
    .describe('Id del maquilero.'),
});

/** El cuerpo del PATCH no repite el `id` (va en la URL). */
const esquemaMaquileroPatchCuerpo = esquemaMaquileroEditar.omit({ id: true });

/** Querystring del selector de tipos de proceso. */
const esquemaTiposProcesoQuery = z.object({
  incluirInactivos: z
    .stringbool()
    .default(false)
    .describe('Incluye los tipos de proceso desactivados ("true"/"false").'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de maquileros y tipos de proceso (montadas bajo `/api`). */
export const rutasMaquileros: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Selector de tipos de proceso (capacidades; maquila unificada) ───────────
  app.route({
    method: 'GET',
    url: '/tipos-proceso',
    preHandler: app.conPermiso('maquileros.ver'),
    schema: {
      tags: ['maquileros'],
      summary: 'Listar tipos de proceso (catálogo selector de capacidades)',
      security: SEGURIDAD_SESION,
      querystring: esquemaTiposProcesoQuery,
      response: { 200: z.array(esquemaTipoProcesoSalida), ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const tipos = await listarTiposProceso(sesion, {
        incluirInactivos: request.query.incluirInactivos,
      });
      return tipos.map(aTipoProcesoSalida);
    },
  });

  // ── Listar (búsqueda + filtro por tipo de proceso + orden + paginación) ─────
  app.route({
    method: 'GET',
    url: '/maquileros',
    preHandler: app.conPermiso('maquileros.ver'),
    schema: {
      tags: ['maquileros'],
      summary: 'Listar maquileros',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarMaquileros,
      response: { 200: esquemaMaquilerosPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarMaquileros(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aMaquileroSalida) };
    },
  });

  // ── Obtener uno (con sus tipos de proceso) ──────────────────────────────────
  app.route({
    method: 'GET',
    url: '/maquileros/:id',
    preHandler: app.conPermiso('maquileros.ver'),
    schema: {
      tags: ['maquileros'],
      summary: 'Obtener un maquilero',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaMaquileroSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aMaquileroSalida(await obtenerMaquilero(sesion, request.params.id));
    },
  });

  // ── Crear (tipos inline en el body) ─────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/maquileros',
    preHandler: app.conPermiso('maquileros.administrar'),
    schema: {
      tags: ['maquileros'],
      summary: 'Crear un maquilero',
      security: SEGURIDAD_SESION,
      body: esquemaMaquileroCrear,
      response: { 201: esquemaMaquileroSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const maquilero = await crearMaquilero(sesion, request.body);
      return reply.code(201).send(aMaquileroSalida(maquilero));
    },
  });

  // ── Actualizar (parcial; tipos inline; activar/desactivar con `activo`) ─────
  app.route({
    method: 'PATCH',
    url: '/maquileros/:id',
    preHandler: app.conPermiso('maquileros.administrar'),
    schema: {
      tags: ['maquileros'],
      summary: 'Actualizar un maquilero',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaMaquileroPatchCuerpo,
      response: { 200: esquemaMaquileroSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const maquilero = await actualizarMaquilero(sesion, {
        ...request.body,
        id: request.params.id,
      });
      return aMaquileroSalida(maquilero);
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/maquileros/:id',
    preHandler: app.conPermiso('maquileros.administrar'),
    schema: {
      tags: ['maquileros'],
      summary: 'Desactivar un maquilero (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaMaquileroSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aMaquileroSalida(await desactivarMaquilero(sesion, request.params.id));
    },
  });

  done();
};
