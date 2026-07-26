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
  esquemaEmpresaLogoConfirmar,
  esquemaEmpresaLogoCrear,
  esquemaEmpresaLogoSalida,
  esquemaEmpresaLogoSubida,
  esquemaEmpresaSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { ConfiguracionEmpresa, Empresa } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { esquemaRespuestaBinaria, SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarConfiguracion,
  actualizarEmpresa,
  crearEmpresa,
  confirmarLogo,
  desactivarEmpresa,
  imagenLogoEmpresa,
  listarEmpresas,
  logoEmpresa,
  obtenerConfiguracion,
  obtenerEmpresa,
  quitarLogo,
  reactivarEmpresa,
  solicitarSubidaLogo,
  type EntradaActualizarEmpresa,
} from '../../dominio/admin/empresas.js';

/** Proyecta el modelo Prisma `Empresa` a la forma JSON del contrato (fechas ISO). */
function aEmpresaSalida(empresa: Empresa): z.infer<typeof esquemaEmpresaSalida> {
  return {
    id: empresa.id,
    nombre: empresa.nombre,
    razonSocial: empresa.razonSocial,
    rfc: empresa.rfc,
    identificador: empresa.identificador,
    favorita: empresa.favorita,
    paraIpt: empresa.paraIpt,
    paraEdr: empresa.paraEdr,
    activa: empresa.activa,
    idArchivoLogo: empresa.idArchivoLogo,
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
    agingLimite1: config.agingLimite1,
    agingLimite2: config.agingLimite2,
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

/**
 * Query de la imagen del logo. `v` es un CACHE-BUSTER: NO decide qué logo se devuelve (eso lo dice
 * la sesión), sino que declara QUÉ VERSIÓN espera el cliente — la app manda el `idArchivoLogo` que
 * trae la sesión.
 *
 * El handler la usa solo para elegir la caché, y comparándola contra lo que REALMENTE sirvió: venir
 * versionada NO basta para cachear a largo plazo, porque ante un fallo se responde el logo
 * empaquetado en vez de la versión pedida (ver el handler).
 */
const esquemaQueryLogo = z.object({
  v: z
    .string()
    .optional()
    .describe('Versión del logo (id de su Archivo) para invalidar la caché del navegador.'),
});

/**
 * ¿El `If-None-Match` de la petición cubre este ETag? Acepta la lista separada por comas, el
 * comodín `*` y el prefijo débil `W/` (lo que mandan los navegadores tras una respuesta cacheada).
 */
function coincideIfNoneMatch(cabecera: string | string[] | undefined, etag: string): boolean {
  if (typeof cabecera !== 'string') {
    return false;
  }
  return cabecera
    .split(',')
    .map((valor) => valor.trim().replace(/^W\//, ''))
    .some((valor) => valor === etag || valor === '*');
}

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

  // ── LOGO de la empresa (post-F9, petición de Daniel del 25-jul-2026) ───────
  //
  // El logo se sube UNA vez aquí y de ahí lo toman los 23 impresos PDF y toda la
  // app: cambiarlo actualiza todo sin desplegar. Hay DOS lecturas, a propósito:
  //  • `/empresas/:id/logo` — metadatos + URL prefirmada de CUALQUIER empresa.
  //    Es la vista previa de Administración → exige `empresas.administrar`.
  //  • `/empresas/logo` — la IMAGEN de la marca, SIN sesión (ver su comentario).

  // Preparar la subida del logo (devuelve URL PUT prefirmada). Solo PNG/JPG ≤ 5 MB.
  app.route({
    method: 'POST',
    url: '/empresas/:id/logo',
    preHandler: app.conPermiso('empresas.administrar'),
    schema: {
      tags: ['empresas'],
      summary: 'Preparar la subida del logo de una empresa',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaEmpresaLogoCrear,
      response: { 201: esquemaEmpresaLogoSubida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const subida = await solicitarSubidaLogo(sesion, request.params.id, request.body);
      return reply.code(201).send(subida);
    },
  });

  // Confirmar la subida (PASO 2): con el objeto ya en R2, deja el logo nuevo como vigente y borra
  // el anterior. Hasta aquí NO se había tocado el logo vigente (ver el dominio).
  app.route({
    method: 'POST',
    url: '/empresas/:id/logo/confirmar',
    preHandler: app.conPermiso('empresas.administrar'),
    schema: {
      tags: ['empresas'],
      summary: 'Confirmar la subida del logo de una empresa',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaEmpresaLogoConfirmar,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await confirmarLogo(sesion, request.params.id, request.body.idArchivo);
      return reply.code(204).send(null);
    },
  });

  // Metadatos + URL prefirmada del logo (vista previa de Administración). Exige
  // `empresas.administrar`: entrega una URL prefirmada de CUALQUIER empresa por id, y su único
  // consumidor es el cajón de Administración. La marca que necesita toda la app se sirve por
  // `/empresas/logo`, que no expone URLs de R2 ni permite elegir empresa.
  app.route({
    method: 'GET',
    url: '/empresas/:id/logo',
    preHandler: app.conPermiso('empresas.administrar'),
    schema: {
      tags: ['empresas'],
      summary: 'Obtener el logo de una empresa (metadatos + URL prefirmada)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaEmpresaLogoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return logoEmpresa(sesion, request.params.id);
    },
  });

  // Quitar el logo (vuelve al empaquetado del repo).
  app.route({
    method: 'DELETE',
    url: '/empresas/:id/logo',
    preHandler: app.conPermiso('empresas.administrar'),
    schema: {
      tags: ['empresas'],
      summary: 'Quitar el logo de una empresa',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await quitarLogo(sesion, request.params.id);
      return reply.code(204).send(null);
    },
  });

  // IMAGEN del logo (binario). Es la marca que pinta la app entera: el riel, el menú móvil y la
  // pantalla de LOGIN. Notas de diseño:
  //
  //  • **SIN sesión.** El login es justo donde todavía no la hay, y Daniel pidió que el logo se
  //    actualice "en todos lados"; dejarlo tras la cookie obligaba a que el login se quedara con el
  //    logo empaquetado para siempre. Un logo es marca PÚBLICA (va impreso en los documentos que se
  //    mandan a clientes y proveedores), así que no hay nada que proteger. Con sesión responde el
  //    logo de la EMPRESA ACTIVA (A9); sin ella, el de la empresa predeterminada. NO expone ningún
  //    otro dato: solo bytes de imagen — ni nombre de empresa, ni ids, ni URLs de R2.
  //  • Se sirve por el API y no con una URL prefirmada porque la prefirmada caduca a los 15 min y
  //    dejaría la marca rota en sesiones largas.
  //  • **Caché honesta.** La app pide la URL VERSIONADA (`?v=<idArchivoLogo>`), que por definición
  //    cambia al cambiar el logo: esa se cachea un año como inmutable (cero peticiones). La URL sin
  //    versión (el login, que no sabe el id) se cachea un minuto y además atiende `If-None-Match`
  //    con 304, así que revalidar cuesta unos bytes en vez de la imagen entera.
  //  • Nunca falla: sin logo propio, con R2 caído o con el archivo corrupto, responde el PNG
  //    empaquetado.
  app.route({
    method: 'GET',
    url: '/empresas/logo',
    schema: {
      tags: ['empresas'],
      summary: 'Imagen del logo de la empresa (binario PNG/JPG, público)',
      description:
        'Marca del sistema. Con sesión devuelve el logo de la empresa activa; sin sesión, el de la ' +
        'empresa predeterminada (lo necesita el login). Si no hay logo propio devuelve el ' +
        'empaquetado en el repo. Pásale `?v=<idArchivoLogo>` para poder cachearla de forma indefinida.',
      querystring: esquemaQueryLogo,
      response: {
        200: esquemaRespuestaBinaria('Bytes del logo.', ['image/png', 'image/jpeg']),
        // `z.void()` (no `z.null()`): un 304 va SIN cuerpo, y `null` haría que el serializador
        // escribiera los 4 bytes de "null" — un 304 con cuerpo viola el protocolo.
        304: z.void().describe('El logo no cambió (coincide el ETag): no se reenvía la imagen.'),
      },
    },
    handler: async (request, reply) => {
      // Sin sesión NO es error: se cae a la empresa predeterminada (el login).
      const sesion = await request.obtenerSesion();
      const logo = await imagenLogoEmpresa(sesion);

      const etag = `"${logo.idArchivo ?? 'empaquetado'}"`;
      // La caché larga se decide por lo que se SIRVIÓ, no por la forma de la URL. Es la diferencia
      // entre "pidieron ?v=arch_A" y "esto ES arch_A": el resolutor nunca falla, así que ante un
      // bache de R2 (o un archivo corrupto, o los 10 s de caché negativa) responde el EMPAQUETADO
      // aunque la URL pida `arch_A`. Marcar eso como `immutable` clavaría el logo equivocado un año
      // en el navegador —`immutable` le dice que ni revalide— y como la URL no cambia (la empresa
      // sigue teniendo `arch_A`) no se recuperaría solo ni recargando: haría falta un Ctrl+Shift+R.
      const sirvioLaVersionPedida =
        request.query.v !== undefined && request.query.v === logo.idArchivo;
      const cache = sirvioLaVersionPedida
        ? 'private, max-age=31536000, immutable'
        : 'private, max-age=60';
      // `Vary: Cookie`: la respuesta depende de la sesión (empresa activa vs predeterminada), así
      // que la entrada cacheada de un usuario no puede reutilizarse tras un logout o un cambio de
      // empresa. Sin esto, en multi-empresa se vería hasta 60 s el logo anterior.
      reply.header('ETag', etag).header('Cache-Control', cache).header('Vary', 'Cookie');

      if (coincideIfNoneMatch(request.headers['if-none-match'], etag)) {
        return reply.code(304).send(undefined);
      }

      reply.header('Content-Type', logo.tipoMime);
      return reply.send(logo.bytes);
    },
  });

  done();
};
