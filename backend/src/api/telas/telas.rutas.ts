/**
 * Rutas REST de Telas + TelaCategoria — catálogo de materiales global (F1-E3, PIEZA A —
 * Telas unificadas, D5). Calca el ESTÁNDAR de ruta de Maquileros/Cortadores
 * (`api/maquileros`, `api/cortadores`): cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `telas.ver` para leer, `telas.administrar` para mutar (un solo permiso cubre telas
 *     y categorías — ADR-0009: las categorías NO llevan permiso propio).
 *  3. **Delega** al servicio de dominio `dominio/catalogos/telas`.
 *
 * Particularidades: los `colores` (grid con precio, N:N) van inline en el body de
 * crear/editar; `GET /telas/{id}/colores` expone el grid embebido también suelto. Las
 * categorías son un sub-recurso `/telas-categorias` (selector + administración) bajo el
 * mismo permiso. CERO lógica de negocio o acceso a datos aquí; los errores de dominio los
 * traduce el error handler global (`src/api/errores.ts`).
 *
 * NOTA (integración F1-E3): este plugin NO se registra aquí; lo monta la app en la fase de
 * integración (junto con el OpenAPI regenerado y el link de menú "Catálogos → Telas").
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaErrorApi } from '../../contrato/index.js';
import type { esquemaTelaColorSalida } from '../../contrato/esquemas/tela.js';
import {
  esquemaListarTelas,
  esquemaTelaCategoriaCrear,
  esquemaTelaCategoriaEditar,
  esquemaTelaCategoriaSalida,
  esquemaTelaColoresLista,
  esquemaTelaCrear,
  esquemaTelaEditar,
  esquemaTelaSalida,
  esquemaTelasCategoriasPagina,
  esquemaTelasCategoriasQuery,
  esquemaTelasPagina,
} from '../../contrato/esquemas/tela.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarTela,
  actualizarTelaCategoria,
  crearTela,
  crearTelaCategoria,
  desactivarTela,
  desactivarTelaCategoria,
  listarColoresDeTela,
  listarTelas,
  listarTelasCategorias,
  obtenerTela,
  type TelaColorDetalle,
  type TelaConColores,
} from '../../dominio/catalogos/telas.js';
import type { TelaCategoria } from '../../datos/index.js';

/** Proyecta el modelo Prisma `Tela` (con categoría y colores) a la forma JSON del contrato. */
function aTelaSalida(tela: TelaConColores): z.infer<typeof esquemaTelaSalida> {
  return {
    id: tela.id,
    nombre: tela.nombre,
    descripcion: tela.descripcion,
    idCategoria: tela.idCategoria,
    categoria: tela.categoria?.nombre ?? null,
    unidadMedida: tela.unidadMedida,
    tipoComponente: tela.tipoComponente,
    favorito: tela.favorito,
    precioSugerido: tela.precioSugerido === null ? null : tela.precioSugerido.toNumber(),
    paraProduccion: tela.paraProduccion,
    colores: tela.colores.map((c) => ({
      idColor: c.idColor,
      nombre: c.color.nombre,
      precio: c.precio === null ? null : c.precio.toNumber(),
    })),
    activo: tela.activo,
    creadoEn: tela.creadoEn.toISOString(),
    creadoPorId: tela.creadoPorId,
    modificadoEn: tela.modificadoEn.toISOString(),
    modificadoPorId: tela.modificadoPorId,
  };
}

/** Proyecta un renglón de color de tela (color + precio) a la forma JSON del contrato. */
function aTelaColorSalida(color: TelaColorDetalle): z.infer<typeof esquemaTelaColorSalida> {
  return {
    idColor: color.idColor,
    nombre: color.nombre,
    precio: color.precio === null ? null : color.precio.toNumber(),
  };
}

/** Proyecta una categoría de tela a la forma JSON del contrato. */
function aTelaCategoriaSalida(
  categoria: TelaCategoria,
): z.infer<typeof esquemaTelaCategoriaSalida> {
  return {
    id: categoria.id,
    nombre: categoria.nombre,
    activo: categoria.activo,
    creadoEn: categoria.creadoEn.toISOString(),
    creadoPorId: categoria.creadoPorId,
    modificadoEn: categoria.modificadoEn.toISOString(),
    modificadoPorId: categoria.modificadoPorId,
  };
}

/** Parámetro de ruta `:id` de tela (entero positivo). Reutilizado por GET/PATCH/DELETE. */
const esquemaParamIdTela = z.object({
  id: z.coerce
    .number({ error: 'El id de la tela debe ser un número' })
    .int({ error: 'El id de la tela debe ser entero' })
    .positive({ error: 'El id de la tela debe ser positivo' })
    .describe('Id de la tela.'),
});

/** Parámetro de ruta `:id` de categoría de tela (entero positivo). */
const esquemaParamIdCategoria = z.object({
  id: z.coerce
    .number({ error: 'El id de la categoría debe ser un número' })
    .int({ error: 'El id de la categoría debe ser entero' })
    .positive({ error: 'El id de la categoría debe ser positivo' })
    .describe('Id de la categoría de tela.'),
});

