/**
 * Ruta REST de la CONSULTA DE BITÁCORA (F6-E1, transversal; A7). Solo lectura: lista paginada de
 * los registros `Bitacora` con filtros, para que la administración audite los cambios sin SQL.
 * Ruta delgada (A1): valida con el esquema Zod compartido, autoriza server-side
 * (`admin.ver-bitacora` — deny-by-default, §9.2) y delega al servicio `dominio/admin/bitacora`.
 * Montada bajo `/api`.
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaBitacoraPagina,
  esquemaBitacoraQuery,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { listarBitacora } from '../../dominio/admin/bitacora.js';

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
} as const;

export const rutasBitacora: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/admin/bitacora',
    preHandler: app.conPermiso('admin.ver-bitacora'),
    schema: {
      tags: ['admin'],
      summary: 'Consultar la bitácora de cambios del sistema (auditoría A7)',
      security: SEGURIDAD_SESION,
      querystring: esquemaBitacoraQuery,
      response: { 200: esquemaBitacoraPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarBitacora(sesion, request.query);
    },
  });

  done();
};
