/**
 * Rutas REST del catálogo de AUDITORES de calidad (rediseño R9 — proto `CAT_AUDITORES`). Rutas
 * delgadas (A1): validan con los esquemas Zod compartidos de `src/contrato`, autorizan server-side
 * con `app.conPermiso` (deny-by-default, §9.2: `calidad.ver` para leer, `calidad.administrar-catalogo`
 * para mutar — SE REÚSAN, sin permiso nuevo) y delegan al servicio de dominio
 * `dominio/calidad/auditores`. CERO lógica de negocio aquí.
 *
 * Montadas bajo `/api` (`await app.register(rutasAuditores, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaAuditorCrear,
  esquemaAuditorEditar,
  esquemaAuditorSalida,
  esquemaAuditoresPagina,
  esquemaAuditoresQuery,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarAuditor,
  crearAuditor,
  desactivarAuditor,
  listarAuditores,
  obtenerAuditor,
  type AuditorConConteo,
} from '../../dominio/calidad/auditores.js';

/** Proyecta el auditor (con su conteo derivado) a la forma JSON del contrato (fechas ISO). */
function aSalida(auditor: AuditorConConteo): z.infer<typeof esquemaAuditorSalida> {
  return {
    id: auditor.id,
    nombre: auditor.nombre,
    rol: auditor.rol as z.infer<typeof esquemaAuditorSalida>['rol'],
    nivelAql: auditor.nivelAql as z.infer<typeof esquemaAuditorSalida>['nivelAql'],
    numeroAuditorias: auditor.numeroAuditorias,
    activo: auditor.activo,
    creadoEn: auditor.creadoEn.toISOString(),
    creadoPorId: auditor.creadoPorId,
    modificadoEn: auditor.modificadoEn.toISOString(),
    modificadoPorId: auditor.modificadoPorId,
  };
}

const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del auditor debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del auditor.'),
});

const esquemaPatchCuerpo = esquemaAuditorEditar.omit({ id: true });

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

export const rutasAuditores: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  app.route({
    method: 'GET',
    url: '/calidad/auditores',
    preHandler: app.conPermiso('calidad.ver'),
    schema: {
      tags: ['calidad'],
      summary: 'Listar auditores del catálogo',
      security: SEGURIDAD_SESION,
      querystring: esquemaAuditoresQuery,
      response: { 200: esquemaAuditoresPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarAuditores(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aSalida) };
    },
  });

  app.route({
    method: 'GET',
    url: '/calidad/auditores/:id',
    preHandler: app.conPermiso('calidad.ver'),
    schema: {
      tags: ['calidad'],
      summary: 'Obtener un auditor',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaAuditorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aSalida(await obtenerAuditor(sesion, request.params.id));
    },
  });

  app.route({
    method: 'POST',
    url: '/calidad/auditores',
    preHandler: app.conPermiso('calidad.administrar-catalogo'),
    schema: {
      tags: ['calidad'],
      summary: 'Crear un auditor',
      security: SEGURIDAD_SESION,
      body: esquemaAuditorCrear,
      response: { 201: esquemaAuditorSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const auditor = await crearAuditor(sesion, request.body);
      return reply.code(201).send(aSalida(auditor));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/calidad/auditores/:id',
    preHandler: app.conPermiso('calidad.administrar-catalogo'),
    schema: {
      tags: ['calidad'],
      summary: 'Actualizar un auditor',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaPatchCuerpo,
      response: { 200: esquemaAuditorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const auditor = await actualizarAuditor(sesion, { ...request.body, id: request.params.id });
      return aSalida(auditor);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/calidad/auditores/:id',
    preHandler: app.conPermiso('calidad.administrar-catalogo'),
    schema: {
      tags: ['calidad'],
      summary: 'Desactivar un auditor (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaAuditorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aSalida(await desactivarAuditor(sesion, request.params.id));
    },
  });

  done();
};
