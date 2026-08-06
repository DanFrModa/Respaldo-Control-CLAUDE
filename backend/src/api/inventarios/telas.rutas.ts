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
 * INVENTARIO NUEVO POR COLOR (etapa A2 — partidas + tela×color; el flujo por Lote de arriba queda
 * como legado consultable; dominio `dominio/inventarios/partidas-telas`):
 *  • `POST /inventarios/telas/color/ajustes`         (`inventario-telas.mover`) → ajuste (entrada crea partidas).
 *  • `POST /inventarios/telas/color/salidas-orden`   (`inventario-telas.mover`) → salida a orden (sin partida).
 *  • `POST /inventarios/telas/color/traspasos`       (`inventario-telas.mover`) → traspaso (2 patas, ambas cantidades).
 *  • `POST /inventarios/telas/color/movimientos/:id/cancelar` (`inventario-telas.mover`) → inverso auditado.
 *  • `GET  /inventarios/telas/color/existencias`     (`inventario-telas.ver`)   → agrupadas tela → colores.
 *  • `GET  /inventarios/telas/color/kardex`          (`inventario-telas.ver`)   → kardex por color (2 componentes).
 *  • `GET  /inventarios/telas/partidas`              (`inventario-telas.ver`)   → búsqueda de partidas.
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
  esquemaAjusteTelaColorCrear,
  esquemaSalidaTelaColorCrear,
  esquemaTraspasoTelaColorCrear,
  esquemaMovimientoTelaColorSalida,
  esquemaTraspasoTelaColorSalida,
  esquemaExistenciasTelaColorQuery,
  esquemaExistenciasTelaColorLista,
  esquemaKardexTelaColorQuery,
  esquemaKardexTelaColorLista,
  esquemaPartidasTelaQuery,
  esquemaPartidasTelaLista,
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
import {
  ajustarInventarioTelaColor,
  cancelarMovimientoTelaColor,
  consultarExistenciasTelaColor,
  kardexTelaColor,
  listarPartidasTela,
  registrarSalidaTelaColorAOrden,
  traspasarTelaColor,
} from '../../dominio/inventarios/partidas-telas.js';

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

  // ═══ INVENTARIO NUEVO POR COLOR (etapa A2 — partidas + tela×color) ═══════════

  // ── Ajuste por color (conteo físico / arranque desde cero; entrada crea partidas) ──
  app.route({
    method: 'POST',
    url: '/inventarios/telas/color/ajustes',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Registrar un ajuste de tela por color (una entrada crea la partida por renglón; una salida valida ambos componentes)',
      security: SEGURIDAD_SESION,
      body: esquemaAjusteTelaColorCrear,
      response: { 201: esquemaMovimientoTelaColorSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const movimiento = await ajustarInventarioTelaColor(sesion, request.body);
      return reply.code(201).send(movimiento);
    },
  });

  // ── Salida por color a una orden de producción (sin partida — empareja por color) ──
  app.route({
    method: 'POST',
    url: '/inventarios/telas/color/salidas-orden',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Registrar una salida de tela por color ligada a una orden (cuerpo y complemento juntos; sin partida)',
      security: SEGURIDAD_SESION,
      body: esquemaSalidaTelaColorCrear,
      response: { 201: esquemaMovimientoTelaColorSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const movimiento = await registrarSalidaTelaColorAOrden(sesion, request.body);
      return reply.code(201).send(movimiento);
    },
  });

  // ── Traspaso por color entre almacenes (dos patas, ambas cantidades) ─────────
  app.route({
    method: 'POST',
    url: '/inventarios/telas/color/traspasos',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Traspasar tela por color entre almacenes (salida del origen + entrada al destino)',
      security: SEGURIDAD_SESION,
      body: esquemaTraspasoTelaColorCrear,
      response: { 201: esquemaTraspasoTelaColorSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const traspaso = await traspasarTelaColor(sesion, request.body);
      return reply.code(201).send(traspaso);
    },
  });

  // ── Cancelar un movimiento por color (inverso auditado, D3) ──────────────────
  app.route({
    method: 'POST',
    url: '/inventarios/telas/color/movimientos/:id/cancelar',
    preHandler: app.conPermiso('inventario-telas.mover'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Cancelar un movimiento de tela por color (genera el inverso auditado; no edita ni borra)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdMaterial,
      body: esquemaMovimientoMaterialCancelarCuerpo,
      response: { 200: esquemaMovimientoTelaColorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarMovimientoTelaColor(sesion, request.params.id, request.body);
    },
  });

  // ── Existencias por color (vista existencia_tela_color, agrupadas tela → colores) ──
  app.route({
    method: 'GET',
    url: '/inventarios/telas/color/existencias',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Existencias de tela por color, agrupadas tela padre → colores (cuerpo y complemento)',
      security: SEGURIDAD_SESION,
      querystring: esquemaExistenciasTelaColorQuery,
      response: { 200: esquemaExistenciasTelaColorLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return consultarExistenciasTelaColor(sesion, request.query);
    },
  });

  // ── Kardex por color (saldo corrido de ambos componentes) ────────────────────
  app.route({
    method: 'GET',
    url: '/inventarios/telas/color/kardex',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary:
        'Kardex de un color de tela (movimientos cronológicos con saldo corrido de cuerpo y complemento)',
      security: SEGURIDAD_SESION,
      querystring: esquemaKardexTelaColorQuery,
      response: { 200: esquemaKardexTelaColorLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return kardexTelaColor(sesion, request.query);
    },
  });

  // ── Búsqueda de partidas (folio / lote del proveedor / factura) ──────────────
  app.route({
    method: 'GET',
    url: '/inventarios/telas/partidas',
    preHandler: app.conPermiso('inventario-telas.ver'),
    schema: {
      tags: ['inventario-telas'],
      summary: 'Buscar partidas de tela por folio, lote del proveedor o factura',
      security: SEGURIDAD_SESION,
      querystring: esquemaPartidasTelaQuery,
      response: { 200: esquemaPartidasTelaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarPartidasTela(sesion, request.query);
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
