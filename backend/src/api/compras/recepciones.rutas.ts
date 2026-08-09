/**
 * Rutas REST de la RECEPCIÓN de compras (F4-E3; doc `Documentacion_MJD/03-Produccion.md` §OC; R7).
 * Calca el ESTÁNDAR de las rutas de Órdenes de compra: cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `compras.ver` para leer; `compras.recibir` para recibir y reversar.
 *  3. **Delega** a los servicios de dominio (`dominio/compras/recepciones.ts`).
 *
 * Endpoints (montados bajo `/api`):
 *  • `POST /ordenes-compra/:idOrdenCompra/recepciones`   — recibir (parcial o total) → **201** con la
 *    recepción creada.
 *  • `GET  /ordenes-compra/:idOrdenCompra/recepciones`   — historial de recepciones de la OC (200).
 *  • `GET  /recepciones-compra/:id`                       — obtener una recepción (200).
 *  • `POST /recepciones-compra/:id/reversar`             — reverso suave, motivo obligatorio (200).
 *
 * CERO lógica de negocio o acceso a datos aquí; los errores de dominio los traduce el error
 * handler global (`src/api/errores.ts`). La decisión (b) (solo se recibe contra una OC
 * autorizada/recibida_parcial) la refuerza el dominio, server-side.
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasRecepcionesCompra, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaRecepcionCrear,
  esquemaRecepcionReversarCuerpo,
  esquemaRecepcionSalida,
  esquemaRecepcionesLista,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  lineasTelaPendientesDeProveedor,
  listarRecepcionesDeOC,
  obtenerRecepcionCompra,
  recibirCompra,
  reversarRecepcion,
} from '../../dominio/compras/recepciones.js';

/** Parámetro de ruta `:idOrdenCompra`. */
const esquemaParamIdOC = z.object({
  idOrdenCompra: z.coerce
    .number({ error: 'El id de la orden de compra debe ser un número' })
    .int({ error: 'El id de la orden de compra debe ser entero' })
    .positive({ error: 'El id de la orden de compra debe ser positivo' })
    .describe('Id de la orden de compra.'),
});

/** Parámetro de ruta `:id` (recepción). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la recepción debe ser un número' })
    .int({ error: 'El id de la recepción debe ser entero' })
    .positive({ error: 'El id de la recepción debe ser positivo' })
    .describe('Id de la recepción de compra.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de recepciones de compra (montadas bajo `/api`). */
export const rutasRecepcionesCompra: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Recibir material contra una OC (parcial o total). Permiso PROPIO `compras.recibir`.
  app.route({
    method: 'POST',
    url: '/ordenes-compra/:idOrdenCompra/recepciones',
    preHandler: app.conPermiso('compras.recibir'),
    schema: {
      tags: ['compras'],
      summary: 'Recibir material contra una orden de compra (recepción)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdOC,
      body: esquemaRecepcionCrear,
      response: { 201: esquemaRecepcionSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      // El id de la OC viene en la URL; el cuerpo lo trae también (esquema compartido). La URL
      // manda: se sella en el cuerpo para que no se pueda recibir contra otra OC por el body.
      const recepcion = await recibirCompra(sesion, {
        ...request.body,
        idOrdenCompra: request.params.idOrdenCompra,
      });
      return reply.code(201).send(recepcion);
    },
  });

  // Renglones de TELA pendientes de recibir de las OCs abiertas de un proveedor (§Post-F9.14):
  // alimenta el selector "¿qué renglón de OC surte este renglón?" de la captura de la factura.
  app.route({
    method: 'GET',
    url: '/compras/lineas-tela-pendientes',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Renglones de tela pendientes de recibir, por proveedor',
      security: SEGURIDAD_SESION,
      querystring: z.object({
        idProveedor: z.coerce
          .number({ error: 'El proveedor debe ser un número' })
          .int()
          .positive()
          .describe('Proveedor cuyas órdenes de compra abiertas se consultan.'),
        idOrdenCompra: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe('Acota a UNA orden de compra (la entrada de tela arranca desde ella).'),
      }),
      response: {
        200: z
          .object({
            datos: z.array(
              z.object({
                idOrdenCompraLinea: z.number().int(),
                idOrdenCompra: z.number().int(),
                numCompra: z.number().int().describe('Folio de la orden de compra.'),
                idTela: z.number().int(),
                tela: z.string(),
                unidad: z.string().nullable(),
                cantidad: z.number().describe('Cantidad pedida en la OC.'),
                recibido: z.number().describe('Ya recibido (recepciones activas).'),
                pendiente: z.number().describe('Lo que falta por recibir.'),
                precio: z.number().describe('Precio unitario de la OC.'),
              }),
            ),
          })
          .describe('Renglones de tela con pendiente por recibir.'),
        ...respuestasError,
      },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await lineasTelaPendientesDeProveedor(
        sesion,
        request.query.idProveedor,
        request.query.idOrdenCompra,
      );
      return { datos };
    },
  });

  // Historial de recepciones de una OC (orden cronológico). Permiso `compras.ver`.
  app.route({
    method: 'GET',
    url: '/ordenes-compra/:idOrdenCompra/recepciones',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Listar las recepciones de una orden de compra',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdOC,
      response: { 200: esquemaRecepcionesLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarRecepcionesDeOC(sesion, request.params.idOrdenCompra);
    },
  });

  // Obtener una recepción por id. Permiso `compras.ver`.
  app.route({
    method: 'GET',
    url: '/recepciones-compra/:id',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Obtener una recepción de compra',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaRecepcionSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerRecepcionCompra(sesion, request.params.id);
    },
  });

  // Reversar una recepción (reverso suave; motivo obligatorio). Permiso PROPIO `compras.recibir`.
  app.route({
    method: 'POST',
    url: '/recepciones-compra/:id/reversar',
    preHandler: app.conPermiso('compras.recibir'),
    schema: {
      tags: ['compras'],
      summary: 'Reversar una recepción de compra (inverso auditado, motivo obligatorio)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaRecepcionReversarCuerpo,
      response: { 200: esquemaRecepcionSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return reversarRecepcion(sesion, request.params.id, request.body);
    },
  });

  done();
};
