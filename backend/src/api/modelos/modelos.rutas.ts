/**
 * Rutas REST del Módulo 2 — Modelos (F1-E4): el catálogo de productos, su receta/BOM
 * (telas/avíos), su ARTE y sus fotos en R2. Calca el ESTÁNDAR de ruta de Telas/Avíos
 * (`api/.../*.rutas.ts`): cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso(...)` (deny-by-default, §9.2):
 *     `modelos.ver` para leer, `modelos.administrar` para mutar (el selector de Género
 *     va bajo `modelos.ver` — sin permiso propio).
 *  3. **Delega** a los servicios de dominio (`dominio/modelos/*`).
 *
 * Diseño de los endpoints de BOM (donde el spec dejó margen): cada sección es un sub-recurso
 * `/modelos/:id/bom/{telas|avios}` con GET (leer) y PUT (reemplazar el SET completo en una
 * transacción A2, como el grid de colores de la tela). `POST /modelos/:id/copiar-bom` clona el
 * BOM de otro modelo (atómico). El ARTE es `/modelos/:id/artes` con CRUD renglón por renglón
 * (V1-E3d: tiene foto, no cabe en un PUT de conjunto) + `/artes/copiar` y su foto presigned; la
 * GALERÍA de arte de todos los modelos es `GET /api/artes`. Las fotos del modelo son
 * `/modelos/:id/fotos` (POST presigned, GET listar, PATCH metadatos, DELETE quitar).
 * CERO lógica de negocio o acceso a datos aquí;
 * los errores de dominio los traduce el error handler global (`src/api/errores.ts`).
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasModelos, { prefix: '/api' })`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaArteCopiarCuerpo,
  esquemaArteCrear,
  esquemaArteFotoCrear,
  esquemaArteFotoSalida,
  esquemaArteFotosLista,
  esquemaArteFotoSubida,
  esquemaArtePatchCuerpo,
  esquemaArteSalida,
  esquemaArtesLista,
  esquemaGaleriaArtePagina,
  esquemaGaleriaArteQuery,
} from '../../contrato/esquemas/arte.js';
import { esquemaErrorApi } from '../../contrato/esquemas/error.js';
import type { esquemaModeloFotoSalida } from '../../contrato/esquemas/modelo.js';
import {
  esquemaGeneroSalida,
  esquemaModeloBomAviosCuerpo,
  esquemaModeloBomAviosLista,
  esquemaModeloBomTelasCuerpo,
  esquemaModeloBomTelasLista,
  esquemaModeloCopiarBomCuerpo,
  esquemaModeloCrear,
  esquemaModeloFichaSalida,
  esquemaModeloFotoCrear,
  esquemaModeloFotoEditarCuerpo,
  esquemaModeloFotoSubida,
  esquemaModeloFotosLista,
  esquemaModeloPatchCuerpo,
  esquemaModeloSalida,
  esquemaModelosPagina,
  esquemaModelosQuery,
} from '../../contrato/esquemas/modelo.js';
import type { Genero } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarModelo,
  crearModelo,
  descontinuarModelo,
  listarGeneros,
  listarModelos,
  type ModeloConRelaciones,
} from '../../dominio/modelos/modelos.js';
import {
  copiarArteDeOtroModelo,
  crearArte,
  actualizarArte,
  eliminarArte,
  galeriaArte,
  listarArtesModelo,
  marcarArtePrincipal,
  quitarFotoArte,
  solicitarSubidaFotoArte,
  listarFotosArte,
  type FotoArteConUrl,
  type GaleriaArteItem,
  type ModeloArteDetalle,
  type SubidaFotoArte,
} from '../../dominio/modelos/arte-modelo.js';
import {
  copiarBom,
  listarAviosBom,
  listarTelasBom,
  obtenerFichaModelo,
  reemplazarAviosBom,
  reemplazarTelasBom,
  type ModeloAvioDetalle,
  type ModeloFicha,
  type ModeloTelaDetalle,
} from '../../dominio/modelos/bom-modelo.js';
import {
  actualizarFoto,
  listarFotos,
  marcarFotoPrincipal,
  quitarFoto,
  solicitarSubidaFoto,
  type FotoModeloConUrl,
  type SubidaFotoModelo,
} from '../../dominio/modelos/fotos-modelo.js';

/** Proyecta los campos comunes del modelo (datos generales + relaciones + conteo) a JSON. */
function aModeloBase(modelo: ModeloConRelaciones): z.infer<typeof esquemaModeloSalida> {
  return {
    id: modelo.id,
    codigo: modelo.codigo,
    descripcion: modelo.descripcion,
    composicion: modelo.composicion,
    maquilaBase: modelo.maquilaBase === null ? null : modelo.maquilaBase.toNumber(),
    idTemporada: modelo.idTemporada,
    temporada: modelo.temporada?.nombre ?? null,
    idCurvaTalla: modelo.idCurvaTalla,
    curvaTalla: modelo.curvaTalla?.nombre ?? null,
    idGenero: modelo.idGenero,
    genero: modelo.genero?.nombre ?? null,
    idTipoProducto: modelo.idTipoProducto,
    tipoProducto: modelo.tipoProducto?.nombre ?? null,
    numOperaciones: modelo.numOperaciones,
    corteBase: modelo.corteBase === null ? null : modelo.corteBase.toNumber(),
    idMaquileroCotizado: modelo.idMaquileroCotizado,
    maquileroCotizado: modelo.maquileroCotizado?.nombre ?? null,
    secuenciaEstampado: modelo.secuenciaEstampado,
    llevaArte: modelo.llevaArte,
    cantidadFotos: modelo._count.fotos,
    // Solo el LISTADO resuelve la foto principal (sin N+1); en alta/edición/ficha viene `null`.
    urlFotoPrincipal: modelo.urlFotoPrincipal ?? null,
    // Agregados del listado (proto vModelos, R9): tela principal, stock PT y costo del último
    // costeo. Solo el LISTADO los resuelve; en alta/edición/ficha vienen `null` (no aplican).
    telaPrincipal: modelo.telaPrincipal ?? null,
    stockPt: modelo.stockPt ?? null,
    costoActual: modelo.costoActual ?? null,
    activo: modelo.activo,
    creadoEn: modelo.creadoEn.toISOString(),
    creadoPorId: modelo.creadoPorId,
    modificadoEn: modelo.modificadoEn.toISOString(),
    modificadoPorId: modelo.modificadoPorId,
  };
}

