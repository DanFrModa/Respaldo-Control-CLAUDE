/**
 * Rutas REST de la CUENTA de maquileros de EsMa — SALDO derivado, CONCILIACIÓN vs recibos y estatus
 * "orden pagada" (F6-E4). Handlers DELGADOS (A1): validan (Zod compartido), autorizan (`conPermiso`,
 * A4) y delegan al dominio. El saldo/estatus se DERIVAN (D3): nunca hay columna editable de saldo.
 *
 * Endpoints (por la empresa activa = A9):
 *  • `GET  /esma/maquileros/:id/saldo`  (perm `esma.ver-pagos`) → saldo derivado (segmentable por factura).
 *  • `GET  /esma/conciliacion`          (perm `esma.ver-pagos`) → cuadre recibido vs cargado + cargos sin recibo.
 *  • `GET  /esma/ordenes/:id/pagada`    (perm `esma.ver-pagos`) → estatus "pagada" (derivado + override).
 *  • `POST /esma/ordenes/:id/pagada`    (perm `esma.modificar`) → forzar/limpiar el override de "pagada".
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaSaldoQuery,
  esquemaSaldoSalida,
  esquemaConciliacionQuery,
  esquemaConciliacionSalida,
  esquemaOrdenPagadaForzarCuerpo,
  esquemaOrdenPagadaSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { saldoDeMaquilero } from '../../dominio/esma/saldos.js';
import { conciliarEsMa } from '../../dominio/esma/conciliacion.js';
import { forzarOrdenPagada, obtenerOrdenPagada } from '../../dominio/esma/orden-pagada.js';

/** Parámetro de ruta `:id`. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del recurso.'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de saldo/conciliación/orden pagada (montadas bajo `/api`). */
export const rutasCuentaEsMa: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/esma/maquileros/:id/saldo',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Saldo derivado de un maquilero (Σcargos+Σabonos−Σpagos−Σdescuentos)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      querystring: esquemaSaldoQuery,
      response: { 200: esquemaSaldoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return saldoDeMaquilero(sesion, request.params.id, request.query);
    },
  });

  app.route({
    method: 'GET',
    url: '/esma/conciliacion',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Conciliación EsMa vs recibos: faltantes por cargar + cargos sin recibo',
      security: SEGURIDAD_SESION,
      querystring: esquemaConciliacionQuery,
      response: { 200: esquemaConciliacionSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return conciliarEsMa(sesion, request.query);
    },
  });

  app.route({
    method: 'GET',
    url: '/esma/ordenes/:id/pagada',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Estatus "pagada" de una orden (derivado + override)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaOrdenPagadaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerOrdenPagada(sesion, request.params.id);
    },
  });

  app.route({
    method: 'POST',
    url: '/esma/ordenes/:id/pagada',
    preHandler: app.conPermiso('esma.modificar'),
    schema: {
      tags: ['esma'],
      summary: 'Forzar/limpiar el override manual de "pagada" de una orden (decisión f)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaOrdenPagadaForzarCuerpo,
      response: { 200: esquemaOrdenPagadaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return forzarOrdenPagada(sesion, request.params.id, request.body);
    },
  });

  done();
};
