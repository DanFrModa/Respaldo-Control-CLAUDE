/**
 * Rutas REST del MRP / EXPLOSIÓN de materiales por orden (F4-E4). Calca el ESTÁNDAR de las rutas de
 * Órdenes de compra: cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `compras.ver` para explosionar/consultar estatus (lecturas; la explosión persiste el snapshot
 *     pero es una operación de consulta del usuario), `compras.administrar` para generar OC.
 *  3. **Delega** a los servicios de dominio (`dominio/compras/mrp.ts`).
 *
 * Endpoints (bajo `/api`):
 *   `POST /ordenes/:id/explosion`          — explosiona la orden y persiste/regenera el snapshot (R3).
 *                                            Es POST (tiene efectos: escribe snapshot + bitácora) — NO
 *                                            hay GET equivalente, para no exponer un GET con efectos.
 *   `POST /ordenes/:id/explosion/generar-oc` — genera OC por proveedor desde la explosión (R3).
 *   `GET  /ordenes/:id/estatus-materiales` — tablero "qué tengo / qué falta" (R7).
 *   `GET  /ordenes/:id/explosion/impreso`        — PDF de la explosión (R9, binario).
 *   `GET  /ordenes/:id/estatus-materiales/impreso` — PDF del estatus de recepción (R9, binario).
 *
 * NO crea permisos nuevos (usa los `compras.*` de E2). CERO lógica de negocio aquí.
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasMrp, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaExplosionSalida,
  esquemaGenerarOcCuerpo,
  esquemaGenerarOcResultado,
  esquemaEstatusMaterialesSalida,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  explosionarOrden,
  generarOCDesdeExplosion,
  estatusMaterialesOrden,
} from '../../dominio/compras/mrp.js';
import { impresoExplosion } from '../../dominio/compras/impresos/impreso-explosion.js';
import { impresoEstatusMateriales } from '../../dominio/compras/impresos/impreso-estatus-materiales.js';

/** Parámetro de ruta `:id` (orden de producción). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la orden debe ser un número' })
    .int({ error: 'El id de la orden debe ser entero' })
    .positive({ error: 'El id de la orden debe ser positivo' })
    .describe('Id de la orden de producción.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del MRP (montadas bajo `/api`). */
export const rutasMrp: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Explosionar (regenera y persiste el snapshot; R3).
  app.route({
    method: 'POST',
    url: '/ordenes/:id/explosion',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Explosionar los materiales de una orden (R3) y persistir el snapshot',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaExplosionSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return explosionarOrden(sesion, request.params.id);
    },
  });

  // Generar OC por proveedor desde la explosión (un clic; R3).
  app.route({
    method: 'POST',
    url: '/ordenes/:id/explosion/generar-oc',
    preHandler: app.conPermiso('compras.administrar'),
    schema: {
      tags: ['compras'],
      summary: 'Generar órdenes de compra (una por proveedor) desde la explosión (R3)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaGenerarOcCuerpo,
      response: { 201: esquemaGenerarOcResultado, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const resultado = await generarOCDesdeExplosion(sesion, request.params.id, request.body);
      return reply.code(201).send(resultado);
    },
  });

  // Tablero "qué tengo / qué falta" (R7).
  app.route({
    method: 'GET',
    url: '/ordenes/:id/estatus-materiales',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Tablero de estatus de materiales de una orden (qué tengo / qué falta, R7)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaEstatusMaterialesSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return estatusMaterialesOrden(sesion, request.params.id);
    },
  });

  // Impreso (PDF) de la explosión. Respuesta BINARIA (application/pdf).
  app.route({
    method: 'GET',
    url: '/ordenes/:id/explosion/impreso',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Imprimir la explosión de materiales de una orden (PDF, R9)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folioOrden } = await impresoExplosion(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="explosion-orden-${folioOrden}.pdf"`);
      return reply.send(buffer as unknown as never);
    },
  });

  // Impreso (PDF) del estatus de materiales (recepción). Respuesta BINARIA (application/pdf).
  app.route({
    method: 'GET',
    url: '/ordenes/:id/estatus-materiales/impreso',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Imprimir el estatus de materiales de una orden (PDF, R9)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folioOrden } = await impresoEstatusMateriales(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `inline; filename="estatus-materiales-orden-${folioOrden}.pdf"`,
        );
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
