/**
 * Rutas REST de Bordados / estampados — catálogo maestro global (F1-E3, R2).
 * Calca el ESTÁNDAR de ruta de Almacenes/Proveedores (`api/.../*.rutas.ts`): cada
 * handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `bordados.ver` para leer, `bordados.administrar` para mutar.
 *  3. **Delega** al servicio de dominio `dominio/catalogos/bordados`.
 *
 * La FOTO se gestiona con el motor de archivos de F0 (presigned PUT/GET) bajo
 * `/bordados/:id/foto`: POST prepara la subida (URL PUT prefirmada), GET devuelve la
 * URL de descarga (o vacío si no hay foto), DELETE la quita (transacción A2) —opcionalmente
 * ACOTADO al `idArchivo` que traiga el querystring, para no llevarse una foto que no es la suya—.
 *
 * CERO lógica de negocio o acceso a datos aquí. Los errores de dominio los traduce el
 * error handler global (`src/api/errores.ts`).
 *
 * NOTA DE INTEGRACIÓN: este plugin se CREA aquí pero NO se registra (F1-E3 lo cablea en
 * `app.ts`: `await app.register(rutasBordados, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/esquemas/error.js';
import {
  esquemaBordadoCrear,
  esquemaBordadoFotoCrear,
  esquemaBordadoFotoQuitarQuery,
  esquemaBordadoFotoSalida,
  esquemaBordadoFotoSubida,
  esquemaBordadoPatchCuerpo,
  esquemaBordadoSalida,
  esquemaBordadosPagina,
  esquemaBordadosQuery,
} from '../../contrato/esquemas/bordado.js';
import type { Bordado } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarBordado,
  crearBordado,
  desactivarBordado,
  listarBordados,
  obtenerBordado,
  quitarFoto,
  solicitarSubidaFoto,
  urlFoto,
  type FotoBordadoConUrl,
  type SubidaFotoBordado,
} from '../../dominio/catalogos/bordados.js';

/** Proyecta el modelo Prisma `Bordado` a la forma JSON del contrato (precio Decimal → number). */
function aBordadoSalida(bordado: Bordado): z.infer<typeof esquemaBordadoSalida> {
  return {
    id: bordado.id,
    nombre: bordado.nombre,
    descripcion: bordado.descripcion,
    puntadas: bordado.puntadas,
    precio: bordado.precio === null ? null : bordado.precio.toNumber(),
    tipo: bordado.tipo,
    idArchivoFoto: bordado.idArchivoFoto,
    activo: bordado.activo,
    creadoEn: bordado.creadoEn.toISOString(),
    creadoPorId: bordado.creadoPorId,
    modificadoEn: bordado.modificadoEn.toISOString(),
    modificadoPorId: bordado.modificadoPorId,
  };
}

/** Proyecta el resultado de preparar la subida de la foto a su forma JSON. */
function aSubidaFotoSalida(subida: SubidaFotoBordado): z.infer<typeof esquemaBordadoFotoSubida> {
  return {
    idArchivo: subida.idArchivo,
    nombreOriginal: subida.nombreOriginal,
    urlSubida: subida.urlSubida,
    expiraEnSegundos: subida.expiraEnSegundos,
  };
}

/** Proyecta la foto (con URL o vacía) a su forma JSON. */
function aFotoSalida(foto: FotoBordadoConUrl): z.infer<typeof esquemaBordadoFotoSalida> {
  return {
    idArchivo: foto.idArchivo,
    nombreOriginal: foto.nombreOriginal,
    tipoMime: foto.tipoMime,
    tamanoBytes: foto.tamanoBytes,
    urlDescarga: foto.urlDescarga,
  };
}

/** Parámetro de ruta `:id` (entero positivo). Reutilizado por GET/PATCH/DELETE. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del bordado debe ser un número' })
    .int({ error: 'El id del bordado debe ser entero' })
    .positive({ error: 'El id del bordado debe ser positivo' })
    .describe('Id del bordado.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de bordados (montadas bajo `/api`). NO se registra en `app.ts` aún. */
