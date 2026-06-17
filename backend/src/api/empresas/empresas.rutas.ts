/**
 * Rutas REST de Empresas y su configuración (Administración, F1-E1 PIEZA C).
 * Calca el ESTÁNDAR de ruta de Almacenes: cada handler solo (A1) valida (Zod
 * compartido), autoriza (`app.conPermiso`) y delega al dominio
 * `dominio/admin/empresas` (que reaplica el permiso, valida, transacciona y audita).
 *
 * El dominio verifica `empresas.administrar` en TODAS sus operaciones (no existe
 * `empresas.ver`): por eso TODAS las rutas —GET incluidos— usan esa misma clave.
 *
 * Las empresas son POCAS: el listado devuelve TODAS (sin paginación), tal como
 * el servicio de dominio. El borrado suave se hace por DELETE y la reactivación
 * por PATCH `{ activa: true }` (igual ciclo que el patrón Almacenes).
 *
 * CERO lógica de negocio o acceso a datos aquí; los errores de dominio los
 * traduce `src/api/errores.ts`.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaConfiguracionEmpresaActualizar,
  esquemaConfiguracionEmpresaSalida,
  esquemaEmpresaCrear,
  esquemaEmpresaEditar,
  esquemaEmpresaSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { ConfiguracionEmpresa, Empresa } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarConfiguracion,
  actualizarEmpresa,
  crearEmpresa,
  desactivarEmpresa,
  listarEmpresas,
  obtenerConfiguracion,
  obtenerEmpresa,
  reactivarEmpresa,
  type EntradaActualizarEmpresa,
} from '../../dominio/admin/empresas.js';

/** Proyecta el modelo Prisma `Empresa` a la forma JSON del contrato (fechas ISO). */
function aEmpresaSalida(empresa: Empresa): z.infer<typeof esquemaEmpresaSalida> {
  return {
    id: empresa.id,
    nombre: empresa.nombre,
    razonSocial: empresa.razonSocial,
    identificador: empresa.identificador,
    favorita: empresa.favorita,
    paraIpt: empresa.paraIpt,
    paraEdr: empresa.paraEdr,
    activa: empresa.activa,
    creadoEn: empresa.creadoEn.toISOString(),
    creadoPorId: empresa.creadoPorId,
    modificadoEn: empresa.modificadoEn.toISOString(),
    modificadoPorId: empresa.modificadoPorId,
  };
}

/**
 * Proyecta `ConfiguracionEmpresa` a JSON: los `Decimal` de Prisma se vuelven
 * número y las fechas ISO 8601 (o null). Prisma entrega los Decimal como objeto
 * `Decimal`; `Number(...)` los normaliza para el contrato.
 */
function aConfiguracionSalida(
  config: ConfiguracionEmpresa,
): z.infer<typeof esquemaConfiguracionEmpresaSalida> {
  return {
    idEmpresa: config.idEmpresa,
    utilidadSugerida: config.utilidadSugerida === null ? null : Number(config.utilidadSugerida),
    regaliasBase: config.regaliasBase === null ? null : Number(config.regaliasBase),
    colchonCostura: config.colchonCostura,
    fechaInventarioTelas:
      config.fechaInventarioTelas === null ? null : config.fechaInventarioTelas.toISOString(),
    fechaInventarioPt:
      config.fechaInventarioPt === null ? null : config.fechaInventarioPt.toISOString(),
    idAlmacenPtDefault: config.idAlmacenPtDefault,
    creadoEn: config.creadoEn.toISOString(),
    modificadoEn: config.modificadoEn.toISOString(),
  };
}

/** Parámetro de ruta `:id` de la empresa (entero positivo). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id de la empresa debe ser un número' })
    .int({ error: 'El id de la empresa debe ser entero' })
    .positive({ error: 'El id de la empresa debe ser positivo' })
    .describe('Id de la empresa.'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de empresas (montadas bajo `/api`). */
