/**
 * Rutas REST de LA CORRIDA SEMANAL DE PAGOS (fila 0.113). Handlers DELGADOS (A1): validan (Zod
 * compartido), autorizan (`conPermiso`, A4) y delegan al dominio `dominio/pagos/corrida`. Toda la
 * regla —la guarda fiscal, el congelado del destino, el nacimiento de los movimientos— vive allá.
 *
 * DOS permisos (§Post-F9.189(g)): `pagos.corrida-armar` para armar / cerrar / ejecutar (Daniel) y
 * `pagos.corrida-ver` para consultar (finanzas, sólo lectura).
 *
 * ⚠️ Las LECTURAS aceptan cualquiera de los dos (`conAlgunPermiso`): quien arma la corrida
 * obviamente la ve, y exigirle además el de consulta convertiría un rol a medio configurar en un
 * 403 justo después de crear la corrida (las mutaciones devuelven la pantalla entera). El dominio
 * aplica el MISMO criterio (`exigirVerCorrida`), así que la reja no depende de la ruta.
 *
 * Endpoints (por la empresa activa = A9):
 *  • `GET    /pagos/corridas`                             (ver **o** armar) → lista paginada.
 *  • `POST   /pagos/corridas`                             (`…corrida-armar`) → abre la semana.
 *  • `GET    /pagos/corridas/:id`                         (ver **o** armar) → la pantalla de trabajo.
 *  • `DELETE /pagos/corridas/:id`                         (`…corrida-armar`) → borra un BORRADOR.
 *  • `POST   /pagos/corridas/:id/renglones`               (`…corrida-armar`) → captura un renglón.
 *  • `PUT    /pagos/corridas/:id/renglones/:idRenglon`    (`…corrida-armar`) → lo reemplaza.
 *  • `DELETE /pagos/corridas/:id/renglones/:idRenglon`    (`…corrida-armar`) → lo quita.
 *  • `POST   /pagos/corridas/:id/cerrar`                  (`…corrida-armar`) → la deja final.
 *  • `POST   /pagos/corridas/:id/ejecutar`                (`…corrida-armar`) → nacen los movimientos.
 *  • `GET    /pagos/corridas/:id/concentrado`             (ver **o** armar) → la relación ejecutable.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaConcentradoSalida,
  esquemaCorridaCrear,
  esquemaCorridaDetalleSalida,
  esquemaCorridasLista,
  esquemaCorridasQuery,
  esquemaErrorApi,
  esquemaRenglonCorridaGuardar,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  cerrarCorrida,
  concentradoDeCorrida,
  crearCorrida,
  ejecutarCorrida,
  eliminarCorrida,
  eliminarRenglonCorrida,
  guardarRenglonCorrida,
  listarCorridas,
  obtenerCorridaDetalle,
} from '../../dominio/pagos/corrida.js';

/** Parámetro de ruta `:id`. */
const esquemaParamId = z.object({
  id: z.coerce.number().int().positive().describe('Id de la corrida.'),
});

