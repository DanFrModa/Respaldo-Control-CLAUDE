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
 *  • `POST   /ordenes/:id/receta/liberar`                      — firmar (todo, una sección o una selección)
 *  • `POST   /ordenes/:id/receta/traer-del-modelo`             — traer lo que le falta (§Post-F9.73)
 *  • `GET    /recetas-por-liberar`                             — la BANDEJA de Desarrollo (§Post-F9.72)
 *
 * Las de mutación devuelven la receta COMPLETA para que la pantalla no tenga que re-consultar
 * («traer del modelo» la devuelve junto con el resumen de qué se trajo y qué se respetó).
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasRecetaOrden, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaLiberarRecetaCuerpo,
  esquemaRecetaAgregarCuerpo,
  esquemaRecetaEditarCuerpo,
  esquemaRecetaOrden,
  esquemaRecetaQuitarCuerpo,
  esquemaRecetasPorLiberarPagina,
  esquemaRecetasPorLiberarQuery,
  esquemaTipoRenglonReceta,
  esquemaTraerDelModeloCuerpo,
  esquemaTraerDelModeloResultado,
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
  traerDelModelo,
} from '../../dominio/produccion/receta-orden.js';
import { consultarRecetasPorLiberar } from '../../dominio/produccion/recetas-por-liberar.js';

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
    // ⭐ V1-E3j — `ordenes.ver` O `desarrollo.ver`. La receta tiene PANTALLA PROPIA, gobernada por
    // `desarrollo.ver` (§Post-F9.72: firmar materiales no puede exigir permiso sobre la OP entera).
    // Con el guard viejo, un usuario de Desarrollo puro podía FIRMAR la receta (las 7 mutaciones ya
    // son `desarrollo.administrar`) pero no LEERLA. El dominio reaplica la misma regla (A1).
    preHandler: app.conAlgunPermiso('ordenes.ver', 'desarrollo.ver'),
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
      summary: 'Liberar la receta — entera, por sección o renglón por renglón (§Post-F9.72)',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrden,
      body: esquemaLiberarRecetaCuerpo.optional(),
      response: { 200: esquemaRecetaOrden, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return liberarReceta(sesion, request.params.id, request.body ?? {});
    },
  });

  // ⭐ §Post-F9.73 — «traer del modelo» lo que le falta a la receta. Mismo permiso que FIRMAR
  // (`desarrollo.administrar`), y a propósito: Daniel puso las dos manos en el mismo equipo
  // (*"si desarrollo es quien libera la receta, debe seguir haciéndolo con lo que falte"*).
  // Compras EXPLOTA, no captura.
  app.route({
    method: 'POST',
    url: '/ordenes/:id/receta/traer-del-modelo',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Traer del modelo lo que le falta a la receta (nace SIN liberar)',
      security: SEGURIDAD_SESION,
      params: esquemaParamOrden,
      body: esquemaTraerDelModeloCuerpo.optional(),
      response: { 200: esquemaTraerDelModeloResultado, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return traerDelModelo(sesion, request.params.id, request.body ?? {});
    },
  });

  // ⭐ §Post-F9.72 — LA BANDEJA de Desarrollo. `desarrollo.ver` para verla; liberar desde ahí pasa
  // por el endpoint de liberar, que exige `desarrollo.administrar`. No cuelga de `/ordenes/:id`
  // porque no es de UNA orden: es la cartera entera.
  app.route({
    method: 'GET',
    url: '/recetas-por-liberar',
    preHandler: app.conPermiso('desarrollo.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Bandeja «Recetas por liberar»: órdenes con receta pendiente de firma',
      security: SEGURIDAD_SESION,
      querystring: esquemaRecetasPorLiberarQuery,
      response: { 200: esquemaRecetasPorLiberarPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return consultarRecetasPorLiberar(sesion, request.query);
    },
  });

  done();
};
