/**
 * Rutas REST de Etiquetas de marca — catálogo maestro global (F1-E1). Calca el
 * ESTÁNDAR de ruta de Almacenes (`api/almacenes/almacenes.rutas.ts`): cada handler
 * solo (A1) valida (Zod compartido), autoriza (`etiquetas-marca.ver`/`.administrar`,
 * §9.2) y delega al servicio `dominio/catalogos/etiquetas-marca`. CERO lógica de
 * negocio o datos aquí.
 *
 * Particularidad: `regalias` es Decimal en Prisma; al serializar a JSON se convierte
 * a `number` con `.toNumber()`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaEtiquetaMarcaCrear,
  esquemaEtiquetaMarcaEditar,
  esquemaEtiquetasMarcaPagina,
  esquemaEtiquetasMarcaQuery,
  esquemaEtiquetaMarcaSalida,
} from '../../contrato/index.js';
import type { EtiquetaMarca } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarEtiquetaMarca,
  crearEtiquetaMarca,
  desactivarEtiquetaMarca,
  listarEtiquetasMarca,
  obtenerEtiquetaMarca,
} from '../../dominio/catalogos/etiquetas-marca.js';

/** Proyecta el modelo Prisma `EtiquetaMarca` a la forma JSON del contrato (Decimal→number, fechas ISO). */
function aEtiquetaMarcaSalida(etiqueta: EtiquetaMarca): z.infer<typeof esquemaEtiquetaMarcaSalida> {
  return {
    id: etiqueta.id,
    nombre: etiqueta.nombre,
    regalias: etiqueta.regalias.toNumber(),
    activo: etiqueta.activo,
    creadoEn: etiqueta.creadoEn.toISOString(),
    creadoPorId: etiqueta.creadoPorId,
    modificadoEn: etiqueta.modificadoEn.toISOString(),
    modificadoPorId: etiqueta.modificadoPorId,
  };
}

/** Parámetro de ruta `:id` (entero positivo). Reutilizado por GET/PATCH/DELETE. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la etiqueta debe ser un número' })
    .int({ error: 'El id de la etiqueta debe ser entero' })
    .positive({ error: 'El id de la etiqueta debe ser positivo' })
    .describe('Id de la etiqueta de marca.'),
});

/** El cuerpo del PATCH no repite el `id` (va en la URL). */
const esquemaEtiquetaMarcaPatchCuerpo = esquemaEtiquetaMarcaEditar.omit({ id: true });

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de etiquetas de marca (montadas bajo `/api`). */
export const rutasEtiquetasMarca: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Listar (búsqueda + orden + paginación en servidor) ─────────────────────
  app.route({
    method: 'GET',
    url: '/etiquetas-marca',
    preHandler: app.conPermiso('etiquetas-marca.ver'),
    schema: {
      tags: ['etiquetas-marca'],
      summary: 'Listar etiquetas de marca',
      security: SEGURIDAD_SESION,
      querystring: esquemaEtiquetasMarcaQuery,
      response: { 200: esquemaEtiquetasMarcaPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarEtiquetasMarca(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aEtiquetaMarcaSalida) };
    },
  });

  // ── Obtener una ────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/etiquetas-marca/:id',
    preHandler: app.conPermiso('etiquetas-marca.ver'),
    schema: {
      tags: ['etiquetas-marca'],
      summary: 'Obtener una etiqueta de marca',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaEtiquetaMarcaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aEtiquetaMarcaSalida(await obtenerEtiquetaMarca(sesion, request.params.id));
    },
  });

  // ── Crear ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/etiquetas-marca',
    preHandler: app.conPermiso('etiquetas-marca.administrar'),
    schema: {
      tags: ['etiquetas-marca'],
      summary: 'Crear una etiqueta de marca',
      security: SEGURIDAD_SESION,
      body: esquemaEtiquetaMarcaCrear,
      response: { 201: esquemaEtiquetaMarcaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const etiqueta = await crearEtiquetaMarca(sesion, request.body);
      return reply.code(201).send(aEtiquetaMarcaSalida(etiqueta));
    },
  });

  // ── Actualizar (parcial; incluye activar/desactivar con `activo`) ──────────
  app.route({
    method: 'PATCH',
    url: '/etiquetas-marca/:id',
    preHandler: app.conPermiso('etiquetas-marca.administrar'),
    schema: {
      tags: ['etiquetas-marca'],
      summary: 'Actualizar una etiqueta de marca',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaEtiquetaMarcaPatchCuerpo,
      response: { 200: esquemaEtiquetaMarcaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const etiqueta = await actualizarEtiquetaMarca(sesion, {
        ...request.body,
        id: request.params.id,
      });
      return aEtiquetaMarcaSalida(etiqueta);
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/etiquetas-marca/:id',
    preHandler: app.conPermiso('etiquetas-marca.administrar'),
    schema: {
      tags: ['etiquetas-marca'],
      summary: 'Desactivar una etiqueta de marca (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaEtiquetaMarcaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aEtiquetaMarcaSalida(await desactivarEtiquetaMarca(sesion, request.params.id));
    },
  });

  done();
};
