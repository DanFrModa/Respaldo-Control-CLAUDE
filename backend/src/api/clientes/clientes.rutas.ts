/**
 * Rutas REST de Clientes — catálogo maestro global (F1-E2, PIEZA C) con campos de
 * referencia (D7). Calca el ESTÁNDAR de ruta de Proveedores (`proveedores.rutas.ts`,
 * que también tiene un sub-recurso): cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `clientes.ver` para leer, `clientes.administrar` para mutar.
 *  3. **Delega** al servicio de dominio `dominio/catalogos/clientes`.
 *
 * Endpoints: CRUD `/clientes` (+ `:id`) y la gestión de campos de referencia
 * `GET/POST/PATCH/DELETE /clientes/:id/campos[/:idCampo]` (D7, mismo patrón de
 * sub-recurso que `/proveedores/:id/adjuntos`).
 *
 * CERO lógica de negocio o acceso a datos aquí. Los errores de dominio los traduce el
 * error handler global (`src/api/errores.ts`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaClienteCampoCrear,
  esquemaClienteCampoEditar,
  esquemaClienteCrear,
  esquemaClienteEditar,
  esquemaClienteSalida,
  esquemaClientesPagina,
  esquemaErrorApi,
  esquemaListarClientes,
  type ClienteCampoSalida,
} from '../../contrato/index.js';
import {
  esquemaClienteCamposLista,
  esquemaClienteCampoSalida,
  esquemaClienteContactoCrear,
  esquemaClienteContactoEditarCuerpo,
  esquemaClienteContactoSalida,
  esquemaClienteContactosLista,
  esquemaClienteContactosQuery,
  type ClienteContactoSalida,
} from '../../contrato/esquemas/cliente.js';
import type { ClienteCampo } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarContactoCliente,
  crearContactoCliente,
  listarContactosCliente,
  type ContactoCliente,
} from '../../dominio/catalogos/cliente-contactos.js';
import {
  actualizarCampoCliente,
  actualizarCliente,
  agregarCampoCliente,
  crearCliente,
  desactivarCampoCliente,
  desactivarCliente,
  listarCamposCliente,
  listarClientes,
  obtenerCliente,
  type ClienteConCampos,
} from '../../dominio/catalogos/clientes.js';

/** Proyecta un `ClienteCampo` de Prisma a la forma JSON del contrato (fechas ISO). */
function aCampoSalida(campo: ClienteCampo): ClienteCampoSalida {
  return {
    id: campo.id,
    idCliente: campo.idCliente,
    etiqueta: campo.etiqueta,
    tipo: campo.tipo,
    orden: campo.orden,
    activo: campo.activo,
    creadoEn: campo.creadoEn.toISOString(),
    creadoPorId: campo.creadoPorId,
    modificadoEn: campo.modificadoEn.toISOString(),
    modificadoPorId: campo.modificadoPorId,
  };
}

/** Proyecta el modelo Prisma `Cliente` (con campos) a la forma JSON del contrato. */
function aClienteSalida(cliente: ClienteConCampos): z.infer<typeof esquemaClienteSalida> {
  return {
    id: cliente.id,
    nombre: cliente.nombre,
    abreviatura: cliente.abreviatura,
    razonSocial: cliente.razonSocial,
    contacto: cliente.contacto,
    telefono: cliente.telefono,
    email: cliente.email,
    direccion: cliente.direccion,
    rfc: cliente.rfc,
    diasCredito: cliente.diasCredito,
    activo: cliente.activo,
    creadoEn: cliente.creadoEn.toISOString(),
    creadoPorId: cliente.creadoPorId,
    modificadoEn: cliente.modificadoEn.toISOString(),
    modificadoPorId: cliente.modificadoPorId,
    campos: cliente.campos.map(aCampoSalida),
  };
}

/**
 * Proyecta un contacto del cliente (V1-E8y, §Post-F9.152) a la forma JSON del contrato. El NOMBRE
 * del departamento viaja resuelto: la pantalla enseña «Laura · compradora · NIÑOS» sin cruzar
 * catálogos, y `null` significa que atiende al cliente completo.
 */
function aContactoClienteSalida(contacto: ContactoCliente): ClienteContactoSalida {
  return {
    id: contacto.id,
    idCliente: contacto.idCliente,
    idClienteDepartamento: contacto.idClienteDepartamento,
    nombreDepartamento: contacto.clienteDepartamento?.nombre ?? null,
    nombre: contacto.nombre,
    puesto: contacto.puesto,
    telefono: contacto.telefono,
    email: contacto.email,
    notas: contacto.notas,
    activo: contacto.activo,
  };
}

