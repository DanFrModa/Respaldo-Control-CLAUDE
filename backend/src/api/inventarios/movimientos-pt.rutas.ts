/**
 * Rutas REST del INVENTARIO de PRODUCTO TERMINADO operable (F3-E3). Handlers DELGADOS (A1): validan
 * (Zod compartido de `src/contrato`), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/inventarios/movimientos-pt`. Las reglas (no-negativo, traspaso de dos patas, inverso de
 * cancelación, existencia por suma directa) viven en el dominio.
 *
 * Endpoints (todos por la empresa activa de la sesión = A9):
 *  • `POST /inventarios/pt/movimientos`            (perm `inventario-pt.mover`) → movimiento manual.
 *  • `POST /inventarios/pt/traspasos`              (perm `inventario-pt.mover`) → traspaso (2 patas).
 *  • `POST /inventarios/pt/movimientos/:id/cancelar` (perm `inventario-pt.mover`) → inverso auditado.
 *  • `GET  /inventarios/pt/existencias`            (perm `inventario-pt.ver`)   → existencias (vista).
 *  • `GET  /inventarios/pt/kardex`                 (perm `inventario-pt.ver`)   → kardex por modelo.
 *  • `GET  /inventarios/pt/kardex/folio/:folio`    (perm `inventario-pt.ver`)   → un movimiento por folio.
 *  • `GET  /inventarios/pt/traspasos/:id/impreso` (perm `inventario-pt.ver`)   → hoja del traspaso (PDF).
 *
 * NINGÚN endpoint edita ni borra movimientos (D3): la corrección es un inverso por la ruta de cancelar.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaMovimientoPtCrear,
  esquemaTraspasoPtCrear,
  esquemaMovimientoPtCancelarCuerpo,
  esquemaMovimientoPtSalida,
  esquemaTraspasoPtSalida,
  esquemaExistenciasPtQuery,
  esquemaExistenciasPtLista,
  esquemaKardexPtQuery,
  esquemaKardexPtLista,
  esquemaParamFolio,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  cancelarMovimientoPt,
  consultarExistenciasPt,
  kardexPt,
  obtenerMovimientoPorFolio,
  registrarMovimientoPt,
  registrarTraspasoPt,
} from '../../dominio/inventarios/movimientos-pt.js';
import { impresoTraspasoPt } from '../../dominio/inventarios/impresos/impreso-traspaso-pt.js';

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

/** Registra las rutas de inventario PT (montadas bajo `/api`). */
export const rutasMovimientosPt: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Movimiento manual (entrada/salida/ajuste) ────────────────────────────────
  app.route({
    method: 'POST',
    url: '/inventarios/pt/movimientos',
    preHandler: app.conPermiso('inventario-pt.mover'),
    schema: {
      tags: ['inventario-pt'],
      summary: 'Registrar un movimiento manual de inventario PT (entrada/salida/ajuste)',
      security: SEGURIDAD_SESION,
      body: esquemaMovimientoPtCrear,
      response: { 201: esquemaMovimientoPtSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const movimiento = await registrarMovimientoPt(sesion, request.body);
      return reply.code(201).send(movimiento);
    },
  });

  // ── Traspaso entre almacenes (dos patas en una operación) ────────────────────
  app.route({
    method: 'POST',
    url: '/inventarios/pt/traspasos',
    preHandler: app.conPermiso('inventario-pt.mover'),
    schema: {
      tags: ['inventario-pt'],
      summary: 'Traspasar PT entre almacenes (salida del origen + entrada al destino)',
      security: SEGURIDAD_SESION,
      body: esquemaTraspasoPtCrear,
      response: { 201: esquemaTraspasoPtSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const traspaso = await registrarTraspasoPt(sesion, request.body);
      return reply.code(201).send(traspaso);
    },
  });

  // ── Cancelar un movimiento (inverso auditado, D3) ────────────────────────────
  app.route({
    method: 'POST',
    url: '/inventarios/pt/movimientos/:id/cancelar',
    preHandler: app.conPermiso('inventario-pt.mover'),
    schema: {
      tags: ['inventario-pt'],
      summary: 'Cancelar un movimiento PT (genera el inverso auditado; no edita ni borra)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaMovimientoPtCancelarCuerpo,
      response: { 200: esquemaMovimientoPtSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarMovimientoPt(sesion, request.params.id, request.body);
    },
  });

  // ── Existencias (consulta; vista existencia_pt) ──────────────────────────────
  app.route({
    method: 'GET',
    url: '/inventarios/pt/existencias',
    preHandler: app.conPermiso('inventario-pt.ver'),
    schema: {
      tags: ['inventario-pt'],
      summary: 'Existencias de PT por modelo×color×talla×almacén (consulta)',
      security: SEGURIDAD_SESION,
      querystring: esquemaExistenciasPtQuery,
      response: { 200: esquemaExistenciasPtLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return consultarExistenciasPt(sesion, request.query);
    },
  });

  // ── Kardex por modelo (movimientos con saldo corrido) ────────────────────────
  app.route({
    method: 'GET',
    url: '/inventarios/pt/kardex',
    preHandler: app.conPermiso('inventario-pt.ver'),
    schema: {
      tags: ['inventario-pt'],
      summary: 'Kardex de un modelo (movimientos cronológicos con saldo corrido)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKardexPtQuery,
      response: { 200: esquemaKardexPtLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return kardexPt(sesion, request.query);
    },
  });

  // ── Kardex por folio (un movimiento con su matriz) ───────────────────────────
  app.route({
    method: 'GET',
    url: '/inventarios/pt/kardex/folio/:folio',
    preHandler: app.conPermiso('inventario-pt.ver'),
    schema: {
      tags: ['inventario-pt'],
      summary: 'Detalle de un movimiento PT por su folio (empresa activa)',
      security: SEGURIDAD_SESION,
      params: esquemaParamFolio,
      response: { 200: esquemaMovimientoPtSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerMovimientoPorFolio(sesion, request.params.folio);
    },
  });

  // ── Impreso PDF 'Traspaso de PT entre almacenes' (fila 0.100, §Post-F9.193) ──
  // La hoja que ACOMPAÑA las prendas que salen a otro almacén. NO genera folio ni documento nuevo:
  // IMPRIME el traspaso que ya existe, por el id de CUALQUIERA de sus dos patas (así se reimprime
  // desde el kardex en modo «Por folio», que es la segunda puerta del papel). Un traspaso cancelado
  // NO se imprime (400).
  // Respuesta BINARIA (application/pdf): no se declara `response` 200 (Fastify manda el Buffer).
  app.route({
    method: 'GET',
    url: '/inventarios/pt/traspasos/:id/impreso',
    preHandler: app.conPermiso('inventario-pt.ver'),
    schema: {
      tags: ['inventario-pt'],
      summary: 'Hoja del traspaso de PT entre almacenes (PDF del folio que ya existe)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await impresoTraspasoPt(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="traspaso-pt-${String(folio)}.pdf"`);
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
