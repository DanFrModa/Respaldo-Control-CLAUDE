/**
 * Rutas REST de los Departamentos del cliente (F8-E1a, D13/R16 — Desarrollo y
 * Cotización). Plugin INDEPENDIENTE, sub-recurso del Cliente: espejo, más simple, de
 * los campos de referencia (`/clientes/:id/campos`, D7). Cada handler solo (A1):
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `clientes.ver` para leer, `clientes.administrar` para mutar (los MISMOS del
 *     cliente; los departamentos NO tienen permiso propio).
 *  3. **Delega** al servicio de dominio `dominio/catalogos/cliente-departamentos`.
 *
 * Endpoints: `GET/POST/PATCH/DELETE /clientes/:idCliente/departamentos[/:id]`. CERO
 * lógica de negocio o acceso a datos aquí. Los errores de dominio los traduce el error
 * handler global (`src/api/errores.ts`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/index.js';
import {
  esquemaClienteDepartamentoCrear,
  esquemaClienteDepartamentoEditar,
  esquemaClienteDepartamentoFusionar,
  esquemaClienteDepartamentoSalida,
  esquemaClienteDepartamentosLista,
  esquemaFusionDepartamentosPrevia,
  type ClienteDepartamentoSalida,
} from '../../contrato/esquemas/cliente-departamento.js';
import type { ClienteDepartamento } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarDepartamentoCliente,
  agregarDepartamentoCliente,
  desactivarDepartamentoCliente,
  fusionarDepartamentosCliente,
  listarDepartamentosCliente,
  previsualizarFusionDepartamentos,
} from '../../dominio/catalogos/cliente-departamentos.js';

/** Proyecta un `ClienteDepartamento` de Prisma a la forma JSON del contrato (fechas ISO). */
function aDepartamentoSalida(departamento: ClienteDepartamento): ClienteDepartamentoSalida {
  return {
    id: departamento.id,
    idCliente: departamento.idCliente,
    nombre: departamento.nombre,
    activo: departamento.activo,
    creadoEn: departamento.creadoEn.toISOString(),
    creadoPorId: departamento.creadoPorId,
    modificadoEn: departamento.modificadoEn.toISOString(),
    modificadoPorId: departamento.modificadoPorId,
  };
}

/** Parámetro de ruta `:idCliente` (entero positivo). Reutilizado por GET/POST. */
const esquemaParamCliente = z.object({
  idCliente: z.coerce
    .number({ error: 'El id del cliente debe ser un número' })
    .int({ error: 'El id del cliente debe ser entero' })
    .positive({ error: 'El id del cliente debe ser positivo' })
    .describe('Id del cliente.'),
});

/** Parámetros `:idCliente` + `:id` (departamento) para editar/borrar un departamento. */
const esquemaParamDepartamento = z.object({
  idCliente: z.coerce
    .number({ error: 'El id del cliente debe ser un número' })
    .int()
    .positive()
    .describe('Id del cliente.'),
  id: z.coerce
    .number({ error: 'El id del departamento debe ser un número' })
    .int()
    .positive()
    .describe('Id del departamento.'),
});

/** Querystring del listado de departamentos (permite traer los desactivados). */
const esquemaDepartamentosQuery = z.object({
  incluirInactivos: z
    .stringbool()
    .default(false)
    .describe('Incluye los departamentos desactivados ("true"/"false").'),
});