/** Parámetro de ruta `:id` (entero positivo). Reutilizado por GET/PATCH/DELETE. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del cliente debe ser un número' })
    .int({ error: 'El id del cliente debe ser entero' })
    .positive({ error: 'El id del cliente debe ser positivo' })
    .describe('Id del cliente.'),
});

/** Parámetros `:id` (cliente) + `:idCampo` (campo de referencia) para editar/borrar un campo. */
const esquemaParamCampo = z.object({
  id: z.coerce
    .number({ error: 'El id del cliente debe ser un número' })
    .int()
    .positive()
    .describe('Id del cliente.'),
  idCampo: z.coerce
    .number({ error: 'El id del campo debe ser un número' })
    .int()
    .positive()
    .describe('Id del campo de referencia.'),
});

/** Parámetros `:id` (cliente) + `:idContacto` para editar/archivar un contacto (V1-E8y). */
const esquemaParamContactoCliente = z.object({
  id: z.coerce
    .number({ error: 'El id del cliente debe ser un número' })
    .int()
    .positive()
    .describe('Id del cliente.'),
  idContacto: z.coerce
    .number({ error: 'El id del contacto debe ser un número' })
    .int()
    .positive()
    .describe('Id del contacto del cliente.'),
});

/** Querystring del listado de campos (permite traer los desactivados). */
const esquemaCamposQuery = z.object({
  incluirInactivos: z
    .stringbool()
    .default(false)
    .describe('Incluye los campos desactivados ("true"/"false").'),
});

/** El cuerpo del PATCH de cliente no repite el `id` (va en la URL). */
const esquemaClientePatchCuerpo = esquemaClienteEditar.omit({ id: true });

