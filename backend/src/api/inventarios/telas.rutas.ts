/**
 * Rutas REST del INVENTARIO de TELAS por kardex (F4-E1; doc 04-Inventarios §B; D5). Handlers
 * DELGADOS (A1): validan (Zod compartido de `src/contrato`), autorizan (`conPermiso`, A4) y delegan
 * al dominio `dominio/inventarios/telas`. Las reglas (no-negativo, lote del ajuste, inverso de
 * cancelación, existencia por suma directa, ocultamiento de importes del ex-acceso #7) viven en el
 * dominio.
 *
 * Endpoints (todos por la empresa activa = A9):
 *  • `POST /inventarios/telas/ajustes`               (`inventario-telas.mover`) → ajuste (puede crear lote).
 *  • `POST /inventarios/telas/salidas-orden`         (`inventario-telas.mover`) → salida ligada a orden.
 *  • `POST /inventarios/telas/traspasos`             (`inventario-telas.mover`) → traspaso (2 patas).
 *  • `POST /inventarios/telas/movimientos/:id/cancelar` (`inventario-telas.mover`) → inverso auditado.
 *  • `GET  /inventarios/telas/existencias`           (`inventario-telas.ver`)   → existencias (vista).
 *  • `GET  /inventarios/telas/kardex`                (`inventario-telas.ver`)   → kardex por tela.
 *
 * NINGÚN endpoint edita/borra existencias (D3). Los importes de telas se omiten server-side a quien
 * no tenga `telas.ver-totales` (ex-acceso #7) — la decisión es del dominio, no de la UI.
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaAjusteTelaCrear,
  esquemaSalidaTelaCrear,
  esquemaTraspasoTelaCrear,
  esquemaMovimientoMaterialCancelarCuerpo,
  esquemaMovimientoTelaSalida,
  esquemaTraspasoTelaSalida,
  esquemaExistenciasTelaQuery,
  esquemaExistenciasTelaLista,
  esquemaKardexTelaQuery,
  esquemaKardexTelaLista,
  esquemaParamIdMaterial,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { impresoInventarioTelas } from '../../dominio/inventarios/impresos/impreso-inventario-telas.js';
import {
  ajustarInventarioTela,
  cancelarMovimientoTela,
  consultarExistenciasTela,
  kardexTela,
  registrarSalidaTelaAOrden,
  traspasarTela,
} from '../../dominio/inventarios/telas.js';

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de inventario de telas (montadas bajo `/api`). */
export const rutasInventarioTelas: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Ajuste (conteo físico / corrección; puede crear lote en una entrada) ─────
  app.route({
    method: 'POST',
    url: '/inventarios/telas/ajustes',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Registrar un ajuste de inventario de tela (entrada con lote nuevo o salida/corrección)',
      security: SEGURIDAD_SESION,
      body: esquemaAjusteTelaCrear,
      response: { 201: esquemaMovimientoTelaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const movimiento = await ajustarInventarioTela(sesion, request.body);
      return reply.code(201).send(movimiento);
    },
  });

  // ── Salida de tela a una orden de producción ─────────────────────────────────
  app.route({
    method: 'POST',
    url: '/inventarios/telas/salidas-orden',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Registrar una salida de tela ligada a una orden de producción (única vía que descuenta)',
      security: SEGURIDAD_SESION,
      body: esquemaSalidaTelaCrear,
      response: { 201: esquemaMovimientoTelaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const movimiento = await registrarSalidaTelaAOrden(sesion, request.body);
      return reply.code(201).send(movimiento);
    },
  });

  // ── Traspaso entre almacenes (dos patas) ─────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/inventarios/telas/traspasos',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Traspasar tela entre almacenes (salida del origen + entrada al destino)',
      security: SEGURIDAD_SESION,
      body: esquemaTraspasoTelaCrear,
      response: { 201: esquemaTraspasoTelaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const traspaso = await traspasarTela(sesion, request.body);
      return reply.code(201).send(traspaso);
    },
  });

  // ── Cancelar un movimiento (inverso auditado, D3) ────────────────────────────
  app.route({
    method: 'POST',
    url: '/inventarios/telas/movimientos/:id/cancelar',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Cancelar un movimiento de tela (genera el inverso auditado; no edita ni borra)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdMaterial,
      body: esquemaMovimientoMaterialCancelarCuerpo,
      response: { 200: esquemaMovimientoTelaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarMovimientoTela(sesion, request.params.id, request.body);
    },
  });

  // ── Existencias (consulta; vista existencia_tela) ────────────────────────────
  app.route({
    method: 'GET',
    url: '/inventarios/telas/existencias',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Existencias de tela por tela×lote×almacén (consulta, con componentes del lote)',
      security: SEGURIDAD_SESION,
      querystring: esquemaExistenciasTelaQuery,
      response: { 200: esquemaExistenciasTelaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return consultarExistenciasTela(sesion, request.query);
    },
  });

  // ── Kardex por tela (movimientos con saldo corrido) ──────────────────────────
  app.route({
    method: 'GET',
    url: '/inventarios/telas/kardex',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Kardex de una tela (movimientos cronológicos con saldo corrido por lote)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKardexTelaQuery,
      response: { 200: esquemaKardexTelaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return kardexTela(sesion, request.query);
    },
  });

  // ── Impreso PDF 'Inventario de telas' (R9) ───────────────────────────────────
  // Respuesta BINARIA (application/pdf): no se declara `response` 200 (Fastify manda el Buffer).
  // Reusa el mismo querystring de existencias (mismos filtros). Permiso `inventario-telas.ver`.
  app.route({
    method: 'GET',
    url: '/inventarios/telas/impreso',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Imprimir el inventario de telas (PDF de existencias por tela × lote × almacén)',
      security: SEGURIDAD_SESION,
      querystring: esquemaExistenciasTelaQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const buffer = await impresoInventarioTelas(sesion, request.query);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'inline; filename="inventario-telas.pdf"');
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