export const rutasEmpresas: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Listar TODAS (la favorita primero; son pocas, sin paginación) ──────────
  app.route({
    method: 'GET',
    url: '/empresas',
    preHandler: app.conPermiso('empresas.administrar'),
    schema: {
      tags: ['empresas'],
      summary: 'Listar empresas',
      security: SEGURIDAD_SESION,
      response: { 200: z.array(esquemaEmpresaSalida), ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const empresas = await listarEmpresas(sesion);
      return empresas.map(aEmpresaSalida);
    },
  });

  // ── Obtener una ────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/empresas/:id',
    preHandler: app.conPermiso('empresas.administrar'),
    schema: {
      tags: ['empresas'],
      summary: 'Obtener una empresa',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaEmpresaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aEmpresaSalida(await obtenerEmpresa(sesion, request.params.id));
    },
  });

  // ── Crear ──────────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/empresas',
    preHandler: app.conPermiso('empresas.administrar'),
    schema: {
      tags: ['empresas'],
      summary: 'Crear una empresa',
      security: SEGURIDAD_SESION,
      body: esquemaEmpresaCrear,
      response: { 201: esquemaEmpresaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const empresa = await crearEmpresa(sesion, request.body);
      return reply.code(201).send(aEmpresaSalida(empresa));
    },
  });

  // ── Actualizar (parcial; `activa` des/reactiva como en el patrón Almacenes) ─
  // El dominio separa el cambio de estado (reactivar/desactivar tienen reglas
  // propias) de la edición de datos: la ruta enruta `activa` a su servicio y
  // delega el resto de los campos a `actualizarEmpresa`. Devuelve el estado final.
  app.route({
    method: 'PATCH',
    url: '/empresas/:id',
    preHandler: app.conPermiso('empresas.administrar'),
    schema: {
      tags: ['empresas'],
      summary: 'Actualizar una empresa',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaEmpresaEditar,
      response: { 200: esquemaEmpresaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { id } = request.params;
      const { activa, ...datos } = request.body;

      // Cambio de estado (cada uno con sus reglas en el dominio).
      if (activa === true) {
        await reactivarEmpresa(sesion, id);
      } else if (activa === false) {
        await desactivarEmpresa(sesion, id);
      }

      // Edición de datos (solo si llegó algún campo además del estado).
      const cambios: EntradaActualizarEmpresa = datos;
      let empresa: Empresa;
      if (Object.keys(datos).length > 0) {
        empresa = await actualizarEmpresa(sesion, id, cambios);
      } else {
        empresa = await obtenerEmpresa(sesion, id);
      }
      return aEmpresaSalida(empresa);
    },
  });

  // ── Desactivar (borrado SUAVE) ─────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/empresas/:id',
    preHandler: app.conPermiso('empresas.administrar'),
    schema: {
      tags: ['empresas'],
      summary: 'Desactivar una empresa (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaEmpresaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aEmpresaSalida(await desactivarEmpresa(sesion, request.params.id));
    },
  });

  // ── Configuración por empresa (ex-Propiedades) ─────────────────────────────
  app.route({
    method: 'GET',
    url: '/empresas/:id/configuracion',
    preHandler: app.conPermiso('empresas.administrar'),
    schema: {
      tags: ['empresas'],
      summary: 'Obtener la configuración de una empresa',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaConfiguracionEmpresaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aConfiguracionSalida(await obtenerConfiguracion(sesion, request.params.id));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/empresas/:id/configuracion',
    preHandler: app.conPermiso('empresas.administrar'),
    schema: {
      tags: ['empresas'],
      summary: 'Actualizar la configuración de una empresa',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaConfiguracionEmpresaActualizar,
      response: { 200: esquemaConfiguracionEmpresaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      // Las fechas viajan como ISO string en el contrato; el dominio espera `Date`.
      // Se separan del resto para convertirlas, preservando la distinción
      // undefined (no tocar) vs null (limpiar el valor).
      const { fechaInventarioTelas, fechaInventarioPt, ...resto } = request.body;
      const config = await actualizarConfiguracion(sesion, request.params.id, {
        ...resto,
        ...(fechaInventarioTelas === undefined
          ? {}
          : {
              fechaInventarioTelas:
                fechaInventarioTelas === null ? null : new Date(fechaInventarioTelas),
            }),
        ...(fechaInventarioPt === undefined
          ? {}
          : { fechaInventarioPt: fechaInventarioPt === null ? null : new Date(fechaInventarioPt) }),
      });
      return aConfiguracionSalida(config);
    },
  });

  done();
};