export const rutasBordados: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Listar (búsqueda + filtro por tipo + orden + paginación, modo servidor) ──
  app.route({
    method: 'GET',
    url: '/bordados',
    preHandler: app.conPermiso('bordados.ver'),
    schema: {
      tags: ['bordados'],
      summary: 'Listar bordados/estampados',
      security: SEGURIDAD_SESION,
      querystring: esquemaBordadosQuery,
      response: { 200: esquemaBordadosPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarBordados(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aBordadoSalida) };
    },
  });

  // ── Obtener uno ──────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/bordados/:id',
    preHandler: app.conPermiso('bordados.ver'),
    schema: {
      tags: ['bordados'],
      summary: 'Obtener un bordado',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaBordadoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aBordadoSalida(await obtenerBordado(sesion, request.params.id));
    },
  });

  // ── Crear ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/bordados',
    preHandler: app.conPermiso('bordados.administrar'),
    schema: {
      tags: ['bordados'],
      summary: 'Crear un bordado/estampado',
      security: SEGURIDAD_SESION,
      body: esquemaBordadoCrear,
      response: { 201: esquemaBordadoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const bordado = await crearBordado(sesion, request.body);
      return reply.code(201).send(aBordadoSalida(bordado));
    },
  });

  // ── Actualizar (parcial; activar/desactivar con `activo`) ────────────────────
  app.route({
    method: 'PATCH',
    url: '/bordados/:id',
    preHandler: app.conPermiso('bordados.administrar'),
    schema: {
      tags: ['bordados'],
      summary: 'Actualizar un bordado',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaBordadoPatchCuerpo,
      response: { 200: esquemaBordadoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const bordado = await actualizarBordado(sesion, {
        ...request.body,
        id: request.params.id,
      });
      return aBordadoSalida(bordado);
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/bordados/:id',
    preHandler: app.conPermiso('bordados.administrar'),
    schema: {
      tags: ['bordados'],
      summary: 'Desactivar un bordado (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaBordadoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aBordadoSalida(await desactivarBordado(sesion, request.params.id));
    },
  });

  // ── Foto en R2 (1 bordado → 0..1 foto, vía presigned) ────────────────────────

  // Preparar la subida de la foto (devuelve URL PUT prefirmada).
  app.route({
    method: 'POST',
    url: '/bordados/:id/foto',
    preHandler: app.conPermiso('bordados.administrar'),
    schema: {
      tags: ['bordados'],
      summary: 'Preparar la subida de la foto de un bordado',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaBordadoFotoCrear,
      response: { 201: esquemaBordadoFotoSubida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const subida = await solicitarSubidaFoto(sesion, request.params.id, request.body);
      return reply.code(201).send(aSubidaFotoSalida(subida));
    },
  });

  // URL de descarga de la foto (o vacío si no tiene).
  app.route({
    method: 'GET',
    url: '/bordados/:id/foto',
    preHandler: app.conPermiso('bordados.ver'),
    schema: {
      tags: ['bordados'],
      summary: 'Obtener la URL de la foto de un bordado',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaBordadoFotoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aFotoSalida(await urlFoto(sesion, request.params.id));
    },
  });

  // Quitar la foto (transacción A2). El `idArchivo` OPCIONAL del querystring acota el borrado a
  // esa foto: si la vigente ya es otra, no borra nada y contesta 409 (ver el esquema del contrato).
  app.route({
    method: 'DELETE',
    url: '/bordados/:id/foto',
    preHandler: app.conPermiso('bordados.administrar'),
    schema: {
      tags: ['bordados'],
      summary: 'Quitar la foto de un bordado',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      querystring: esquemaBordadoFotoQuitarQuery,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await quitarFoto(sesion, request.params.id, request.query.idArchivo);
      return reply.code(204).send(null);
    },
  });

  done();
};