/** Proyecta un renglón de tela del BOM a JSON. */
function aTelaBomSalida(
  t: ModeloTelaDetalle,
): z.infer<typeof esquemaModeloBomTelasLista>['datos'][number] {
  return {
    idTela: t.idTela,
    nombre: t.nombre,
    consumoPorPrenda: t.consumoPorPrenda,
    paraPreCosto: t.paraPreCosto,
    paraProduccion: t.paraProduccion,
    paraCosto: t.paraCosto,
    idTelaProveedor: t.idTelaProveedor,
    proveedorAmarrado: t.proveedorAmarrado,
    precioPorColor: t.precioPorColor,
    precioCosteo: t.precioCosteo,
    origenPrecio: t.origenPrecio,
    proveedorPrecio: t.proveedorPrecio,
    amarreIgnorado: t.amarreIgnorado,
    precioReferencia: t.precioReferencia,
  };
}

/** Proyecta un renglón de avío del BOM a JSON. */
function aAvioBomSalida(
  a: ModeloAvioDetalle,
): z.infer<typeof esquemaModeloBomAviosLista>['datos'][number] {
  return {
    idAvio: a.idAvio,
    clave: a.clave,
    descripcion: a.descripcion,
    consumoPorPrenda: a.consumoPorPrenda,
    paraPreCosto: a.paraPreCosto,
    paraProduccion: a.paraProduccion,
    paraCosto: a.paraCosto,
    consumoPorTalla: a.consumoPorTalla,
    idAvioProveedor: a.idAvioProveedor,
    proveedorAmarrado: a.proveedorAmarrado,
    precioCosteo: a.precioCosteo,
    origenPrecio: a.origenPrecio,
    proveedorPrecio: a.proveedorPrecio,
    amarreIgnorado: a.amarreIgnorado,
    precioReferencia: a.precioReferencia,
  };
}

/** Proyecta un ARTE del modelo a JSON (la `key` de cada foto es interna: NUNCA sale). */
function aArteSalida(a: ModeloArteDetalle): z.infer<typeof esquemaArteSalida> {
  return {
    id: a.id,
    idModelo: a.idModelo,
    descripcion: a.descripcion,
    posicion: a.posicion,
    puntadas: a.puntadas,
    precio: a.precio,
    idTipoArte: a.idTipoArte,
    tipoArte: a.tipoArte,
    codigoTipoArte: a.codigoTipoArte,
    usaPuntadas: a.usaPuntadas,
    idProveedor: a.idProveedor,
    proveedor: a.proveedor,
    fotos: a.fotos.map((f) => ({ idFoto: f.idFoto, idArchivo: f.idArchivo, orden: f.orden })),
    orden: a.orden,
    creadoEn: a.creadoEn.toISOString(),
    creadoPorId: a.creadoPorId,
    modificadoEn: a.modificadoEn.toISOString(),
    modificadoPorId: a.modificadoPorId,
  };
}

