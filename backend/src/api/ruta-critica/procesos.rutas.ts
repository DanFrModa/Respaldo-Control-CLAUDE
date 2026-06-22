/**
 * Rutas REST del CATÁLOGO CONFIGURABLE de la Ruta Crítica (Módulo 8, F5-E1; doc 08-Ruta-Critica).
 * Handlers delgados (A1): validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan al
 * dominio `dominio/ruta-critica/catalogoProcesos`. Toda la lógica (rechazo de ciclos, borrado
 * suave, set N:M) vive en el dominio.
 *
 * RBAC por ruta: GET → `rc.catalogo-ver`; mutaciones → `rc.catalogo-administrar`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaProcesoChecklistCuerpo,
  esquemaProcesoCrear,
  esquemaProcesoDependenciasCuerpo,
  esquemaProcesoPatchCuerpo,
  esquemaProcesoRolesCuerpo,
  esquemaProcesoSalida,
  esquemaProcesosPagina,
  esquemaProcesosQuery,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarProceso,
  asignarRolesResponsables,
  crearProceso,
  definirDependencias,
  desactivarProceso,
  editarChecklist,
  listarProcesos,
  obtenerProceso,
  type ProcesoCompletoDto,
} from '../../dominio/ruta-critica/catalogoProcesos.js';

/** Proyecta el DTO del dominio a la forma JSON del contrato (fechas ISO). */
function aProcesoSalida(p: ProcesoCompletoDto): z.infer<typeof esquemaProcesoSalida> {
  return {
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    critico: p.critico,
    ultimoProceso: p.ultimoProceso,
    esResurtido: p.esResurtido,
    condicionAplicabilidad: p.condicionAplicabilidad,
    tipoEvento: p.tipoEvento,
    tipoDuracion: p.tipoDuracion,
    activo: p.activo,
    roles: p.roles,
    antecesores: p.antecesores,
    checklist: p.checklist,
    creadoEn: p.creadoEn.toISOString(),
    creadoPorId: p.creadoPorId,
    modificadoEn: p.modificadoEn.toISOString(),
    modificadoPorId: p.modificadoPorId,
  };
}

/** Parámetro de ruta `:id`. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del proceso debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del proceso de la Ruta Crítica.'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del catálogo de procesos de la RC (montadas bajo `/api`). */
export const rutasProcesosRc: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  const BASE = '/ruta-critica/procesos';

  // ── Listar ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: BASE,
    preHandler: app.conPermiso('rc.catalogo-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Listar procesos de la Ruta Crítica',
      security: SEGURIDAD_SESION,
      querystring: esquemaProcesosQuery,
      response: { 200: esquemaProcesosPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarProcesos(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aProcesoSalida) };
    },
  });

  // ── Obtener uno (con roles, antecesores y checklist) ─────────────────────────
  app.route({
    method: 'GET',
    url: `${BASE}/:id`,
    preHandler: app.conPermiso('rc.catalogo-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Obtener un proceso de la Ruta Crítica',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaProcesoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aProcesoSalida(await obtenerProceso(sesion, request.params.id));
    },
  });

  // ── Crear ─────────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: BASE,
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Crear un proceso de la Ruta Crítica',
      security: SEGURIDAD_SESION,
      body: esquemaProcesoCrear,
      response: { 201: esquemaProcesoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const proceso = await crearProceso(sesion, request.body);
      return reply.code(201).send(aProcesoSalida(proceso));
    },
  });

  // ── Actualizar (banderas, tipos, código/nombre, activo) ──────────────────────
  app.route({
    method: 'PATCH',
    url: `${BASE}/:id`,
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Actualizar un proceso de la Ruta Crítica',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaProcesoPatchCuerpo,
      response: { 200: esquemaProcesoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const proceso = await actualizarProceso(sesion, { ...request.body, id: request.params.id });
      return aProcesoSalida(proceso);
    },
  });

  // ── Desactivar (borrado suave) ────────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: `${BASE}/:id`,
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Desactivar un proceso de la Ruta Crítica (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaProcesoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aProcesoSalida(await desactivarProceso(sesion, request.params.id));
    },
  });

  // ── Roles responsables (set completo N:M) ─────────────────────────────────────
  app.route({
    method: 'PUT',
    url: `${BASE}/:id/roles`,
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Fijar los roles responsables de un proceso (set completo)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaProcesoRolesCuerpo,
      response: { 200: esquemaProcesoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aProcesoSalida(
        await asignarRolesResponsables(sesion, request.params.id, request.body),
      );
    },
  });

  // ── Dependencias (set completo de antecesores; rechaza ciclos) ───────────────
  app.route({
    method: 'PUT',
    url: `${BASE}/:id/dependencias`,
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Fijar los antecesores de un proceso (DAG; rechaza ciclos)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaProcesoDependenciasCuerpo,
      response: { 200: esquemaProcesoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aProcesoSalida(await definirDependencias(sesion, request.params.id, request.body));
    },
  });

  // ── Checklist (set completo; orden por posición, borrado suave) ──────────────
  app.route({
    method: 'PUT',
    url: `${BASE}/:id/checklist`,
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Fijar el checklist de un proceso (set completo)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaProcesoChecklistCuerpo,
      response: { 200: esquemaProcesoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aProcesoSalida(await editarChecklist(sesion, request.params.id, request.body));
    },
  });

  done();
};
