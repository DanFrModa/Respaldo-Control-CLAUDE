/**
 * Rutas REST del IMPRESO de la orden de producción (F2-E4, R9). La hoja (PDF) de PISO DE
 * PRODUCCIÓN que se le da al maquilero/corte para producir una orden. Calca el ESTÁNDAR de
 * `ordenes.rutas.ts`: cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod compartidos de `src/contrato` (params/cuerpo).
 *  2. **Autoriza** server-side con `app.conPermiso('ordenes.ver')` (deny-by-default, §9.2).
 *  3. **Delega** al dominio (`dominio/produccion/impresos/impreso-orden.ts`), que arma el Buffer PDF.
 *
 * Endpoints (ambos `ordenes.ver`, ambos por la empresa activa de la sesión = A9; si una orden no es
 * de la empresa activa → 404):
 *  • `GET  /ordenes/:id/impreso` → `application/pdf` (Buffer). `Content-Disposition: inline;
 *    filename="orden-<folio>.pdf"`.
 *  • `POST /ordenes/impresos`    → cuerpo `{ ids: number[] }` (1..100). UN solo PDF consolidado, una
 *    orden por página. `Content-Disposition: inline; filename="ordenes.pdf"`.
 *
 * La respuesta es BINARIA (no JSON): no se declara `response` 200 en el esquema (Fastify envía el
 * Buffer tal cual). Los errores de dominio los traduce el error handler global (`src/api/errores.ts`).
 *
 * NOTA DE INTEGRACIÓN: este plugin lo registra la Pieza B en `app.ts`
 * (`await app.register(rutasImpresosOrden, { prefix: '/api' })`); aquí NO se registra ni se regenera
 * el OpenAPI.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi, esquemaOrdenesImpresoCuerpo } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { impresoOrden, impresoOrdenes } from '../../dominio/produccion/impresos/impreso-orden.js';

/** Parámetro de ruta `:id` (orden). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la orden debe ser un número' })
    .int({ error: 'El id de la orden debe ser entero' })
    .positive({ error: 'El id de la orden debe ser positivo' })
    .describe('Id de la orden.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del impreso de órdenes (montadas bajo `/api`). */
export const rutasImpresosOrden: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Impreso de UNA orden (PDF, una página).
  app.route({
    method: 'GET',
    url: '/ordenes/:id/impreso',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Imprimir una orden de producción (PDF de piso de producción)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      // La respuesta 200 es binaria (application/pdf); solo se documentan los errores.
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer, folio } = await impresoOrden(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="orden-${folio}.pdf"`);
      // La respuesta es binaria (no JSON): Fastify envía el Buffer tal cual. El tipo del `send` lo
      // infiere el type-provider de las respuestas DECLARADAS (solo errores), por eso el cast.
      return reply.send(buffer as unknown as never);
    },
  });

  // Impreso por LOTE: un solo PDF consolidado (una orden por página).
  app.route({
    method: 'POST',
    url: '/ordenes/impresos',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Imprimir varias órdenes en un solo PDF (una por página)',
      security: SEGURIDAD_SESION,
      body: esquemaOrdenesImpresoCuerpo,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const buffer = await impresoOrdenes(sesion, request.body.ids);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'inline; filename="ordenes.pdf"');
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
