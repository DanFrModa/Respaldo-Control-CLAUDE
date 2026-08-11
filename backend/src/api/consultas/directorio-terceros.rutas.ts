/**
 * Ruta REST del DIRECTORIO HISTÓRICO DE TERCEROS del sistema viejo (§Post-F9.28). Handler DELGADO
 * (A1): autoriza y delega a `dominio/consultas/directorio-terceros`.
 *
 * SOLO GET, y así se queda: la libreta se llena con el ETL y no se edita. Tampoco hay endpoint de
 * "convertir en proveedor" — ver el TSDoc del dominio.
 *
 * NOTA DE INTEGRACIÓN: se registra en `app.ts`.
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaDirectorioTercerosPagina,
  esquemaDirectorioTercerosQuery,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { listarDirectorioTerceros } from '../../dominio/consultas/directorio-terceros.js';

export const rutasDirectorioTerceros: FastifyPluginCallbackZod = (app, _opciones, done) => {
  app.route({
    method: 'GET',
    url: '/directorio-terceros',
    preHandler: app.conPermiso('proveedores.ver'),
    schema: {
      tags: ['historico'],
      summary: 'Buscar en el directorio histórico de terceros del sistema viejo',
      security: SEGURIDAD_SESION,
      querystring: esquemaDirectorioTercerosQuery,
      response: {
        200: esquemaDirectorioTercerosPagina,
        401: esquemaErrorApi,
        403: esquemaErrorApi,
      },
    },
    handler: async (request) => {
      const sesion: SesionUsuario | null = await request.obtenerSesion();
      if (sesion === null) {
        throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
      }
      return listarDirectorioTerceros(sesion, request.query);
    },
  });

  done();
};
