/**
 * Rutas REST de la RECETA CONGELADA DE LA ORDEN (V1-E3d pieza B, §Post-F9.43). Cada handler solo
 * (A1) valida la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`, autoriza server-side
 * con `app.conPermiso(...)` y delega en `dominio/produccion/receta-orden.ts`.
 *
 * Permisos: `ordenes.ver` para LEER; **`desarrollo.administrar` (permiso REUSADO, cero permisos
 * nuevos → este deploy no requiere `SEED_ON_START`) para tocar y liberar** — es la responsabilidad
 * que Daniel puso en Desarrollo: *"El departamento de desarrollo es el responsable de dejar la OP
 * con la información correcta que se tiene que comprar"*.
 *
 * Endpoints:
 *  • `GET    /ordenes/:id/receta`                              — la receta + la desalineación al vuelo
 *  • `POST   /ordenes/:id/receta/renglones`                    — agregar (cuerpo discriminado por tipo)
 *  • `PATCH  /ordenes/:id/receta/renglones/:tipo/:idRenglon`   — editar (deja el renglón `ajustado`)
 *  • `DELETE /ordenes/:id/receta/renglones/:tipo/:idRenglon`   — quitar (excluye, o borra si era manual)
 *  • `POST   /ordenes/:id/receta/renglones/:tipo/:idRenglon/restaurar` — volver al BOM del modelo
 *  • `POST   /ordenes/:id/receta/revisar`                      — marcar TODO revisado (un solo clic)
 *  • `POST   /ordenes/:id/receta/liberar`                      — abrir la puerta de compra
 *
 * Las siete devuelven la receta COMPLETA para que la pantalla no tenga que re-consultar.
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasRecetaOrden, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaRecetaAgregarCuerpo,
  esquemaRecetaEditarCuerpo,
  esquemaRecetaOrden,
  esquemaRecetaQuitarCuerpo,
  esquemaTipoRenglonReceta,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  agregarRenglonReceta,
  editarRenglonReceta,
  liberarReceta,
  marcarRecetaRevisada,
  obtenerRecetaOrden,
  quitarRenglonReceta,
  restaurarRenglonReceta,
} from '../../dominio/produccion/receta-orden.js';

/** Parámetro `:id` (orden). */
const esquemaParamOrden = z.object({
  id: z.coerce
    .number({ error: 'El id de la orden debe ser un número' })
    .int({ error: 'El id de la orden debe ser entero' })
    .positive({ error: 'El id de la orden debe ser positivo' })
    .describe('Id de la orden.'),
});

/** Parámetros `:id/:tipo/:idRenglon` de un renglón de la receta. */
const esquemaParamRenglon = esquemaParamOrden.extend({
  tipo: esquemaTipoRenglonReceta,
  idRenglon: z.coerce
    .number({ error: 'El id del renglón debe ser un número' })
    .int({ error: 'El id del renglón debe ser entero' })
    .positive({ error: 'El id del renglón debe ser positivo' })
    .describe('Id del renglón de la receta.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de la receta de la orden (montadas bajo `/api`). */
export const rutasRecetaOrden: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  app.route({
    method: 'GET',
    url: '/ordenes/:id/receta',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Receta congelada de una orden (con la desalineación contra el BOM del modelo)',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrden,
      response: { 200: esquemaRecetaOrden, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerRecetaOrden(sesion, request.params.id);
    },
  });

  app.route({
    method: 'POST',
    url: '/ordenes/:id/receta/renglones',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Agregar un renglón a la receta de la orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrden,
      body: esquemaRecetaAgregarCuerpo,
      response: { 200: esquemaRecetaOrden, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return agregarRenglonReceta(sesion, request.params.id, request.body);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/ordenes/:id/receta/renglones/:tipo/:idRenglon',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Editar un renglón de la receta (queda marcado como ajustado)',
      security: SEGURIDAD_SESION,
      params: esquemaParamRenglon,
      body: esquemaRecetaEditarCuerpo,
      response: { 200: esquemaRecetaOrden, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return editarRenglonReceta(
        sesion,
        request.params.id,
        request.params.tipo,
        request.params.idRenglon,
        request.body,
      );
    },
  });

  app.route({
    method: 'DELETE',
    url: '/ordenes/:id/receta/renglones/:tipo/:idRenglon',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Quitar un renglón de la receta de ESTA orden (el caso de la jareta)',
      security: SEGURIDAD_SESION,
      params: esquemaParamRenglon,
      body: esquemaRecetaQuitarCuerpo.optional(),
      response: { 200: esquemaRecetaOrden, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return quitarRenglonReceta(
        sesion,
        request.params.id,
        request.params.tipo,
        request.params.idRenglon,
        request.body ?? {},
      );
    },
  });

  app.route({
    method: 'POST',
    url: '/ordenes/:id/receta/renglones/:tipo/:idRenglon/restaurar',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Restaurar un renglón al valor que trae hoy el BOM del modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamRenglon,
      response: { 200: esquemaRecetaOrden, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return restaurarRenglonReceta(
        sesion,
        request.params.id,
        request.params.tipo,
        request.params.idRenglon,
      );
    },
  });

  app.route({
    method: 'POST',
    url: '/ordenes/:id/receta/revisar',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Marcar TODA la receta como revisada (un solo clic)',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrden,
      response: { 200: esquemaRecetaOrden, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return marcarRecetaRevisada(sesion, request.params.id);
    },
  });

  app.route({
    method: 'POST',
    url: '/ordenes/:id/receta/liberar',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Liberar la receta: abre la puerta al MRP y a las órdenes de compra',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrden,
      response: { 200: esquemaRecetaOrden, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return liberarReceta(sesion, request.params.id);
    },
  });

  done();
};