/** Parámetros `:id/:idRenglon`. */
const esquemaParamRenglon = esquemaParamId.extend({
  idRenglon: z.coerce.number().int().positive().describe('Id del renglón.'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de la corrida de pagos (montadas bajo `/api`). */
export const rutasCorridaPagos: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/pagos/corridas',
    preHandler: app.conAlgunPermiso('pagos.corrida-ver', 'pagos.corrida-armar'),
    schema: {
      tags: ['pagos'],
      summary: 'Corridas semanales de pago (las de con factura y las de sin)',
      security: SEGURIDAD_SESION,
      querystring: esquemaCorridasQuery,
      response: { 200: esquemaCorridasLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarCorridas(sesion, request.query);
    },
  });

  app.route({
    method: 'POST',
    url: '/pagos/corridas',
    preHandler: app.conPermiso('pagos.corrida-armar'),
    schema: {
      tags: ['pagos'],
      summary: 'Abrir la corrida de la semana (carga los conceptos predeterminados en cero)',
      security: SEGURIDAD_SESION,
      body: esquemaCorridaCrear,
      response: { 201: esquemaCorridaDetalleSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const detalle = await crearCorrida(sesion, request.body);
      return reply.code(201).send(detalle);
    },
  });

  app.route({
    method: 'GET',
    url: '/pagos/corridas/:id',
    preHandler: app.conAlgunPermiso('pagos.corrida-ver', 'pagos.corrida-armar'),
    schema: {
      tags: ['pagos'],
      summary: 'La pantalla de trabajo: saldos y conceptos por rubro, con lo capturado',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaCorridaDetalleSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerCorridaDetalle(sesion, request.params.id);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/pagos/corridas/:id',
    preHandler: app.conPermiso('pagos.corrida-armar'),
    schema: {
      tags: ['pagos'],
      summary: 'Eliminar una corrida en BORRADOR (una cerrada no se borra jamás)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await eliminarCorrida(sesion, request.params.id);
      return reply.code(204).send(null);
    },
  });

  app.route({
    method: 'POST',
    url: '/pagos/corridas/:id/renglones',
    preHandler: app.conPermiso('pagos.corrida-armar'),
    schema: {
      tags: ['pagos'],
      summary: 'Capturar un renglón (a quién, cuánto y por dónde)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaRenglonCorridaGuardar,
      response: { 200: esquemaCorridaDetalleSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return guardarRenglonCorrida(sesion, request.params.id, request.body);
    },
  });

  app.route({
    method: 'PUT',
    url: '/pagos/corridas/:id/renglones/:idRenglon',
    preHandler: app.conPermiso('pagos.corrida-armar'),
    schema: {
      tags: ['pagos'],
      summary: 'Reemplazar un renglón (monto, forma de pago o cuenta destino)',
      security: SEGURIDAD_SESION,
      params: esquemaParamRenglon,
      body: esquemaRenglonCorridaGuardar,
      response: { 200: esquemaCorridaDetalleSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return guardarRenglonCorrida(
        sesion,
        request.params.id,
        request.body,
        request.params.idRenglon,
      );
    },
  });

  app.route({
    method: 'DELETE',
    url: '/pagos/corridas/:id/renglones/:idRenglon',
    preHandler: app.conPermiso('pagos.corrida-armar'),
    schema: {
      tags: ['pagos'],
      summary: 'Quitar un renglón de un BORRADOR',
      security: SEGURIDAD_SESION,
      params: esquemaParamRenglon,
      response: { 200: esquemaCorridaDetalleSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return eliminarRenglonCorrida(sesion, request.params.id, request.params.idRenglon);
    },
  });

  app.route({
    method: 'POST',
    url: '/pagos/corridas/:id/cerrar',
    preHandler: app.conPermiso('pagos.corrida-armar'),
    schema: {
      tags: ['pagos'],
      summary: 'Cerrar la relación (aquí muerde la guarda fiscal, con nombre y apellido)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaCorridaDetalleSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cerrarCorrida(sesion, request.params.id);
    },
  });

  app.route({
    method: 'POST',
    url: '/pagos/corridas/:id/ejecutar',
    preHandler: app.conPermiso('pagos.corrida-armar'),
    schema: {
      tags: ['pagos'],
      summary: 'Ejecutar: el dinero salió y nacen los movimientos en los estados de cuenta',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaCorridaDetalleSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return ejecutarCorrida(sesion, request.params.id);
    },
  });

  app.route({
    method: 'GET',
    url: '/pagos/corridas/:id/concentrado',
    preHandler: app.conAlgunPermiso('pagos.corrida-ver', 'pagos.corrida-armar'),
    schema: {
      tags: ['pagos'],
      summary: 'La relación ejecutable: sólo lo que lleva monto, por rubro y por monto',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaConcentradoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return concentradoDeCorrida(sesion, request.params.id);
    },
  });

  done();
};
