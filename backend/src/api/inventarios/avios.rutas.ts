/**
 * Rutas REST del INVENTARIO de AVÍOS por kardex (F4-E1; doc 04-Inventarios §B; R4). Handlers
 * DELGADOS (A1): validan (Zod), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/inventarios/avios`. Reglas (no-negativo, inverso de cancelación, existencia por suma
 * directa) en el dominio.
 *
 * Endpoints (empresa activa = A9):
 *  • `POST /inventarios/avios/ajustes`               (`inventario-avios.mover`) → ajuste (conteo físico/corrección).
 *  • `POST /inventarios/avios/traspasos`             (`inventario-avios.mover`) → traspaso (2 patas).
 *  • `POST /inventarios/avios/movimientos/:id/cancelar` (`inventario-avios.mover`) → inverso auditado.
 *  • `GET  /inventarios/avios/existencias`           (`inventario-avios.ver`)   → existencias multi-almacén (vista).
 *  • `GET  /inventarios/avios/kardex`                (`inventario-avios.ver`)   → kardex por avío.
 *
 * NINGÚN endpoint edita/borra existencias (D3).
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaAjusteAvioCrear,
  esquemaTraspasoAvioCrear,
  esquemaMovimientoMaterialCancelarCuerpo,
  esquemaMovimientoAvioSalida,
  esquemaTraspasoAvioSalida,
  esquemaExistenciasAvioQuery,
  esquemaExistenciasAvioLista,
  esquemaKardexAvioQuery,
  esquemaKardexAvioLista,
  esquemaParamIdMaterial,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  ajustarInventarioAvio,
  cancelarMovimientoAvio,
  consultarExistenciasAvio,
  kardexAvio,
  traspasarAvio,
} from '../../dominio/inventarios/avios.js';

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de inventario de avíos (montadas bajo `/api`). */
export const rutasInventarioAvios: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Ajuste (conteo físico / corrección) ──────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/inventarios/avios/ajustes',
    preHandler: app.conPermiso('inventario-avios.mover'),
    schema: {
      tags: ['inventario-avios'],
      summary: 'Registrar un ajuste de inventario de avío (conteo físico inicial / corrección)',
      security: SEGURIDAD_SESION,
      body: esquemaAjusteAvioCrear,
      response: { 201: esquemaMovimientoAvioSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const movimiento = await ajustarInventarioAvio(sesion, request.body);
      return reply.code(201).send(movimiento);
    },
  });

  // ── Traspaso entre almacenes (dos patas) ─────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/inventarios/avios/traspasos',
    preHandler: app.conPermiso('inventario-avios.mover'),
    schema: {
      tags: ['inventario-avios'],
      summary: 'Traspasar avío entre almacenes (salida del origen + entrada al destino)',
      security: SEGURIDAD_SESION,
      body: esquemaTraspasoAvioCrear,
      response: { 201: esquemaTraspasoAvioSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const traspaso = await traspasarAvio(sesion, request.body);
      return reply.code(201).send(traspaso);
    },
  });

  // ── Cancelar un movimiento (inverso auditado, D3) ────────────────────────────
  app.route({
    method: 'POST',
    url: '/inventarios/avios/movimientos/:id/cancelar',
    preHandler: app.conPermiso('inventario-avios.mover'),
    schema: {
      tags: ['inventario-avios'],
      summary: 'Cancelar un movimiento de avío (genera el inverso auditado; no edita ni borra)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdMaterial,
      body: esquemaMovimientoMaterialCancelarCuerpo,
      response: { 200: esquemaMovimientoAvioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarMovimientoAvio(sesion, request.params.id, request.body);
    },
  });

  // ── Existencias multi-almacén (consulta; vista existencia_avio) ──────────────
  app.route({
    method: 'GET',
    url: '/inventarios/avios/existencias',
    preHandler: app.conPermiso('inventario-avios.ver'),
    schema: {
      tags: ['inventario-avios'],
      summary: 'Existencias de avío por avío×almacén (consulta multi-almacén, distingue genéricos)',
      security: SEGURIDAD_SESION,
      querystring: esquemaExistenciasAvioQuery,
      response: { 200: esquemaExistenciasAvioLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return consultarExistenciasAvio(sesion, request.query);
    },
  });

  // ── Kardex por avío (movimientos con saldo corrido) ──────────────────────────
  app.route({
    method: 'GET',
    url: '/inventarios/avios/kardex',
    preHandler: app.conPermiso('inventario-avios.ver'),
    schema: {
      tags: ['inventario-avios'],
      summary: 'Kardex de un avío (movimientos cronológicos con saldo corrido por almacén)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKardexAvioQuery,
      response: { 200: esquemaKardexAvioLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return kardexAvio(sesion, request.query);
    },
  });

  done();
};
