/**
 * Rutas REST de las FOTOS DEL ARTE **POR ORDEN** (§Post-F9.177). Handlers delgados (A1): validan
 * (Zod compartido), autorizan (A4) y delegan en `dominio/produccion/fotos-arte-orden`. CERO lógica
 * de negocio aquí.
 *
 * PERMISOS — reusados, NINGUNO nuevo ⇒ este deploy **no** requiere `SEED_ON_START`. Son los que ya
 * gobiernan la receta de la OP, que es donde vive el arte:
 *  • leer  → `ordenes.ver` **o** `desarrollo.ver` (`conAlgunPermiso`, igual que `GET .../receta`).
 *  • mutar → `desarrollo.administrar` (§Post-F9.72: ahí bajaron las siete mutaciones de la receta).
 * ⚠️ **No `ordenes.administrar`**: reabriría el agujero de V1-E3j (quien puede cambiarle a ESTE
 * renglón la descripción y el precio no podría cambiarle la foto → 403 sobre un botón pintado).
 *
 * ⚠️ Ocultar/mostrar NO tocan R2: ponen y quitan una MARCA. La foto del arte del modelo sigue
 * intacta y otra orden la sigue viendo (D3). Subir/quitar sí tocan R2, pero sólo objetos que
 * nacieron en ESTA orden.
 *
 * Endpoints (bajo `/api`):
 *   `GET    /ordenes/:idOrden/artes/fotos`                                — qué enseña cada renglón.
 *   `POST   /ordenes/:idOrden/artes/:idOrdenArte/fotos-ocultas`           — quitar una heredada.
 *   `DELETE /ordenes/:idOrden/artes/:idOrdenArte/fotos-ocultas/:idModeloArteFoto` — traerla de vuelta.
 *   `POST   /ordenes/:idOrden/artes/:idOrdenArte/fotos`                   — subir una propia (R2).
 *   `DELETE /ordenes/:idOrden/artes/:idOrdenArte/fotos/:idFoto`           — quitar una propia (R2).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaOrdenArteFotoCrear,
  esquemaOrdenArteFotoOcultar,
  esquemaOrdenArteFotoSubida,
  esquemaOrdenArtesConFotosLista,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  listarFotosArteOrden,
  mostrarFotoArteEnOrden,
  ocultarFotoArteEnOrden,
  quitarFotoArteOrden,
  solicitarSubidaFotoArteOrden,
  type ArteOrdenConFotos,
} from '../../dominio/produccion/fotos-arte-orden.js';

/** Un id entero positivo que llega por la URL (llega como texto y se coacciona). */
const idDeRuta = (que: string) =>
  z.coerce
    .number({ error: `El id ${que} debe ser un número` })
    .int({ error: `El id ${que} debe ser entero` })
    .positive({ error: `El id ${que} debe ser positivo` });

/** Parámetro `:idOrden`. */
const esquemaParamIdOrden = z.object({
  idOrden: idDeRuta('de la orden').describe('Id de la orden de producción.'),
});

/** Parámetros `:idOrden` + `:idOrdenArte` (el renglón de arte DE ESA orden). */
const esquemaParamRenglon = esquemaParamIdOrden.extend({
  idOrdenArte: idDeRuta('del arte').describe(
    'Id del renglón de arte de la orden (`OrdenArte.id`).',
  ),
});

/** Parámetros para volver a mostrar una foto heredada. */
const esquemaParamHeredada = esquemaParamRenglon.extend({
  idModeloArteFoto: idDeRuta('de la foto').describe(
    'Id de la foto del arte del MODELO (`ModeloArteFoto.id`).',
  ),
});

