/**
 * Rutas REST de los MOVIMIENTOS planos de EsMa — ABONOS y DESCUENTOS (F6-E4). Handlers DELGADOS (A1):
 * validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan al dominio `dominio/esma/movimientos`.
 *
 * Endpoints (por la empresa activa = A9):
 *  • `POST /esma/abonos`                    (perm `esma.modificar`)  → captura un abono.
 *  • `POST /esma/descuentos`                (perm `esma.modificar`)  → captura un descuento.
 *  • `GET  /esma/maquileros/:id/abonos`     (perm `esma.ver-pagos`)  → abonos del maquilero (importes ocultables).
 *  • `GET  /esma/maquileros/:id/descuentos` (perm `esma.ver-pagos`)  → descuentos del maquilero.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaAbonoCrear,
  esquemaDescuentoCrear,
  esquemaMovimientoEsMaSalida,
  esquemaMovimientosEsMaLista,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  crearAbonoMaquilero,
  crearDescuentoMaquilero,
  listarAbonosMaquilero,
  listarDescuentosMaquilero,
} from '../../dominio/esma/movimientos.js';

/** Parámetro de ruta `:id` (id de maquilero). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del maquilero (Proveedor).'),
});

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de abonos/descuentos EsMa (montadas bajo `/api`). */
export const rutasMovimientosEsMa: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Abonos ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/esma/abonos',
    preHandler: app.conPermiso('esma.modificar'),
    schema: {
      tags: ['esma'],
      summary: 'Capturar un abono a la cuenta de un maquilero',
      security: SEGURIDAD_SESION,
      body: esquemaAbonoCrear,
      response: { 201: esquemaMovimientoEsMaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const abono = await crearAbonoMaquilero(sesion, request.body);
      return reply.code(201).send(abono);
    },
  });

  app.route({
    method: 'GET',
    url: '/esma/maquileros/:id/abonos',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Abonos de un maquilero (importes ocultos sin consultas.ver-importes)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaMovimientosEsMaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarAbonosMaquilero(sesion, request.params.id);
    },
  });

  // ── Descuentos ────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/esma/descuentos',
    preHandler: app.conPermiso('esma.modificar'),
    schema: {
      tags: ['esma'],
      summary: 'Capturar un descuento a la cuenta de un maquilero',
      security: SEGURIDAD_SESION,
      body: esquemaDescuentoCrear,
      response: { 201: esquemaMovimientoEsMaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const descuento = await crearDescuentoMaquilero(sesion, request.body);
      return reply.code(201).send(descuento);
    },
  });

  app.route({
    method: 'GET',
    url: '/esma/maquileros/:id/descuentos',
    preHandler: app.conPermiso('esma.ver-pagos'),
    schema: {
      tags: ['esma'],
      summary: 'Descuentos de un maquilero (importes ocultos sin consultas.ver-importes)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaMovimientosEsMaLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarDescuentosMaquilero(sesion, request.params.id);
    },
  });

  done();
};
