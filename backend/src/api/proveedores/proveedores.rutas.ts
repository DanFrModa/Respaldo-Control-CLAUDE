/**
 * Rutas REST de Proveedores — catálogo maestro global (F1-E1) enriquecido (F1-E1B, R15).
 * Calca el ESTÁNDAR de ruta de Almacenes (`api/almacenes/almacenes.rutas.ts`): cada
 * handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `proveedores.ver` para leer, `proveedores.administrar` para mutar.
 *  3. **Delega** al servicio de dominio `dominio/catalogos/proveedores`.
 *
 * F1-E1B agrega (sin permisos nuevos): roles inline en crear/editar (van en el body),
 * el selector `GET /roles-proveedor`, y los adjuntos en R2 (`/proveedores/:id/adjuntos`).
 *
 * CERO lógica de negocio o acceso a datos aquí. Los errores de dominio los traduce el
 * error handler global (`src/api/errores.ts`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { esquemaProveedorAdjuntoSalida } from '../../contrato/index.js';
import {
  esquemaErrorApi,
  esquemaProveedorAdjuntoCrear,
  esquemaProveedorAdjuntosLista,
  esquemaProveedorAdjuntoSubida,
  esquemaProveedorAvioAsignar,
  esquemaProveedorAviosLista,
  esquemaProveedorCrear,
  esquemaProveedorPatchCuerpo,
  esquemaProveedoresPagina,
  esquemaProveedoresQuery,
  esquemaProveedorSalida,
  esquemaRolProveedorSalida,
} from '../../contrato/index.js';
import type { RolProveedor } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarProveedor,
  agregarAdjuntoProveedor,
  asignarAvioProveedor,
  crearProveedor,
  desactivarProveedor,
  listarAdjuntosProveedor,
  listarAviosDeProveedor,
  listarProveedores,
  listarRolesProveedor,
  obtenerProveedor,
  quitarAdjuntoProveedor,
  quitarAvioProveedor,
  type AdjuntoProveedorConUrl,
  type ProveedorConRoles,
  type SubidaAdjuntoProveedor,
} from '../../dominio/catalogos/proveedores.js';

/** Proyecta el modelo Prisma `Proveedor` (con roles + conteo) a la forma JSON del contrato. */
function aProveedorSalida(proveedor: ProveedorConRoles): z.infer<typeof esquemaProveedorSalida> {
  return {
    id: proveedor.id,
    nombre: proveedor.nombre,
    razonSocial: proveedor.razonSocial,
    tipo: proveedor.tipo,
    telefono: proveedor.telefono,
    contacto: proveedor.contacto,
    condiciones: proveedor.condiciones,
    factura: proveedor.factura,
    rfc: proveedor.rfc,
    regimenFiscalSat: proveedor.regimenFiscalSat,
    usoCfdiHabitual: proveedor.usoCfdiHabitual,
    codigoPostalExpedicion: proveedor.codigoPostalExpedicion,
    retieneIva: proveedor.retieneIva,
    retieneIsr: proveedor.retieneIsr,
    email: proveedor.email,
    direccion: proveedor.direccion,
    diasCredito: proveedor.diasCredito,
    moneda: proveedor.moneda,
    formaPago: proveedor.formaPago,
    metodoPago: proveedor.metodoPago,
    banco: proveedor.banco,
    clabe: proveedor.clabe,
    limiteCredito: proveedor.limiteCredito === null ? null : Number(proveedor.limiteCredito),
    leadTimeDias: proveedor.leadTimeDias,
    notas: proveedor.notas,
    corto: proveedor.corto,
    asegurado: proveedor.asegurado,
    obsPago: proveedor.obsPago,
    modalidadFacturacion: proveedor.modalidadFacturacion,
    roles: proveedor.roles.map((r) => ({
      id: r.rol.id,
      codigo: r.rol.codigo,
      nombre: r.rol.nombre,
    })),
    cantidadAdjuntos: proveedor._count.archivos,
    activo: proveedor.activo,
    creadoEn: proveedor.creadoEn.toISOString(),
    creadoPorId: proveedor.creadoPorId,
    modificadoEn: proveedor.modificadoEn.toISOString(),
    modificadoPorId: proveedor.modificadoPorId,
  };
}

/** Proyecta un `RolProveedor` a la forma JSON del selector. */
function aRolProveedorSalida(rol: RolProveedor): z.infer<typeof esquemaRolProveedorSalida> {
  return { id: rol.id, codigo: rol.codigo, nombre: rol.nombre, activo: rol.activo };
}