/** Proyecta una celda de la galería de arte a JSON. */
function aGaleriaArteSalida(
  a: GaleriaArteItem,
): z.infer<typeof esquemaGaleriaArtePagina>['datos'][number] {
  return {
    id: a.id,
    descripcion: a.descripcion,
    posicion: a.posicion,
    idTipoArte: a.idTipoArte,
    tipoArte: a.tipoArte,
    precio: a.precio,
    idArchivoFoto: a.idArchivoFoto,
    idModelo: a.idModelo,
    claveModelo: a.claveModelo,
    nombreModelo: a.nombreModelo,
  };
}

/** Proyecta el resultado de preparar la subida de la foto de un arte a JSON. */
function aSubidaFotoArteSalida(s: SubidaFotoArte): z.infer<typeof esquemaArteFotoSubida> {
  return {
    idFoto: s.idFoto,
    idArchivo: s.idArchivo,
    nombreOriginal: s.nombreOriginal,
    urlSubida: s.urlSubida,
    expiraEnSegundos: s.expiraEnSegundos,
  };
}

/** Proyecta la foto de un arte (con URL) a JSON. */
function aFotoArteSalida(foto: FotoArteConUrl): z.infer<typeof esquemaArteFotoSalida> {
  return {
    idFoto: foto.idFoto,
    idArchivo: foto.idArchivo,
    orden: foto.orden,
    nombreOriginal: foto.nombreOriginal,
    tipoMime: foto.tipoMime,
    tamanoBytes: foto.tamanoBytes,
    urlDescarga: foto.urlDescarga,
  };
}

/** Proyecta la FICHA de un modelo (datos + BOM completo) a JSON. */
function aModeloFichaSalida(modelo: ModeloFicha): z.infer<typeof esquemaModeloFichaSalida> {
  return {
    ...aModeloBase(modelo),
    telas: modelo.telas.map(aTelaBomSalida),
    avios: modelo.avios.map(aAvioBomSalida),
    artes: modelo.artes.map(aArteSalida),
    tallasCurva: modelo.tallasCurva.map((t) => ({
      idTalla: t.idTalla,
      etiqueta: t.etiqueta,
      posicion: t.posicion,
    })),
  };
}

/** Proyecta un `Genero` a la forma JSON del selector. */
function aGeneroSalida(g: Genero): z.infer<typeof esquemaGeneroSalida> {
  return { id: g.id, nombre: g.nombre, activo: g.activo };
}

/** Proyecta el resultado de preparar la subida de una foto a JSON. */
function aSubidaFotoSalida(subida: SubidaFotoModelo): z.infer<typeof esquemaModeloFotoSubida> {
  return {
    idFoto: subida.idFoto,
    idArchivo: subida.idArchivo,
    nombreOriginal: subida.nombreOriginal,
    urlSubida: subida.urlSubida,
    expiraEnSegundos: subida.expiraEnSegundos,
  };
}

/** Proyecta una foto (con URL) a JSON. */
function aFotoSalida(foto: FotoModeloConUrl): z.infer<typeof esquemaModeloFotoSalida> {
  return {
    idFoto: foto.idFoto,
    idArchivo: foto.idArchivo,
    tipo: foto.tipo,
    orden: foto.orden,
    nombreOriginal: foto.nombreOriginal,
    tipoMime: foto.tipoMime,
    tamanoBytes: foto.tamanoBytes,
    urlDescarga: foto.urlDescarga,
  };
}

/** Parámetro de ruta `:id` (entero positivo). Reutilizado por las rutas del modelo. */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id del modelo debe ser un número' })
    .int({ error: 'El id del modelo debe ser entero' })
    .positive({ error: 'El id del modelo debe ser positivo' })
    .describe('Id del modelo.'),
});

/** Parámetros `:id` (modelo) + `:idFoto` (foto) para editar/quitar una foto. */
const esquemaParamFoto = z.object({
  id: z.coerce
    .number({ error: 'El id del modelo debe ser un número' })
    .int()
    .positive()
    .describe('Id del modelo.'),
  idFoto: z.coerce
    .number({ error: 'El id de la foto debe ser un número' })
    .int()
    .positive()
    .describe('Id de la foto.'),
});

