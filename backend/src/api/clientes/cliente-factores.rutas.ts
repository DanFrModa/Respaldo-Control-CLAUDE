/**
 * Rutas REST de los FACTORES del cliente para la lista de precios (F8-E4, D13/R20a). Sub-recurso del
 * Cliente: default por cliente + override por departamento. Handlers DELGADOS (A1): validan (Zod
 * compartido), autorizan (`conPermiso`, A4) y delegan al dominio `dominio/desarrollo/cliente-factores`.
 *
 * RBAC (los factores viven en el MÓDULO de listas, no en `clientes.*`): LEER exige `listas.ver`;
 * GUARDAR exige `listas.administrar` Y `listas.ver` (preHandler en arreglo = AND; mutar implica leer,
 * así nunca se guarda para responder 403 al releer). Los porcentajes se OCULTAN (null) server-side sin
 * `consultas.ver-importes` (mismo criterio que precosto/lista).
 *
 * Endpoints:
 *  • `GET /clientes/:idCliente/factores`  (listas.ver)          → default + overrides.
 *  • `PUT /clientes/:idCliente/factores`  (listas.administrar)  → upsert por [cliente, departamento?].
 * Se registra en `app.ts`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/index.js';
import {
  esquemaClienteFactoresGuardar,
  esquemaClienteFactoresSalida,
  esquemaClienteFactoresLista,
} from '../../contrato/esquemas/cliente-factores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  guardarFactoresCliente,
  listarFactoresCliente,
} from '../../dominio/desarrollo/cliente-factores.js';

/** Parámetro de ruta `:idCliente`. */
const esquemaParamCliente = z.object({
  idCliente: z.coerce
    .number({ error: 'El id del cliente debe ser un número' })
    .int({ error: 'El id del cliente debe ser entero' })
    .positive({ error: 'El id del cliente debe ser positivo' })
    .describe('Id del cliente.'),
});

/** Respuestas de error comunes a toda ruta protegida. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de factores del cliente (montadas bajo `/api`). */
export const rutasClienteFactores: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Listar los factores del cliente (default + overrides por departamento).
  app.route({
    method: 'GET',
    url: '/clientes/:idCliente/factores',
    preHandler: app.conPermiso('listas.ver'),
    schema: {
      tags: ['listas'],
      summary: 'Listar los factores de lista de un cliente (default + overrides por departamento)',
      security: SEGURIDAD_SESION,
      params: esquemaParamCliente,
      response: { 200: esquemaClienteFactoresLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await listarFactoresCliente(sesion, request.params.idCliente);
      return { datos };
    },
  });

  // Guardar (upsert) los factores del cliente o de uno de sus departamentos.
  app.route({
    method: 'PUT',
    url: '/clientes/:idCliente/factores',
    preHandler: [app.conPermiso('listas.administrar'), app.conPermiso('listas.ver')],
    schema: {
      tags: ['listas'],
      summary: 'Guardar los factores de lista de un cliente/departamento (upsert)',
      security: SEGURIDAD_SESION,
      params: esquemaParamCliente,
      body: esquemaClienteFactoresGuardar,
      response: { 200: esquemaClienteFactoresSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return guardarFactoresCliente(sesion, request.params.idCliente, request.body);
    },
  });

  done();
};