/** Proyecta el resultado de preparar una subida a su forma JSON. */
function aSubidaSalida(
  subida: SubidaAdjuntoProveedor,
): z.infer<typeof esquemaProveedorAdjuntoSubida> {
  return {
    idArchivo: subida.idArchivo,
    tipo: subida.tipo,
    nombreOriginal: subida.nombreOriginal,
    urlSubida: subida.urlSubida,
    expiraEnSegundos: subida.expiraEnSegundos,
  };
}

/** Proyecta un adjunto con URL a su forma JSON. */
function aAdjuntoSalida(
  adjunto: AdjuntoProveedorConUrl,
): z.infer<typeof esquemaProveedorAdjuntoSalida> {
  return {
    idArchivo: adjunto.idArchivo,
    tipo: adjunto.tipo,
    nombreOriginal: adjunto.nombreOriginal,
    tipoMime: adjunto.tipoMime,
    tamanoBytes: adjunto.tamanoBytes,
    urlDescarga: adjunto.urlDescarga,
    creadoEn: adjunto.creadoEn.toISOString(),
  };
}

/** Parámetro de ruta `:id` (entero positivo). Reutilizado por GET/PATCH/DELETE. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del proveedor debe ser un número' })
    .int({ error: 'El id del proveedor debe ser entero' })
    .positive({ error: 'El id del proveedor debe ser positivo' })
    .describe('Id del proveedor.'),
});

/** Parámetros `:id` (proveedor) + `:idArchivo` (adjunto) para borrar un adjunto. */
const esquemaParamAdjunto = z.object({
  id: z.coerce
    .number({ error: 'El id del proveedor debe ser un número' })
    .int()
    .positive()
    .describe('Id del proveedor.'),
  idArchivo: z.string({ error: 'El id del archivo es obligatorio' }).describe('Id del adjunto.'),
});

/** Parámetros `:id` (proveedor) + `:idAvio` (avío) para quitar un avío que surte (B17). */
const esquemaParamAvio = z.object({
  id: z.coerce
    .number({ error: 'El id del proveedor debe ser un número' })
    .int()
    .positive()
    .describe('Id del proveedor.'),
  idAvio: z.coerce
    .number({ error: 'El id del avío debe ser un número' })
    .int()
    .positive()
    .describe('Id del avío.'),
});

