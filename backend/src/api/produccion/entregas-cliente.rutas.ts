/**
 * Rutas REST de la ENTREGA a cliente (F3-E5: cierre del ciclo de la orden). Handlers DELGADOS (A1):
 * validan (Zod compartido de `src/contrato`), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/produccion/entregas-cliente`. Las reglas de negocio (no-negativo estricto bajo lock,
 * salida de kardex, seguimiento derivado, cancelación con inverso, concurrencia) viven en el dominio.
 *
 * Endpoints (todos por la empresa activa de la sesión = A9; si la orden/entrega no es de la empresa
 * activa → 404):
 *  • `POST /produccion/entregas-cliente`             (perm `produccion.entrega`)  → registra una entrega.
 *  • `POST /produccion/entregas-cliente/:id/cancelar`(perm `produccion.cancelar`) → cancela (suave + inverso).
 *  • `GET  /produccion/ordenes/:id/entregas`         (perm `produccion.wip-ver`)  → historial de entregas.
 *  • `GET  /produccion/ordenes/:id/seguimiento-entrega`(perm `produccion.wip-ver`) → seguimiento derivado.
 *  • `GET  /produccion/entregas-cliente/:id/comprobante`(perm `produccion.entrega`) → comprobante (PDF).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaEntregaClienteCrear,
  esquemaEntregaClienteCancelarCuerpo,
  esquemaEntregaClienteSalida,
  esquemaEntregasOrdenLista,
  esquemaSeguimientoEntregaOrden,
  esquemaSeguimientoEntregaQuery,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  cancelarEntregaCliente,
  listarEntregasOrden,
  registrarEntregaCliente,
  seguimientoEntregaOrden,
} from '../../dominio/produccion/entregas-cliente.js';
import { impresoEntregaCliente } from '../../dominio/produccion/impresos/impreso-entrega-cliente.js';

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

/** Registra las rutas de la entrega a cliente (montadas bajo `/api`). */
export const rutasEntregasCliente: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Entrega ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/produccion/entregas-cliente',
    preHandler: app.conPermiso('produccion.entrega'),
    schema: {
      tags: ['produccion'],
      summary: 'Registrar una entrega a cliente (salida de PT no-negativa; cierra el pedido)',
      security: SEGURIDAD_SESION,
      body: esquemaEntregaClienteCrear,
      response: { 201: esquemaEntregaClienteSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const entrega = await registrarEntregaCliente(sesion, request.body);
      return reply.code(201).send(entrega);
    },
  });

  app.route({
    method: 'POST',
    url: '/produccion/entregas-cliente/:id/cancelar',
    preHandler: app.conPermiso('produccion.cancelar'),
    schema: {
      tags: ['produccion'],
      summary: 'Cancelar (suave + inverso de kardex) una entrega a cliente',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaEntregaClienteCancelarCuerpo,
      response: { 200: esquemaEntregaClienteSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarEntregaCliente(sesion, request.params.id, request.body);
    },
  });

  // ── Consultas ──────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/produccion/ordenes/:id/entregas',
    preHandler: app.conPermiso('produccion.wip-ver'),
    schema: {
      tags: ['produccion'],
      summary: 'Historial de entregas a cliente de una orden (vivas y canceladas)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaEntregasOrdenLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarEntregasOrden(sesion, request.params.id);
    },
  });

  app.route({
    method: 'GET',
    url: '/produccion/ordenes/:id/seguimiento-entrega',
    preHandler: app.conPermiso('produccion.wip-ver'),
    schema: {
      tags: ['produccion'],
      summary: 'Seguimiento derivado de la entrega de una orden (pedido − entregado + disponible)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      querystring: esquemaSeguimientoEntregaQuery,
      response: { 200: esquemaSeguimientoEntregaOrden, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return seguimientoEntregaOrden(sesion, request.params.id, request.query);
    },
  });

  // ── Comprobante (binario application/pdf; solo se documentan los errores) ─────
  app.route({
    method: 'GET',
    url: '/produccion/entregas-cliente/:id/comprobante',
    preHandler: app.conPermiso('produccion.entrega'),
    schema: {
      tags: ['produccion'],
      summary: 'Comprobante de entrega a cliente (PDF)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await impresoEntregaCliente(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="entrega-cliente-${folio}.pdf"`);
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