/** Los cuerpos del PATCH no repiten el `id` (va en la URL). */
const esquemaTelaPatchCuerpo = esquemaTelaEditar.omit({ id: true });
const esquemaTelaCategoriaPatchCuerpo = esquemaTelaCategoriaEditar.omit({ id: true });

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de telas y categorías de tela (montadas bajo `/api`). */
export const rutasTelas: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ══ Categorías de tela (sub-recurso; selector + administración bajo telas.*) ════

  // ── Listar (búsqueda + orden + paginación en servidor) ─────────────────────
  app.route({
    method: 'GET',
    url: '/telas-categorias',
    preHandler: app.conPermiso('telas.ver'),
    schema: {
      tags: ['telas'],
      summary: 'Listar categorías de tela',
      security: SEGURIDAD_SESION,
      querystring: esquemaTelasCategoriasQuery,
      response: { 200: esquemaTelasCategoriasPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarTelasCategorias(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aTelaCategoriaSalida) };
    },
  });

  // ── Crear ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/telas-categorias',
    preHandler: app.conPermiso('telas.administrar'),
    schema: {
      tags: ['telas'],
      summary: 'Crear una categoría de tela',
      security: SEGURIDAD_SESION,
      body: esquemaTelaCategoriaCrear,
      response: { 201: esquemaTelaCategoriaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const categoria = await crearTelaCategoria(sesion, request.body);
      return reply.code(201).send(aTelaCategoriaSalida(categoria));
    },
  });

  // ── Actualizar (parcial; incluye activar/desactivar con `activo`) ──────────
  app.route({
    method: 'PATCH',
    url: '/telas-categorias/:id',
    preHandler: app.conPermiso('telas.administrar'),
    schema: {
      tags: ['telas'],
      summary: 'Actualizar una categoría de tela',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdCategoria,
      body: esquemaTelaCategoriaPatchCuerpo,
      response: { 200: esquemaTelaCategoriaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const categoria = await actualizarTelaCategoria(sesion, {
        ...request.body,
        id: request.params.id,
      });
      return aTelaCategoriaSalida(categoria);
    },
  });

  // ── Desactivar (borrado SUAVE; rechaza si la usa una tela activa) ──────────
  app.route({
    method: 'DELETE',
    url: '/telas-categorias/:id',
    preHandler: app.conPermiso('telas.administrar'),
    schema: {
      tags: ['telas'],
      summary: 'Desactivar una categoría de tela (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdCategoria,
      response: { 200: esquemaTelaCategoriaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aTelaCategoriaSalida(await desactivarTelaCategoria(sesion, request.params.id));
    },
  });

  // ══ Telas (entidad unificada con grid de colores con precio) ═══════════════════

  // ── Listar (búsqueda + filtro por categoría + orden + paginación) ──────────
  app.route({
    method: 'GET',
    url: '/telas',
    preHandler: app.conPermiso('telas.ver'),
    schema: {
      tags: ['telas'],
      summary: 'Listar telas',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarTelas,
      response: { 200: esquemaTelasPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarTelas(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aTelaSalida) };
    },
  });

  // ── Obtener una (con su categoría y colores) ───────────────────────────────
  app.route({
    method: 'GET',
    url: '/telas/:id',
    preHandler: app.conPermiso('telas.ver'),
    schema: {
      tags: ['telas'],
      summary: 'Obtener una tela',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdTela,
      response: { 200: esquemaTelaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aTelaSalida(await obtenerTela(sesion, request.params.id));
    },
  });

  // ── Colores de una tela (grid suelto; el precio vive por color) ────────────
  app.route({
    method: 'GET',
    url: '/telas/:id/colores',
    preHandler: app.conPermiso('telas.ver'),
    schema: {
      tags: ['telas'],
      summary: 'Listar los colores de una tela (con su precio)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdTela,
      response: { 200: esquemaTelaColoresLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const colores = await listarColoresDeTela(sesion, request.params.id);
      return { datos: colores.map(aTelaColorSalida) };
    },
  });

  // ── Crear (colores inline en el body) ──────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/telas',
    preHandler: app.conPermiso('telas.administrar'),
    schema: {
      tags: ['telas'],
      summary: 'Crear una tela',
      security: SEGURIDAD_SESION,
      body: esquemaTelaCrear,
      response: { 201: esquemaTelaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const tela = await crearTela(sesion, request.body);
      return reply.code(201).send(aTelaSalida(tela));
    },
  });

  // ── Actualizar (parcial; colores reemplazan el grid; activar/desactivar) ───
  app.route({
    method: 'PATCH',
    url: '/telas/:id',
    preHandler: app.conPermiso('telas.administrar'),
    schema: {
      tags: ['telas'],
      summary: 'Actualizar una tela',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdTela,
      body: esquemaTelaPatchCuerpo,
      response: { 200: esquemaTelaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const tela = await actualizarTela(sesion, { ...request.body, id: request.params.id });
      return aTelaSalida(tela);
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/telas/:id',
    preHandler: app.conPermiso('telas.administrar'),
    schema: {
      tags: ['telas'],
      summary: 'Desactivar una tela (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamIdTela,
      response: { 200: esquemaTelaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aTelaSalida(await desactivarTela(sesion, request.params.id));
    },
  });

  done();
};