/** El cuerpo del PATCH de un campo no repite el `id` (va en la URL como `:idCampo`). */
const esquemaCampoPatchCuerpo = esquemaClienteCampoEditar.omit({ id: true });

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de clientes y sus campos de referencia (montadas bajo `/api`). */
export const rutasClientes: FastifyPluginCallbackZod = (app, _opciones, done) => {
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
    url: '/clientes',
    preHandler: app.conPermiso('clientes.ver'),
    schema: {
      tags: ['clientes'],
      summary: 'Listar clientes',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarClientes,
      response: { 200: esquemaClientesPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarClientes(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aClienteSalida) };
    },
  });

  // ── Obtener uno (con sus campos de referencia) ──────────────────────────────
  app.route({
    method: 'GET',
    url: '/clientes/:id',
    preHandler: app.conPermiso('clientes.ver'),
    schema: {
      tags: ['clientes'],
      summary: 'Obtener un cliente',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaClienteSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aClienteSalida(await obtenerCliente(sesion, request.params.id));
    },
  });

  // ── Crear ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/clientes',
    preHandler: app.conPermiso('clientes.administrar'),
    schema: {
      tags: ['clientes'],
      summary: 'Crear un cliente',
      security: SEGURIDAD_SESION,
      body: esquemaClienteCrear,
      response: { 201: esquemaClienteSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const cliente = await crearCliente(sesion, request.body);
      return reply.code(201).send(aClienteSalida(cliente));
    },
  });

  // ── Actualizar (parcial; activar/desactivar con `activo`) ──────────────────
  app.route({
    method: 'PATCH',
    url: '/clientes/:id',
    preHandler: app.conPermiso('clientes.administrar'),
    schema: {
      tags: ['clientes'],
      summary: 'Actualizar un cliente',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaClientePatchCuerpo,
      response: { 200: esquemaClienteSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const cliente = await actualizarCliente(sesion, { ...request.body, id: request.params.id });
      return aClienteSalida(cliente);
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/clientes/:id',
    preHandler: app.conPermiso('clientes.administrar'),
    schema: {
      tags: ['clientes'],
      summary: 'Desactivar un cliente (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaClienteSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aClienteSalida(await desactivarCliente(sesion, request.params.id));
    },
  });

  // ── Campos de referencia del cliente (D7) ───────────────────────────────────

  // Listar los campos de un cliente (ordenados por `orden`).
  app.route({
    method: 'GET',
    url: '/clientes/:id/campos',
    preHandler: app.conPermiso('clientes.ver'),
    schema: {
      tags: ['clientes'],
      summary: 'Listar los campos de referencia de un cliente (D7)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      querystring: esquemaCamposQuery,
      response: { 200: esquemaClienteCamposLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const campos = await listarCamposCliente(sesion, request.params.id, {
        incluirInactivos: request.query.incluirInactivos,
      });
      return { datos: campos.map(aCampoSalida) };
    },
  });

  // Agregar un campo de referencia al cliente.
  app.route({
    method: 'POST',
    url: '/clientes/:id/campos',
    preHandler: app.conPermiso('clientes.administrar'),
    schema: {
      tags: ['clientes'],
      summary: 'Agregar un campo de referencia a un cliente (D7)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaClienteCampoCrear,
      response: { 201: esquemaClienteCampoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const campo = await agregarCampoCliente(sesion, request.params.id, request.body);
      return reply.code(201).send(aCampoSalida(campo));
    },
  });

  // Actualizar un campo de referencia (etiqueta/tipo/orden/activo).
  app.route({
    method: 'PATCH',
    url: '/clientes/:id/campos/:idCampo',
    preHandler: app.conPermiso('clientes.administrar'),
    schema: {
      tags: ['clientes'],
      summary: 'Actualizar un campo de referencia de un cliente (D7)',
      security: SEGURIDAD_SESION,
      params: esquemaParamCampo,
      body: esquemaCampoPatchCuerpo,
      response: { 200: esquemaClienteCampoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const campo = await actualizarCampoCliente(sesion, request.params.id, {
        ...request.body,
        id: request.params.idCampo,
      });
      return aCampoSalida(campo);
    },
  });

  // Desactivar (borrado SUAVE) un campo de referencia.
  app.route({
    method: 'DELETE',
    url: '/clientes/:id/campos/:idCampo',
    preHandler: app.conPermiso('clientes.administrar'),
    schema: {
      tags: ['clientes'],
      summary: 'Desactivar un campo de referencia de un cliente (D7)',
      security: SEGURIDAD_SESION,
      params: esquemaParamCampo,
      response: { 200: esquemaClienteCampoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const campo = await desactivarCampoCliente(sesion, request.params.id, request.params.idCampo);
      return aCampoSalida(campo);
    },
  });

  // ── ⭐ Contactos del cliente (V1-E8y, §Post-F9.152) ─────────────────────────
  // SIN permisos nuevos: se gobiernan con `clientes.ver`/`.administrar`. Mismo sub-recurso que los
  // contactos del proveedor, con el DEPARTAMENTO opcional (decisión de Daniel). No hay DELETE: un
  // contacto que se fue se ARCHIVA con `activo: false` (D3).

  app.route({
    method: 'GET',
    url: '/clientes/:id/contactos',
    preHandler: app.conPermiso('clientes.ver'),
    schema: {
      tags: ['clientes'],
      summary: 'Listar los contactos del cliente (la compradora; puesto en texto libre)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      querystring: esquemaClienteContactosQuery,
      response: { 200: esquemaClienteContactosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const contactos = await listarContactosCliente(
        sesion,
        request.params.id,
        request.query.incluirInactivos,
      );
      return { datos: contactos.map(aContactoClienteSalida) };
    },
  });

  app.route({
    method: 'POST',
    url: '/clientes/:id/contactos',
    preHandler: app.conPermiso('clientes.administrar'),
    schema: {
      tags: ['clientes'],
      summary: 'Agregar un contacto al cliente (departamento OPCIONAL)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaClienteContactoCrear,
      response: { 201: esquemaClienteContactoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const contacto = await crearContactoCliente(sesion, request.params.id, request.body);
      return reply.code(201).send(aContactoClienteSalida(contacto));
    },
  });

  // PATCH parcial; con `activo: false` ARCHIVA el contacto (borrado suave, D3 — no hay DELETE).
  app.route({
    method: 'PATCH',
    url: '/clientes/:id/contactos/:idContacto',
    preHandler: app.conPermiso('clientes.administrar'),
    schema: {
      tags: ['clientes'],
      summary: 'Editar (o archivar con activo=false) un contacto del cliente',
      security: SEGURIDAD_SESION,
      params: esquemaParamContactoCliente,
      body: esquemaClienteContactoEditarCuerpo,
      response: { 200: esquemaClienteContactoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const contacto = await actualizarContactoCliente(
        sesion,
        request.params.id,
        request.params.idContacto,
        request.body,
      );
      return aContactoClienteSalida(contacto);
    },
  });

  done();
};
