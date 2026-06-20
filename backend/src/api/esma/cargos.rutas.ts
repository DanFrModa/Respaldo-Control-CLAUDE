/**
 * Rutas REST de los CARGOS EsMa — cola de validación (F3-E4). Handlers DELGADOS (A1): validan (Zod
 * compartido de `src/contrato`), autorizan (`conPermiso`, A4) y delegan al dominio `dominio/esma/
 * cargos`. La lógica (propuesto→validado, derivación de la propuesta desde el recibo) vive en el
 * dominio.
 *
 * Endpoints (todos por la empresa activa de la sesión = A9):
 *  • `GET  /esma/cargos`            (perm `esma.cargo-validar`) → cola de cargos por estado (default propuesto).
 *  • `GET  /esma/cargos/:id`        (perm `esma.cargo-validar`) → un cargo.
 *  • `POST /esma/cargos/:id/validar`(perm `esma.cargo-validar`) → valida/ajusta cantidad y precio.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaCargoEsMaValidarCuerpo,
  esquemaCargosEsMaQuery,
  esquemaCargoEsMaSalida,
  esquemaCargosEsMaLista,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { listarCargosEsMa, obtenerCargoEsMa, validarCargoEsMa } from '../../dominio/esma/cargos.js';

/** Parámetro de ruta `:id`. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del cargo.'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de cargos EsMa (montadas bajo `/api`). */
export const rutasCargosEsMa: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/esma/cargos',
    preHandler: app.conPermiso('esma.cargo-validar'),
    schema: {
      tags: ['esma'],
      summary: 'Cola de cargos EsMa por estado (default propuesto)',
      security: SEGURIDAD_SESION,
      querystring: esquemaCargosEsMaQuery,
      response: { 200: esquemaCargosEsMaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarCargosEsMa(sesion, request.query);
    },
  });

  app.route({
    method: 'GET',
    url: '/esma/cargos/:id',
    preHandler: app.conPermiso('esma.cargo-validar'),
    schema: {
      tags: ['esma'],
      summary: 'Obtener un cargo EsMa',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaCargoEsMaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerCargoEsMa(sesion, request.params.id);
    },
  });

  app.route({
    method: 'POST',
    url: '/esma/cargos/:id/validar',
    preHandler: app.conPermiso('esma.cargo-validar'),
    schema: {
      tags: ['esma'],
      summary: 'Validar (o ajustar cantidad y precio) un cargo EsMa propuesto',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaCargoEsMaValidarCuerpo,
      response: { 200: esquemaCargoEsMaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return validarCargoEsMa(sesion, request.params.id, request.body);
    },
  });

  done();
};