/** El cuerpo del PATCH de un departamento no repite el `id` (va en la URL). */
const esquemaDepartamentoPatchCuerpo = esquemaClienteDepartamentoEditar.omit({ id: true });

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de departamentos del cliente (montadas bajo `/api`). */
export const rutasClienteDepartamentos: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Listar los departamentos de un cliente ──────────────────────────────────
  app.route({
    method: 'GET',
    url: '/clientes/:idCliente/departamentos',
    preHandler: app.conPermiso('clientes.ver'),
    schema: {
      tags: ['clientes'],
      summary: 'Listar los departamentos de un cliente (D13/R16)',
      security: SEGURIDAD_SESION,
      params: esquemaParamCliente,
      querystring: esquemaDepartamentosQuery,
      response: { 200: esquemaClienteDepartamentosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const departamentos = await listarDepartamentosCliente(sesion, request.params.idCliente, {
        incluirInactivos: request.query.incluirInactivos,
      });
      return { datos: departamentos.map(aDepartamentoSalida) };
    },
  });

  // ── Agregar un departamento al cliente ──────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/clientes/:idCliente/departamentos',
    preHandler: app.conPermiso('clientes.administrar'),
    schema: {
      tags: ['clientes'],
      summary: 'Agregar un departamento a un cliente (D13/R16)',
      security: SEGURIDAD_SESION,
      params: esquemaParamCliente,
      body: esquemaClienteDepartamentoCrear,
      response: { 201: esquemaClienteDepartamentoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const departamento = await agregarDepartamentoCliente(
        sesion,
        request.params.idCliente,
        request.body,
      );
      return reply.code(201).send(aDepartamentoSalida(departamento));
    },
  });

  // ── Vista previa de la FUSIÓN: qué va a pasar ANTES de hacerlo (§Post-F9.122a) ──
  // Va ANTES del PATCH/DELETE por claridad de lectura; el ruteo no depende del orden
  // (métodos y rutas distintos), pero la previa y su fusión se leen juntas.
  app.route({
    method: 'POST',
    url: '/clientes/:idCliente/departamentos/fusionar/previa',
    preHandler: app.conPermiso('clientes.administrar'),
    schema: {
      tags: ['clientes'],
      summary: 'Vista previa de una fusión de departamentos duplicados (§Post-F9.122a)',
      description:
        'Sólo lectura: dice cuántos proyectos, listas de precios, cotizaciones y factores se moverían al departamento que se conserva, y si los factores del absorbido se descartarían. Usa las MISMAS funciones que la fusión, no un contador paralelo.',
      security: SEGURIDAD_SESION,
      params: esquemaParamCliente,
      body: esquemaClienteDepartamentoFusionar,
      response: { 200: esquemaFusionDepartamentosPrevia, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return previsualizarFusionDepartamentos(sesion, request.params.idCliente, request.body);
    },
  });

  // ── Fusionar departamentos duplicados (absorbidos → canónico) ───────────────
  app.route({
    method: 'POST',
    url: '/clientes/:idCliente/departamentos/fusionar',
    preHandler: app.conPermiso('clientes.administrar'),
    schema: {
      tags: ['clientes'],
      summary: 'Fusionar departamentos duplicados en uno canónico (§Post-F9.122a)',
      security: SEGURIDAD_SESION,
      params: esquemaParamCliente,
      body: esquemaClienteDepartamentoFusionar,
      response: { 200: esquemaClienteDepartamentoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const departamento = await fusionarDepartamentosCliente(
        sesion,
        request.params.idCliente,
        request.body,
      );
      return aDepartamentoSalida(departamento);
    },
  });

  // ── Actualizar un departamento (nombre/activo) ──────────────────────────────
  app.route({
    method: 'PATCH',
    url: '/clientes/:idCliente/departamentos/:id',
    preHandler: app.conPermiso('clientes.administrar'),
    schema: {
      tags: ['clientes'],
      summary: 'Actualizar un departamento de un cliente (D13/R16)',
      security: SEGURIDAD_SESION,
      params: esquemaParamDepartamento,
      body: esquemaDepartamentoPatchCuerpo,
      response: { 200: esquemaClienteDepartamentoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const departamento = await actualizarDepartamentoCliente(sesion, request.params.idCliente, {
        ...request.body,
        id: request.params.id,
      });
      return aDepartamentoSalida(departamento);
    },
  });

  // ── Desactivar (borrado SUAVE) un departamento ──────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/clientes/:idCliente/departamentos/:id',
    preHandler: app.conPermiso('clientes.administrar'),
    schema: {
      tags: ['clientes'],
      summary: 'Desactivar un departamento de un cliente (D13/R16)',
      security: SEGURIDAD_SESION,
      params: esquemaParamDepartamento,
      response: { 200: esquemaClienteDepartamentoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const departamento = await desactivarDepartamentoCliente(
        sesion,
        request.params.idCliente,
        request.params.id,
      );
      return aDepartamentoSalida(departamento);
    },
  });

  done();
};
