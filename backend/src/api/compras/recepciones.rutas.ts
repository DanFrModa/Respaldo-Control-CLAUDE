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
 *  • `GET  /compras/ordenes-recibibles`                  — OC ABIERTAS de un proveedor (§Post-F9.87):
 *    el punto de partida de la recepción (el número de OC queda de atajo) (200).
 *  • `GET  /ordenes-compra/:idOrdenCompra/recepciones`   — historial de recepciones de la OC (200).
 *  • `GET  /ordenes-compra/:idOrdenCompra/lineas-pendientes` — pendiente por recibir de cada
 *    renglón de la OC (200): lo que precarga la captura de la recepción.
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
  lineasPendientesDeOC,
  lineasTelaPendientesDeProveedor,
  listarRecepcionesDeOC,
  obtenerRecepcionCompra,
  ocsRecibibles,
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
                pendiente: z
                  .number()
                  .describe('Lo que falta del CUERPO (0 dentro de la banda del 5%, §Post-F9.19).'),
                precio: z.number().describe('Precio unitario de la OC.'),
                nombreComplemento: z
                  .string()
                  .nullable()
                  .describe('Cómo se llama el complemento de la tela ("Cardigan"), o null.'),
                cantidadComplemento: z
                  .number()
                  .nullable()
                  .describe('Complemento que pidió la OC, o null si no lleva.'),
                recibidoComplemento: z.number().describe('Complemento ya recibido.'),
                pendienteComplemento: z.number().describe('Complemento que falta por recibir.'),
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

  // OC ABIERTAS de un proveedor (§Post-F9.87): el punto de partida de la recepción. Quien llega al
  // almacén es el PROVEEDOR — el número de OC es lo que hay que averiguar, no lo que se sabe. El
  // `numCompra` queda de ATAJO para quien ya lo trae en la remisión. Permiso `compras.ver`.
  app.route({
    method: 'GET',
    url: '/compras/ordenes-recibibles',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Órdenes de compra abiertas para recibir, por proveedor',
      security: SEGURIDAD_SESION,
      querystring: z.object({
        idProveedor: z.coerce
          .number({ error: 'El proveedor debe ser un número' })
          .int()
          .positive()
          .optional()
          .describe('Proveedor que llegó a entregar (el camino por omisión).'),
        numCompra: z.coerce
          .number({ error: 'El número de OC debe ser un número' })
          .int()
          .positive()
          .optional()
          .describe('ATAJO: número exacto de la OC, el que viene en la remisión.'),
        limite: z.coerce
          .number({ error: 'El límite debe ser un número' })
          .int()
          .positive()
          .max(200)
          .optional()
          .describe('Cuántas OC devolver como máximo (default 50).'),
      }),
      response: {
        200: z
          .object({
            datos: z.array(
              z.object({
                id: z.number().int(),
                numCompra: z.number().int().describe('Folio de la orden de compra.'),
                fecha: z.string().nullable().describe('Fecha de emisión (YYYY-MM-DD).'),
                fechaEntrega: z
                  .string()
                  .nullable()
                  .describe('Fecha comprometida de entrega (YYYY-MM-DD).'),
                estatus: z.enum(['autorizada', 'recibida_parcial']),
                idProveedor: z.number().int(),
                proveedor: z.string(),
                renglones: z.number().int().describe('Renglones que tiene la OC en total.'),
                renglonesPendientes: z
                  .number()
                  .int()
                  .describe('Renglones a los que todavía les falta material.'),
                materialesPendientes: z
                  .array(z.string())
                  .describe('Hasta 3 materiales pendientes, para reconocer la OC de un vistazo.'),
                materialesPendientesMas: z
                  .number()
                  .int()
                  .describe('Cuántos materiales pendientes MÁS hay además de los nombrados.'),
              }),
            ),
            total: z
              .number()
              .int()
              .describe('Cuántas OC abiertas cumplen el filtro EN TOTAL (no solo las devueltas).'),
            truncado: z
              .boolean()
              .describe(
                '¿Se recortó la lista? La pantalla DEBE decirlo (nada de topes silenciosos).',
              ),
            limite: z.number().int().describe('Tope efectivo aplicado.'),
          })
          .describe('OC abiertas para recibir, con lo que trae pendiente cada una.'),
        ...respuestasError,
      },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return ocsRecibibles(sesion, {
        ...(request.query.idProveedor === undefined
          ? {}
          : { idProveedor: request.query.idProveedor }),
        ...(request.query.numCompra === undefined ? {} : { numCompra: request.query.numCompra }),
        ...(request.query.limite === undefined ? {} : { limite: request.query.limite }),
      });
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

  // Pendiente por recibir de CADA renglón de una OC: la captura de la recepción precarga lo que
  // FALTA (no lo pedido completo) y muestra lo ya recibido. El cálculo lo hace el dominio (A1).
  app.route({
    method: 'GET',
    url: '/ordenes-compra/:idOrdenCompra/lineas-pendientes',
    preHandler: app.conPermiso('compras.ver'),
    schema: {
      tags: ['compras'],
      summary: 'Pendiente por recibir de cada renglón de una orden de compra',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdOC,
      response: {
        200: z
          .object({
            datos: z.array(
              z.object({
                idOrdenCompraLinea: z.number().int(),
                tipo: z.enum(['tela', 'avio', 'libre']).describe('Tipo del renglón de la OC.'),
                cantidad: z.number().describe('Cantidad pedida en la OC.'),
                recibido: z.number().describe('Ya recibido (recepciones activas).'),
                pendiente: z
                  .number()
                  .describe('Lo que falta del CUERPO (0 dentro de la banda, §Post-F9.19).'),
                cantidadComplemento: z
                  .number()
                  .nullable()
                  .describe('Complemento que pidió la OC, o null si no lleva.'),
                recibidoComplemento: z.number().describe('Complemento ya recibido.'),
                pendienteComplemento: z.number().describe('Complemento que falta por recibir.'),
                surtido: z.boolean().describe('¿El renglón ya quedó surtido?'),
              }),
            ),
          })
          .describe('Pendiente por recibir de los renglones de la OC.'),
        ...respuestasError,
      },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await lineasPendientesDeOC(sesion, request.params.idOrdenCompra);
      return { datos };
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
