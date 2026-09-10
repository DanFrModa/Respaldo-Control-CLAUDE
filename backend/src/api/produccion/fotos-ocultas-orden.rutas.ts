/**
 * Rutas REST de las FOTOS DEL MODELO OCULTAS EN UNA ORDEN (§Post-F9.169(b)). Handlers delgados (A1):
 * validan (Zod compartido), autorizan (`conPermiso`, A4: `ordenes.ver` para listar,
 * `ordenes.administrar` para ocultar/mostrar) y delegan al dominio
 * `dominio/produccion/fotos-ocultas-orden`. CERO lógica de negocio aquí. NO crea permisos nuevos
 * (reusa los `ordenes.*` que ya gobiernan subir/quitar fotos de la OP) ⇒ sin `SEED_ON_START`.
 *
 * ⚠️ Estas rutas NO tocan R2 ni el catálogo del modelo: ponen y quitan una MARCA por
 * *(orden, foto)*. La foto del modelo sigue intacta y otra orden del mismo modelo la sigue viendo.
 *
 * Endpoints (bajo `/api`):
 *   `GET    /ordenes/:idOrden/fotos-ocultas`                — qué fotos del modelo no enseña la OP.
 *   `POST   /ordenes/:idOrden/fotos-ocultas`                — ocultar una foto heredada en esta OP.
 *   `DELETE /ordenes/:idOrden/fotos-ocultas/:idModeloFoto`  — volver a mostrarla en esta OP.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaOrdenFotoOcultar,
  esquemaOrdenFotosOcultasLista,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  listarFotosOcultasOrden,
  mostrarFotoModeloEnOrden,
  ocultarFotoModeloEnOrden,
  type FotoOcultaOrden,
} from '../../dominio/produccion/fotos-ocultas-orden.js';

/** Parámetro de ruta `:idOrden` (orden de producción). */
const esquemaParamIdOrden = z.object({
  idOrden: z.coerce
    .number({ error: 'El id de la orden debe ser un número' })
    .int({ error: 'El id de la orden debe ser entero' })
    .positive({ error: 'El id de la orden debe ser positivo' })
    .describe('Id de la orden de producción.'),
});

/** Parámetros `:idOrden` + `:idModeloFoto` para volver a mostrar una foto. */
const esquemaParamFoto = esquemaParamIdOrden.extend({
  idModeloFoto: z.coerce
    .number({ error: 'El id de la foto debe ser un número' })
    .int({ error: 'El id de la foto debe ser entero' })
    .positive({ error: 'El id de la foto debe ser positivo' })
    .describe('Id de la foto del MODELO (`ModeloFoto.id`).'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Proyecta la lista de fotos ocultas a JSON (Date → ISO 8601). */
function aLista(fotos: FotoOcultaOrden[]): z.infer<typeof esquemaOrdenFotosOcultasLista> {
  return {
    datos: fotos.map((f) => ({
      idModeloFoto: f.idModeloFoto,
      ocultadaEn: f.ocultadaEn.toISOString(),
    })),
  };
}

/** Registra las rutas de fotos ocultas de la orden (montadas bajo `/api`). */
export const rutasFotosOcultasOrden: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Qué fotos del modelo NO enseña esta orden (vacío = las enseña todas).
  app.route({
    method: 'GET',
    url: '/ordenes/:idOrden/fotos-ocultas',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Listar las fotos del modelo ocultas en esta orden',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdOrden,
      response: { 200: esquemaOrdenFotosOcultasLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aLista(await listarFotosOcultasOrden(sesion, request.params.idOrden));
    },
  });

  // Ocultar en esta orden una foto heredada del modelo (la del modelo NO se toca, D3).
  app.route({
    method: 'POST',
    url: '/ordenes/:idOrden/fotos-ocultas',
    preHandler: app.conPermiso('ordenes.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Quitar de esta orden una foto heredada del modelo (no la borra del modelo)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdOrden,
      body: esquemaOrdenFotoOcultar,
      response: { 200: esquemaOrdenFotosOcultasLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aLista(await ocultarFotoModeloEnOrden(sesion, request.params.idOrden, request.body));
    },
  });

  // Volver a mostrar en esta orden una foto que estaba oculta (reversible siempre).
  app.route({
    method: 'DELETE',
    url: '/ordenes/:idOrden/fotos-ocultas/:idModeloFoto',
    preHandler: app.conPermiso('ordenes.administrar'),
    schema: {
      tags: ['ordenes'],
      summary: 'Volver a mostrar en esta orden una foto del modelo que estaba oculta',
      security: SEGURIDAD_SESION,
      params: esquemaParamFoto,
      response: { 200: esquemaOrdenFotosOcultasLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { idOrden, idModeloFoto } = request.params;
      return aLista(await mostrarFotoModeloEnOrden(sesion, idOrden, idModeloFoto));
    },
  });

  done();
};