/** Parámetros `:id` (modelo) + `:idArte` (arte del modelo). */
const esquemaParamArte = z.object({
  id: z.coerce
    .number({ error: 'El id del modelo debe ser un número' })
    .int()
    .positive()
    .describe('Id del modelo.'),
  idArte: z.coerce
    .number({ error: 'El id del arte debe ser un número' })
    .int()
    .positive()
    .describe('Id del arte (bordado/estampado) del modelo.'),
});

/** Parámetros `:id` (modelo) + `:idArte` + `:idFoto` (una foto del arte, V1-E3f). */
const esquemaParamArteFoto = esquemaParamArte.extend({
  idFoto: z.coerce
    .number({ error: 'El id de la foto debe ser un número' })
    .int()
    .positive()
    .describe('Id de la foto del arte.'),
});

/** Querystring del selector de géneros. */
const esquemaGenerosQuery = z.object({
  incluirInactivos: z
    .stringbool()
    .default(false)
    .describe('Incluye los géneros desactivados ("true"/"false").'),
});

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de modelos (montadas bajo `/api`). */
export const rutasModelos: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Selector de géneros (catálogo, bajo modelos.ver) ────────────────────────
  app.route({
    method: 'GET',
    url: '/generos',
    preHandler: app.conPermiso('modelos.ver'),
    schema: {
      tags: ['modelos'],
      summary: 'Listar géneros (catálogo selector)',
      security: SEGURIDAD_SESION,
      querystring: esquemaGenerosQuery,
      response: { 200: z.array(esquemaGeneroSalida), ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const generos = await listarGeneros(sesion, {
        incluirInactivos: request.query.incluirInactivos,
      });
      return generos.map(aGeneroSalida);
    },
  });

  // ── Listar modelos (búsqueda + filtro temporada + orden + paginación servidor) ─
  app.route({
    method: 'GET',
    url: '/modelos',
    preHandler: app.conPermiso('modelos.ver'),
    schema: {
      tags: ['modelos'],
      summary: 'Listar modelos',
      security: SEGURIDAD_SESION,
      querystring: esquemaModelosQuery,
      response: { 200: esquemaModelosPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await listarModelos(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aModeloBase) };
    },
  });

  // ── Obtener la FICHA de un modelo (datos + BOM completo) ────────────────────
  app.route({
    method: 'GET',
    url: '/modelos/:id',
    preHandler: app.conPermiso('modelos.ver'),
    schema: {
      tags: ['modelos'],
      summary: 'Obtener la ficha de un modelo (con su BOM)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaModeloFichaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aModeloFichaSalida(await obtenerFichaModelo(sesion, request.params.id));
    },
  });

  // ── Crear modelo ─────────────────────────────────────────────────────────────
  app.route({
    method: 'POST',
    url: '/modelos',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Crear un modelo',
      security: SEGURIDAD_SESION,
      body: esquemaModeloCrear,
      response: { 201: esquemaModeloSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const modelo = await crearModelo(sesion, request.body);
      return reply.code(201).send(aModeloBase(modelo));
    },
  });

  // ── Actualizar modelo (parcial; descontinuar/reactivar con `activo`) ────────
  app.route({
    method: 'PATCH',
    url: '/modelos/:id',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Actualizar un modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaModeloPatchCuerpo,
      response: { 200: esquemaModeloSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const modelo = await actualizarModelo(sesion, { ...request.body, id: request.params.id });
      return aModeloBase(modelo);
    },
  });

  // ── Descontinuar (borrado SUAVE) ────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/modelos/:id',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Descontinuar un modelo (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaModeloSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aModeloBase(await descontinuarModelo(sesion, request.params.id));
    },
  });

  // ══ BOM — telas ════════════════════════════════════════════════════════════════

  app.route({
    method: 'GET',
    url: '/modelos/:id/bom/telas',
    preHandler: app.conPermiso('modelos.ver'),
    schema: {
      tags: ['modelos'],
      summary: 'Listar las telas del BOM de un modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaModeloBomTelasLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const telas = await listarTelasBom(sesion, request.params.id);
      return { datos: telas.map(aTelaBomSalida) };
    },
  });

  app.route({
    method: 'PUT',
    url: '/modelos/:id/bom/telas',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Reemplazar el set completo de telas del BOM',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaModeloBomTelasCuerpo,
      response: { 200: esquemaModeloBomTelasLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const telas = await reemplazarTelasBom(sesion, request.params.id, request.body.telas);
      return { datos: telas.map(aTelaBomSalida) };
    },
  });

  // ══ BOM — avíos ════════════════════════════════════════════════════════════════

  app.route({
    method: 'GET',
    url: '/modelos/:id/bom/avios',
    preHandler: app.conPermiso('modelos.ver'),
    schema: {
      tags: ['modelos'],
      summary: 'Listar los avíos del BOM de un modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaModeloBomAviosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const avios = await listarAviosBom(sesion, request.params.id);
      return { datos: avios.map(aAvioBomSalida) };
    },
  });

  app.route({
    method: 'PUT',
    url: '/modelos/:id/bom/avios',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Reemplazar el set completo de avíos del BOM',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaModeloBomAviosCuerpo,
      response: { 200: esquemaModeloBomAviosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const avios = await reemplazarAviosBom(sesion, request.params.id, request.body.avios);
      return { datos: avios.map(aAvioBomSalida) };
    },
  });

  // ══ ARTE del modelo (V1-E3d, §Post-F9.35) ════════════════════════════════════════
  // CRUD renglón por renglón (no un PUT de conjunto como telas/avíos): el arte tiene FOTO.

  app.route({
    method: 'GET',
    url: '/modelos/:id/artes',
    preHandler: app.conPermiso('modelos.ver'),
    schema: {
      tags: ['modelos'],
      summary: 'Listar el arte (bordados/estampados) de un modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaArtesLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const artes = await listarArtesModelo(sesion, request.params.id);
      return { datos: artes.map(aArteSalida) };
    },
  });

  app.route({
    method: 'POST',
    url: '/modelos/:id/artes',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Agregar un arte al modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaArteCrear,
      response: { 201: esquemaArteSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const arte = await crearArte(sesion, request.params.id, request.body);
      return reply.code(201).send(aArteSalida(arte));
    },
  });

  app.route({
    method: 'PATCH',
    url: '/modelos/:id/artes/:idArte',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Editar un arte del modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamArte,
      body: esquemaArtePatchCuerpo,
      response: { 200: esquemaArteSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const arte = await actualizarArte(sesion, request.params.id, {
        ...request.body,
        id: request.params.idArte,
      });
      return aArteSalida(arte);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/modelos/:id/artes/:idArte',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Quitar un arte del modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamArte,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await eliminarArte(sesion, request.params.id, request.params.idArte);
      return reply.code(204).send(null);
    },
  });

  // Marcar UN arte como el PRINCIPAL del modelo (lo mueve al primer lugar y reindexa el resto).
  app.route({
    method: 'POST',
    url: '/modelos/:id/artes/:idArte/principal',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Marcar un arte como el principal del modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamArte,
      response: { 200: esquemaArtesLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const artes = await marcarArtePrincipal(sesion, request.params.id, request.params.idArte);
      return { datos: artes.map(aArteSalida) };
    },
  });

  // Copiar a este modelo un arte que ya existe en OTRO (la conveniencia que daba el catálogo).
  app.route({
    method: 'POST',
    url: '/modelos/:id/artes/copiar',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Copiar a este modelo un arte de otro modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaArteCopiarCuerpo,
      response: { 201: esquemaArteSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const arte = await copiarArteDeOtroModelo(sesion, request.params.id, request.body);
      return reply.code(201).send(aArteSalida(arte));
    },
  });

  // ── Fotos del arte en R2 (presigned; PLURALES desde V1-E3f, §Post-F9.52 punto 5) ──
  app.route({
    method: 'POST',
    url: '/modelos/:id/artes/:idArte/fotos',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Preparar la subida de una foto de un arte (URL prefirmada)',
      security: SEGURIDAD_SESION,
      params: esquemaParamArte,
      body: esquemaArteFotoCrear,
      response: { 201: esquemaArteFotoSubida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const subida = await solicitarSubidaFotoArte(
        sesion,
        request.params.id,
        request.params.idArte,
        request.body,
      );
      return reply.code(201).send(aSubidaFotoArteSalida(subida));
    },
  });

  app.route({
    method: 'GET',
    url: '/modelos/:id/artes/:idArte/fotos',
    preHandler: app.conPermiso('modelos.ver'),
    schema: {
      tags: ['modelos'],
      summary: 'Listar las fotos de un arte (URLs prefirmadas de descarga)',
      security: SEGURIDAD_SESION,
      params: esquemaParamArte,
      response: { 200: esquemaArteFotosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const fotos = await listarFotosArte(sesion, request.params.id, request.params.idArte);
      return { datos: fotos.map(aFotoArteSalida) };
    },
  });

  app.route({
    method: 'DELETE',
    url: '/modelos/:id/artes/:idArte/fotos/:idFoto',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Quitar una foto de un arte',
      security: SEGURIDAD_SESION,
      params: esquemaParamArteFoto,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await quitarFotoArte(
        sesion,
        request.params.id,
        request.params.idArte,
        request.params.idFoto,
      );
      return reply.code(204).send(null);
    },
  });

  // ── Galería de arte: TODO el arte de TODOS los modelos, cada foto con su modelo ──
  app.route({
    method: 'GET',
    url: '/artes',
    preHandler: app.conPermiso('modelos.ver'),
    schema: {
      tags: ['modelos'],
      summary: 'Galería de arte (armada desde los modelos)',
      security: SEGURIDAD_SESION,
      querystring: esquemaGaleriaArteQuery,
      response: { 200: esquemaGaleriaArtePagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const pagina = await galeriaArte(sesion, request.query);
      return { ...pagina, datos: pagina.datos.map(aGaleriaArteSalida) };
    },
  });

  // ── Copiar el BOM de otro modelo (atómico) ──────────────────────────────────
  app.route({
    method: 'POST',
    url: '/modelos/:id/copiar-bom',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Copiar la receta (BOM) de otro modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaModeloCopiarBomCuerpo,
      response: {
        200: z.object({
          telas: esquemaModeloBomTelasLista.shape.datos,
          avios: esquemaModeloBomAviosLista.shape.datos,
          artes: esquemaArtesLista.shape.datos,
        }),
        ...respuestasError,
      },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const bom = await copiarBom(sesion, request.params.id, request.body);
      return {
        telas: bom.telas.map(aTelaBomSalida),
        avios: bom.avios.map(aAvioBomSalida),
        artes: bom.artes.map(aArteSalida),
      };
    },
  });

  // ══ Fotos en R2 (N por modelo, vía presigned) ════════════════════════════════════

  // Preparar la subida de una foto (devuelve URL PUT prefirmada).
  app.route({
    method: 'POST',
    url: '/modelos/:id/fotos',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Preparar la subida de una foto del modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaModeloFotoCrear,
      response: { 201: esquemaModeloFotoSubida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const subida = await solicitarSubidaFoto(sesion, request.params.id, request.body);
      return reply.code(201).send(aSubidaFotoSalida(subida));
    },
  });

  // Listar las fotos de un modelo (cada una con URL GET prefirmada).
  app.route({
    method: 'GET',
    url: '/modelos/:id/fotos',
    preHandler: app.conPermiso('modelos.ver'),
    schema: {
      tags: ['modelos'],
      summary: 'Listar las fotos de un modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaModeloFotosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const fotos = await listarFotos(sesion, request.params.id);
      return { datos: fotos.map(aFotoSalida) };
    },
  });

  // Actualizar los metadatos de una foto (tipo/orden).
  app.route({
    method: 'PATCH',
    url: '/modelos/:id/fotos/:idFoto',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Actualizar los metadatos de una foto (tipo/orden)',
      security: SEGURIDAD_SESION,
      params: esquemaParamFoto,
      body: esquemaModeloFotoEditarCuerpo,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await actualizarFoto(sesion, request.params.id, request.params.idFoto, request.body);
      return reply.code(204).send(null);
    },
  });

  // Marcar UNA foto como la PRINCIPAL del modelo (la mueve al primer lugar y reindexa el resto).
  app.route({
    method: 'POST',
    url: '/modelos/:id/fotos/:idFoto/principal',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Marcar una foto como la principal del modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamFoto,
      response: { 200: esquemaModeloFotosLista, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const fotos = await marcarFotoPrincipal(sesion, request.params.id, request.params.idFoto);
      return { datos: fotos.map(aFotoSalida) };
    },
  });

  // Quitar una foto del modelo.
  app.route({
    method: 'DELETE',
    url: '/modelos/:id/fotos/:idFoto',
    preHandler: app.conPermiso('modelos.administrar'),
    schema: {
      tags: ['modelos'],
      summary: 'Quitar una foto del modelo',
      security: SEGURIDAD_SESION,
      params: esquemaParamFoto,
      response: { 204: z.null(), ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      await quitarFoto(sesion, request.params.id, request.params.idFoto);
      return reply.code(204).send(null);
    },
  });

  done();
};
