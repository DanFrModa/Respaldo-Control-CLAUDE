/**
 * Rutas REST del ESTADO DE CUENTA de EsMa (F6-E5): estado de cuenta unificado, desglosado (+ PDF R9 +
 * Excel), saldos de todos, consultas semanales, selector de maquileros y revisión de partidas.
 * Handlers DELGADOS (A1): validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan al dominio.
 * Todo es solo lectura salvo `revisar` (transición de estado, `esma.modificar`). A9 por empresa activa.
 *
 * ORDEN de rutas: las estáticas (`/esma/maquileros`, `/esma/saldos`, …) no colisionan con las de
 * `:id` (Fastify usa un router radix: distinto número de segmentos = ruta distinta).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaEstadoCuentaQuery,
  esquemaEstadoCuentaSalida,
  esquemaDesglosadoSalida,
  esquemaSaldosTodosQuery,
  esquemaSaldosTodosSalida,
  esquemaPagosSemanalesQuery,
  esquemaPagosSemanalesSalida,
  esquemaRecibosSemanalesEsMaQuery,
  esquemaRecibosSemanalesEsMaSalida,
  esquemaMaquilerosEsMaQuery,
  esquemaMaquilerosEsMaLista,
  esquemaRevisionSalida,
  CONCEPTOS_MOVIMIENTO_ESMA,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { estadoCuentaMaquilero, estadoCuentaDesglosado } from '../../dominio/esma/estado-cuenta.js';
import { saldosDeTodosMaquileros } from '../../dominio/esma/saldos-todos.js';
import { pagosSemanales, recibosSemanalesMaquilaEsMa } from '../../dominio/esma/semanales.js';
import { listarMaquilerosEsMa } from '../../dominio/esma/maquileros.js';
import { revisarMovimiento } from '../../dominio/esma/movimientos.js';
import { impresoEstadoCuenta } from '../../dominio/esma/impresos/impreso-estado-cuenta.js';
import { excelEstadoCuenta } from '../../dominio/esma/impresos/excel-estado-cuenta.js';

/** Parámetro de ruta `:id` (id del maquilero). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del maquilero (Proveedor).'),
});

/** Parámetros de la revisión: concepto (abono/descuento/pago) + id del movimiento. */
const esquemaParamRevisar = z.object({
  concepto: z.enum(CONCEPTOS_MOVIMIENTO_ESMA).describe('Concepto del movimiento a revisar.'),
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del movimiento.'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del estado de cuenta de EsMa (montadas bajo `/api`). */
export const rutasEstadoCuentaEsMa: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Selector de maquileros (estática) ─────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/esma/maquileros',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Selector de maquileros activos (por tipo costura/estampado)',
      security: SEGURIDAD_SESION,
      querystring: esquemaMaquilerosEsMaQuery,
      response: { 200: esquemaMaquilerosEsMaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarMaquilerosEsMa(sesion, request.query);
    },
  });

  // ── Saldos de todos (estática) ────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/esma/saldos',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Saldos de maquileros activos con saldo ≠ 0 o algo por revisar (drill-down)',
      security: SEGURIDAD_SESION,
      querystring: esquemaSaldosTodosQuery,
      response: { 200: esquemaSaldosTodosSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return saldosDeTodosMaquileros(sesion, request.query);
    },
  });

  // ── Pagos semanales (estática) ────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/esma/pagos-semanales',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Pagos del periodo con su total (navegación por semana en el frontend)',
      security: SEGURIDAD_SESION,
      querystring: esquemaPagosSemanalesQuery,
      response: { 200: esquemaPagosSemanalesSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return pagosSemanales(sesion, request.query);
    },
  });

  // ── Recibos semanales de maquila (estática) ───────────────────────────────────
  app.route({
    method: 'GET',
    url: '/esma/recibos-semanales',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Recibos de maquila del periodo por maquilero/modelo (importes ocultables)',
      security: SEGURIDAD_SESION,
      querystring: esquemaRecibosSemanalesEsMaQuery,
      response: { 200: esquemaRecibosSemanalesEsMaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return recibosSemanalesMaquilaEsMa(sesion, request.query);
    },
  });

  // ── Revisión (autorización) de una partida ────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/esma/movimientos/:concepto/:id/revisar',
    preHandler: app.conPermiso('esma.modificar'),
    schema: {
      tags: ['esma'],
      summary: 'Revisar (autorizar) una partida capturada → revisada',
      security: SEGURIDAD_SESION,
      params: esquemaParamRevisar,
      response: { 200: esquemaRevisionSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return revisarMovimiento(sesion, request.params.concepto, request.params.id);
    },
  });

  // ── Estado de cuenta unificado de un maquilero ────────────────────────────────
  app.route({
    method: 'GET',
    url: '/esma/maquileros/:id/estado-cuenta',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Estado de cuenta unificado de un maquilero (4 conceptos por fecha + saldo)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      querystring: esquemaEstadoCuentaQuery,
      response: { 200: esquemaEstadoCuentaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return estadoCuentaMaquilero(sesion, request.params.id, request.query);
    },
  });

  // ── Desglosado de un maquilero ─────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/esma/maquileros/:id/desglosado',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Estado de cuenta desglosado por orden/modelo (+ movimientos + saldo)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      querystring: esquemaEstadoCuentaQuery,
      response: { 200: esquemaDesglosadoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return estadoCuentaDesglosado(sesion, request.params.id, request.query);
    },
  });

  // ── Desglosado: impreso PDF (R9) ───────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/esma/maquileros/:id/desglosado/impreso',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Estado de cuenta del maquilero por periodo (PDF, R9)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      querystring: esquemaEstadoCuentaQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, idMaquilero } = await impresoEstadoCuenta(
        sesion,
        request.params.id,
        request.query,
      );
      reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `inline; filename="estado-cuenta-${String(idMaquilero)}.pdf"`,
        );
      return reply.send(buffer as unknown as never);
    },
  });

  // ── Desglosado: export Excel ───────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/esma/maquileros/:id/desglosado/excel',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Estado de cuenta desglosado del maquilero (Excel .xlsx)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      querystring: esquemaEstadoCuentaQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await excelEstadoCuenta(sesion, request.params.id, request.query);
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header(
          'Content-Disposition',
          `attachment; filename="estado-cuenta-${String(request.params.id)}.xlsx"`,
        );
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