/** Parámetros para quitar una foto PROPIA de la orden. */
const esquemaParamPropia = esquemaParamRenglon.extend({
  idFoto: idDeRuta('de la foto').describe('Id de la foto subida a la orden (`OrdenArteFoto.id`).'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Proyecta campo por campo (nada del dominio sale sin pasar por aquí). */
function aLista(artes: ArteOrdenConFotos[]): z.infer<typeof esquemaOrdenArtesConFotosLista> {
  return {
    datos: artes.map((a) => ({
      idOrdenArte: a.idOrdenArte,
      descripcion: a.descripcion,
      agregadoAMano: a.agregadoAMano,
      fotos: a.fotos.map((f) => ({
        origen: f.origen,
        idModeloArteFoto: f.idModeloArteFoto,
        idFoto: f.idFoto,
        urlDescarga: f.urlDescarga,
        nombreOriginal: f.nombreOriginal,
        oculta: f.oculta,
        principal: f.principal,
      })),
    })),
  };
}

/** Registra las rutas de fotos de arte de la orden (montadas bajo `/api`). */
export const rutasFotosArteOrden: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Qué fotos enseña cada renglón de arte de esta orden (heredadas + propias, con las ocultas
  // marcadas para poder traerlas de vuelta).
  app.route({
    method: 'GET',
    url: '/ordenes/:idOrden/artes/fotos',
    // Misma pareja que `GET /ordenes/:id/receta` (V1-E3j): el arte se ve desde la OP y desde la
    // pantalla de la receta, que es de Desarrollo. El dominio reaplica la regla (A1).
    preHandler: app.conAlgunPermiso('ordenes.ver', 'desarrollo.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Fotos del arte que enseña cada renglón de una orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdOrden,
      response: { 200: esquemaOrdenArtesConFotosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aLista(await listarFotosArteOrden(sesion, request.params.idOrden));
    },
  });

  // Quitar de ESTE renglón una foto heredada del arte del modelo (la del modelo NO se toca, D3).
  app.route({
    method: 'POST',
    url: '/ordenes/:idOrden/artes/:idOrdenArte/fotos-ocultas',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Quitar de este renglón una foto heredada del arte del modelo (no la borra)',
      security: SEGURIDAD_SESION,
      params: esquemaParamRenglon,
      body: esquemaOrdenArteFotoOcultar,
      response: {
        200: z
          .object({
            datos: z
              .array(z.number().int())
              .describe('Ids de `ModeloArteFoto` que este renglón ya no enseña.'),
          })
          .describe('Fotos heredadas ocultas en este renglón de arte.'),
        ...respuestasError,
      },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { idOrden, idOrdenArte } = request.params;
      return {
        datos: await ocultarFotoArteEnOrden(sesion, idOrden, idOrdenArte, request.body),
      };
    },
  });

  // Volver a enseñarla en este renglón (reversible siempre).
  app.route({
    method: 'DELETE',
    url: '/ordenes/:idOrden/artes/:idOrdenArte/fotos-ocultas/:idModeloArteFoto',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Volver a enseñar en este renglón una foto heredada que estaba oculta',
      security: SEGURIDAD_SESION,
      params: esquemaParamHeredada,
      response: {
        200: z
          .object({
            datos: z
              .array(z.number().int())
              .describe('Ids de `ModeloArteFoto` que este renglón ya no enseña.'),
          })
          .describe('Fotos heredadas ocultas en este renglón de arte.'),
        ...respuestasError,
      },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { idOrden, idOrdenArte, idModeloArteFoto } = request.params;
      return {
        datos: await mostrarFotoArteEnOrden(sesion, idOrden, idOrdenArte, idModeloArteFoto),
      };
    },
  });

  // Subir una foto PROPIA a este renglón (presigned a R2). Es lo que le da foto al arte agregado a
  // mano, que no hereda de nadie.
  app.route({
    method: 'POST',
    url: '/ordenes/:idOrden/artes/:idOrdenArte/fotos',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Preparar la subida de una foto de arte a este renglón de la orden (R2)',
      security: SEGURIDAD_SESION,
      params: esquemaParamRenglon,
      body: esquemaOrdenArteFotoCrear,
      response: { 200: esquemaOrdenArteFotoSubida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { idOrden, idOrdenArte } = request.params;
      const subida = await solicitarSubidaFotoArteOrden(sesion, idOrden, idOrdenArte, request.body);
      return {
        idFoto: subida.idFoto,
        idArchivo: subida.idArchivo,
        nombreOriginal: subida.nombreOriginal,
        urlSubida: subida.urlSubida,
        expiraEnSegundos: subida.expiraEnSegundos,
      };
    },
  });

  // Quitar una foto PROPIA (ésta sí se borra de verdad: nació en esta orden).
  app.route({
    method: 'DELETE',
    url: '/ordenes/:idOrden/artes/:idOrdenArte/fotos/:idFoto',
    preHandler: app.conPermiso('desarrollo.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Quitar una foto de arte subida a esta orden (borra el archivo y su objeto en R2)',
      security: SEGURIDAD_SESION,
      params: esquemaParamPropia,
      response: { 204: z.null().describe('Foto quitada.'), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { idOrden, idOrdenArte, idFoto } = request.params;
      await quitarFotoArteOrden(sesion, idOrden, idOrdenArte, idFoto);
      return reply.code(204).send(null);
    },
  });

  done();
};
