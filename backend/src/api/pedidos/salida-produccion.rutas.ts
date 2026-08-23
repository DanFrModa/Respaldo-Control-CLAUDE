/**
 * Rutas REST del FLUJO NUEVO de pedidos (rediseño R3, B4/B6 — proto §4.1): la consulta de pedidos
 * POR MES (la pantalla nueva), los CANDIDATOS de desarrollo del constructor y la SALIDA A
 * PRODUCCIÓN ("Generar OP") de un renglón. Handlers delgados (A1): validan (Zod compartido),
 * autorizan (`conPermiso`, A4) y delegan al dominio. RBAC por ruta: consulta → `pedidos.ver`;
 * candidatos → `pedidos.administrar` (sirven a la captura); generar OP → `ordenes.administrar`
 * (el MISMO permiso con que hoy nacen órdenes — sin permisos nuevos).
 *
 * Se registra en `app.ts`. Las rutas estáticas `/pedidos/por-mes` y `/pedidos/candidatos-desarrollo`
 * tienen prioridad sobre la paramétrica `/pedidos/:id` (find-my-way resuelve estáticas primero).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaCandidatosDesarrolloQuery,
  esquemaCandidatosDesarrolloSalida,
  esquemaErrorApi,
  esquemaPedidosPorMesQuery,
  esquemaPedidosPorMesSalida,
  esquemaSalidaProduccionCuerpo,
  esquemaSalidaProduccionSalida,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { candidatosDesarrollo } from '../../dominio/pedidos/candidatos-desarrollo.js';
import { pedidosPorMes } from '../../dominio/pedidos/consulta-mes.js';
import { salidaAProduccion } from '../../dominio/produccion/salida-produccion.js';

/** Parámetro de ruta `:idLinea` (renglón del pedido). */
const esquemaParamIdLinea = z.object({
  idLinea: z.coerce
    .number({ error: 'El id del renglón debe ser un número' })
    .int({ error: 'El id del renglón debe ser entero' })
    .positive({ error: 'El id del renglón debe ser positivo' })
    .describe('Id del renglón del pedido (PedidoLinea).'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del flujo nuevo de pedidos (montadas bajo `/api`). */
export const rutasSalidaProduccion: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Consulta de pedidos por mes (la pantalla nueva de Pedidos, §4.1) ─────────
  app.route({
    method: 'GET',
    url: '/pedidos/por-mes',
    preHandler: app.conPermiso('pedidos.ver'),
    schema: {
      tags: ['pedidos'],
      summary: 'Consulta de pedidos por mes (agrupada pedido → renglones, con totales)',
      security: SEGURIDAD_SESION,
      querystring: esquemaPedidosPorMesQuery,
      response: { 200: esquemaPedidosPorMesSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return pedidosPorMes(sesion, request.query);
    },
  });

  // ── Candidatos de desarrollo para el selector del constructor ────────────────
  app.route({
    method: 'GET',
    url: '/pedidos/candidatos-desarrollo',
    preHandler: app.conPermiso('pedidos.administrar'),
    schema: {
      tags: ['pedidos'],
      summary: 'Desarrollos candidatos para un renglón del pedido (búsqueda sin acentos)',
      security: SEGURIDAD_SESION,
      querystring: esquemaCandidatosDesarrolloQuery,
      response: { 200: esquemaCandidatosDesarrolloSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await candidatosDesarrollo(sesion, request.query);
      return { datos };
    },
  });

  // ── Generar OP = salida a producción de un renglón (B4) ──────────────────────
  app.route({
    method: 'POST',
    url: '/pedidos/lineas/:idLinea/salida-produccion',
    preHandler: app.conPermiso('ordenes.administrar'),
    schema: {
      tags: ['pedidos'],
      summary:
        'Generar la OP de un renglón (salida a producción: matriz + liga al desarrollo + nº de producción + RC automática)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdLinea,
      body: esquemaSalidaProduccionCuerpo,
      response: { 201: esquemaSalidaProduccionSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const resultado = await salidaAProduccion(sesion, request.params.idLinea, request.body);
      return reply.code(201).send(resultado);
    },
  });

  done();
};