/** Querystring del selector de roles. */
const esquemaRolesQuery = z.object({
  incluirInactivos: z
    .stringbool()
    .default(false)
    .describe('Incluye los roles desactivados ("true"/"false").'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de proveedores (montadas bajo `/api`). */
export const rutasProveedores: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Selector de roles/servicios de proveedor (R15) ──────────────────────────
  app.route({
    method: 'GET',
    url: '/roles-proveedor',
    preHandler: app.conPermiso('proveedores.ver'),
    schema: {
      tags: ['proveedores'],
      summary: 'Listar roles/servicios de proveedor (catálogo selector)',
      security: SEGURIDAD_SESION,
      querystring: esquemaRolesQuery,
      response: { 200: z.array(esquemaRolProveedorSalida), ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const roles = await listarRolesProveedor(sesion, {
        incluirInactivos: request.query.incluirInactivos,
      });
      return roles.map(aRolProveedorSalida);
    },
  });

  // ── Listar (búsqueda + filtro por tipo y por rol + orden + paginación) ──────
  app.route({
    method: 'GET',
    url: '/proveedores',
    preHandler: app.conPermiso('proveedores.ver'),
    schema: {
      tags: ['proveedores'],
      summary: 'Listar proveedores',
      security: SEGURIDAD_SESION,
      querystring: esquemaProveedoresQuery,
      response: { 200: esquemaProveedoresPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarProveedores(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aProveedorSalida) };
    },
  });

  // ── Obtener uno (con roles y conteo de adjuntos) ────────────────────────────
  app.route({
    method: 'GET',
    url: '/proveedores/:id',
    preHandler: app.conPermiso('proveedores.ver'),
    schema: {
      tags: ['proveedores'],
      summary: 'Obtener un proveedor',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaProveedorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aProveedorSalida(await obtenerProveedor(sesion, request.params.id));
    },
  });

  // ── Crear (roles inline en el body) ─────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/proveedores',
    preHandler: app.conPermiso('proveedores.administrar'),
    schema: {
      tags: ['proveedores'],
      summary: 'Crear un proveedor',
      security: SEGURIDAD_SESION,
      body: esquemaProveedorCrear,
      response: { 201: esquemaProveedorSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const proveedor = await crearProveedor(sesion, request.body);
      return reply.code(201).send(aProveedorSalida(proveedor));
    },
  });

  // ── Actualizar (parcial; roles inline; activar/desactivar con `activo`) ─────
  app.route({
    method: 'PATCH',
    url: '/proveedores/:id',
    preHandler: app.conPermiso('proveedores.administrar'),
    schema: {
      tags: ['proveedores'],
      summary: 'Actualizar un proveedor',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaProveedorPatchCuerpo,
      response: { 200: esquemaProveedorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const proveedor = await actualizarProveedor(sesion, {
        ...request.body,
        id: request.params.id,
      });
      return aProveedorSalida(proveedor);
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/proveedores/:id',
    preHandler: app.conPermiso('proveedores.administrar'),
    schema: {
      tags: ['proveedores'],
      summary: 'Desactivar un proveedor (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaProveedorSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aProveedorSalida(await desactivarProveedor(sesion, request.params.id));
    },
  });

  // ── Adjuntos en R2 (R15 §4: constancia/contrato) ────────────────────────────

  // Preparar la subida de un adjunto (devuelve URL PUT prefirmada).
  app.route({
    method: 'POST',
    url: '/proveedores/:id/adjuntos',
    preHandler: app.conPermiso('proveedores.administrar'),
    schema: {
      tags: ['proveedores'],
      summary: 'Preparar la subida de un adjunto del proveedor',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaProveedorAdjuntoCrear,
      response: { 201: esquemaProveedorAdjuntoSubida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const subida = await agregarAdjuntoProveedor(sesion, request.params.id, request.body);
      return reply.code(201).send(aSubidaSalida(subida));
    },
  });

  // Listar los adjuntos de un proveedor (cada uno con URL GET prefirmada).
  app.route({
    method: 'GET',
    url: '/proveedores/:id/adjuntos',
    preHandler: app.conPermiso('proveedores.ver'),
    schema: {
      tags: ['proveedores'],
      summary: 'Listar los adjuntos de un proveedor',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaProveedorAdjuntosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const adjuntos = await listarAdjuntosProveedor(sesion, request.params.id);
      return { datos: adjuntos.map(aAdjuntoSalida) };
    },
  });

  // Quitar un adjunto del proveedor.
  app.route({
    method: 'DELETE',
    url: '/proveedores/:id/adjuntos/:idArchivo',
    preHandler: app.conPermiso('proveedores.administrar'),
    schema: {
      tags: ['proveedores'],
      summary: 'Quitar un adjunto del proveedor',
      security: SEGURIDAD_SESION,
      params: esquemaParamAdjunto,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await quitarAdjuntoProveedor(sesion, request.params.id, request.params.idArchivo);
      return reply.code(204).send(null);
    },
  });

  // ── Avíos que surte el proveedor (B17, R9 — lado proveedor de AvioProveedor) ─

  // Listar los avíos que surte el proveedor (cada uno con su precio/condiciones).
  app.route({
    method: 'GET',
    url: '/proveedores/:id/avios',
    preHandler: app.conPermiso('proveedores.ver'),
    schema: {
      tags: ['proveedores'],
      summary: 'Listar los avíos que surte el proveedor (con su precio y condiciones)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaProveedorAviosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await listarAviosDeProveedor(sesion, request.params.id);
      return { datos };
    },
  });

  // Asignar un avío que surte el proveedor (crea el vínculo con su precio).
  app.route({
    method: 'POST',
    url: '/proveedores/:id/avios',
    preHandler: app.conPermiso('proveedores.administrar'),
    schema: {
      tags: ['proveedores'],
      summary: 'Asignar un avío que surte el proveedor',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaProveedorAvioAsignar,
      response: { 201: esquemaProveedorAviosLista, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await asignarAvioProveedor(sesion, request.params.id, request.body);
      return reply.code(201).send({ datos });
    },
  });

  // Quitar un avío que surte el proveedor (borra el vínculo).
  app.route({
    method: 'DELETE',
    url: '/proveedores/:id/avios/:idAvio',
    preHandler: app.conPermiso('proveedores.administrar'),
    schema: {
      tags: ['proveedores'],
      summary: 'Quitar un avío que surte el proveedor',
      security: SEGURIDAD_SESION,
      params: esquemaParamAvio,
      response: { 200: esquemaProveedorAviosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const datos = await quitarAvioProveedor(sesion, request.params.id, request.params.idAvio);
      return { datos };
    },
  });

  done();
};
