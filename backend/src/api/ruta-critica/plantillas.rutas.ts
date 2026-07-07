/**
 * Rutas REST de PLANTILLAS DE RUTA, REGLAS DE DURACIÓN, FAMILIAS/ARTÍCULOS y CALENDARIO LABORAL de
 * la Ruta Crítica (Módulo 8, F5-E2; doc 08-Ruta-Critica). Handlers delgados (A1): validan (Zod
 * compartido), autorizan (`conPermiso`, A4) y delegan al dominio. RBAC por ruta: GET →
 * `rc.catalogo-ver`; mutaciones → `rc.catalogo-administrar` (reusa los permisos de E1, sin crear
 * nuevos). El colchón de costura por empresa NO se duplica aquí: vive en
 * `/api/empresas/:id/configuracion` (campo `colchonCostura`).
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaArticuloCrear,
  esquemaArticuloPatchCuerpo,
  esquemaArticuloSalida,
  esquemaCalendarioActualizar,
  esquemaCalendarioSalida,
  esquemaDuracionAplicacionCrear,
  esquemaDuracionAplicacionPatchCuerpo,
  esquemaDuracionAplicacionSalida,
  esquemaDuracionTelaCrear,
  esquemaDuracionTelaPatchCuerpo,
  esquemaDuracionTelaSalida,
  esquemaErrorApi,
  esquemaFactorCantidadCrear,
  esquemaFactorCantidadPatchCuerpo,
  esquemaFactorCantidadSalida,
  esquemaFamiliaCrear,
  esquemaFamiliaPatchCuerpo,
  esquemaFamiliaSalida,
  esquemaFestivoCrear,
  esquemaFestivoPatchCuerpo,
  esquemaFestivoSalida,
  esquemaListarRcQuery,
  esquemaPlantillaCrear,
  esquemaPlantillaPatchCuerpo,
  esquemaPlantillaSalida,
  esquemaRangoDificultadCrear,
  esquemaRangoDificultadPatchCuerpo,
  esquemaRangoDificultadSalida,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  actualizarArticulo,
  actualizarFamilia,
  crearArticulo,
  crearFamilia,
  desactivarArticulo,
  desactivarFamilia,
  listarArticulos,
  listarFamilias,
  type ArticuloDto,
  type FamiliaDto,
} from '../../dominio/ruta-critica/familiasArticulos.js';
import {
  actualizarDuracionAplicacion,
  actualizarDuracionTela,
  actualizarFactorCantidad,
  crearDuracionAplicacion,
  crearDuracionTela,
  crearFactorCantidad,
  desactivarDuracionAplicacion,
  desactivarDuracionTela,
  desactivarFactorCantidad,
  actualizarRangoDificultad,
  crearRangoDificultad,
  desactivarRangoDificultad,
  listarDuracionesAplicacion,
  listarDuracionesTela,
  listarFactoresCantidad,
  listarRangosDificultad,
  type DuracionAplicacionDto,
  type DuracionTelaDto,
  type FactorCantidadDto,
  type RangoDificultadDto,
} from '../../dominio/ruta-critica/reglasDuracion.js';
import {
  actualizarFestivo,
  actualizarCalendario,
  crearFestivo,
  desactivarFestivo,
  listarFestivos,
  obtenerCalendario,
  type CalendarioDto,
  type FestivoDto,
} from '../../dominio/ruta-critica/calendarioLaboral.js';
import {
  actualizarPlantilla,
  crearPlantilla,
  desactivarPlantilla,
  listarPlantillas,
  obtenerPlantilla,
  type PlantillaDto,
} from '../../dominio/ruta-critica/plantillasRuta.js';

// ── Proyecciones (DTO de dominio → JSON del contrato, fechas ISO) ─────────────

function aFamiliaSalida(f: FamiliaDto): z.infer<typeof esquemaFamiliaSalida> {
  return {
    id: f.id,
    nombre: f.nombre,
    activo: f.activo,
    creadoEn: f.creadoEn.toISOString(),
    creadoPorId: f.creadoPorId,
    modificadoEn: f.modificadoEn.toISOString(),
    modificadoPorId: f.modificadoPorId,
  };
}

function aArticuloSalida(a: ArticuloDto): z.infer<typeof esquemaArticuloSalida> {
  return {
    id: a.id,
    nombre: a.nombre,
    idFamiliaArticulo: a.idFamiliaArticulo,
    familia: a.familia,
    activo: a.activo,
    creadoEn: a.creadoEn.toISOString(),
    creadoPorId: a.creadoPorId,
    modificadoEn: a.modificadoEn.toISOString(),
    modificadoPorId: a.modificadoPorId,
  };
}

function aPlantillaSalida(p: PlantillaDto): z.infer<typeof esquemaPlantillaSalida> {
  return {
    id: p.id,
    nombre: p.nombre,
    idFamiliaArticulo: p.idFamiliaArticulo,
    familia: p.familia,
    idArticuloRC: p.idArticuloRC,
    articulo: p.articulo,
    activo: p.activo,
    procesos: p.procesos.map((r) => ({
      id: r.id,
      idProcesoDef: r.idProcesoDef,
      codigoProceso: r.codigoProceso,
      nombreProceso: r.nombreProceso,
      tiempoEstandar: r.tiempoEstandar,
      orden: r.orden,
      idsAntecesores: r.idsAntecesores,
    })),
    creadoEn: p.creadoEn.toISOString(),
    creadoPorId: p.creadoPorId,
    modificadoEn: p.modificadoEn.toISOString(),
    modificadoPorId: p.modificadoPorId,
  };
}

function aFactorSalida(f: FactorCantidadDto): z.infer<typeof esquemaFactorCantidadSalida> {
  return {
    id: f.id,
    deCant: f.deCant,
    aCant: f.aCant,
    factor: f.factor,
    activo: f.activo,
    creadoEn: f.creadoEn.toISOString(),
    creadoPorId: f.creadoPorId,
    modificadoEn: f.modificadoEn.toISOString(),
    modificadoPorId: f.modificadoPorId,
  };
}

function aRangoDificultadSalida(
  r: RangoDificultadDto,
): z.infer<typeof esquemaRangoDificultadSalida> {
  return {
    id: r.id,
    opsDesde: r.opsDesde,
    opsHasta: r.opsHasta,
    nombre: r.nombre,
    diasCostura: r.diasCostura,
    activo: r.activo,
    creadoEn: r.creadoEn.toISOString(),
    creadoPorId: r.creadoPorId,
    modificadoEn: r.modificadoEn.toISOString(),
    modificadoPorId: r.modificadoPorId,
  };
}

function aTelaSalida(t: DuracionTelaDto): z.infer<typeof esquemaDuracionTelaSalida> {
  return {
    id: t.id,
    nombre: t.nombre,
    dias: t.dias,
    factorTela: t.factorTela,
    activo: t.activo,
    creadoEn: t.creadoEn.toISOString(),
    creadoPorId: t.creadoPorId,
    modificadoEn: t.modificadoEn.toISOString(),
    modificadoPorId: t.modificadoPorId,
  };
}

function aAplicacionSalida(
  a: DuracionAplicacionDto,
): z.infer<typeof esquemaDuracionAplicacionSalida> {
  return {
    id: a.id,
    nombre: a.nombre,
    clave: a.clave,
    dias: a.dias,
    factor: a.factor,
    activo: a.activo,
    creadoEn: a.creadoEn.toISOString(),
    creadoPorId: a.creadoPorId,
    modificadoEn: a.modificadoEn.toISOString(),
    modificadoPorId: a.modificadoPorId,
  };
}

function aCalendarioSalida(c: CalendarioDto): z.infer<typeof esquemaCalendarioSalida> {
  return {
    idEmpresa: c.idEmpresa,
    lunes: c.lunes,
    martes: c.martes,
    miercoles: c.miercoles,
    jueves: c.jueves,
    viernes: c.viernes,
    sabado: c.sabado,
    domingo: c.domingo,
    creadoEn: c.creadoEn.toISOString(),
    creadoPorId: c.creadoPorId,
    modificadoEn: c.modificadoEn.toISOString(),
    modificadoPorId: c.modificadoPorId,
  };
}

function aFestivoSalida(f: FestivoDto): z.infer<typeof esquemaFestivoSalida> {
  return {
    id: f.id,
    idEmpresa: f.idEmpresa,
    fecha: f.fecha,
    descripcion: f.descripcion,
    activo: f.activo,
    creadoEn: f.creadoEn.toISOString(),
    creadoPorId: f.creadoPorId,
    modificadoEn: f.modificadoEn.toISOString(),
    modificadoPorId: f.modificadoPorId,
  };
}

/** Parámetro de ruta `:id` (entero positivo). */
const esquemaParamId = z.object({
  id: z.coerce
    .number({ error: 'El id debe ser un número' })
    .int({ error: 'El id debe ser entero' })
    .positive({ error: 'El id debe ser positivo' })
    .describe('Id del recurso.'),
});

/** Parámetro de ruta `:idEmpresa` (entero positivo). */
const esquemaParamEmpresa = z.object({
  idEmpresa: z.coerce
    .number({ error: 'El id de la empresa debe ser un número' })
    .int({ error: 'El id de la empresa debe ser entero' })
    .positive({ error: 'El id de la empresa debe ser positivo' })
    .describe('Id de la empresa.'),
});

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de plantillas/reglas/calendario de la RC (montadas bajo `/api`). */
export const rutasPlantillasRc: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Familias ────────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/ruta-critica/familias',
    preHandler: app.conPermiso('rc.catalogo-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Listar familias de artículos de la RC',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarRcQuery,
      response: { 200: z.array(esquemaFamiliaSalida), ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const filas = await listarFamilias(sesion, request.query.incluirInactivos);
      return filas.map(aFamiliaSalida);
    },
  });
  app.route({
    method: 'POST',
    url: '/ruta-critica/familias',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Crear una familia de artículos',
      security: SEGURIDAD_SESION,
      body: esquemaFamiliaCrear,
      response: { 201: esquemaFamiliaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const familia = await crearFamilia(sesion, request.body);
      return reply.code(201).send(aFamiliaSalida(familia));
    },
  });
  app.route({
    method: 'PATCH',
    url: '/ruta-critica/familias/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Actualizar una familia de artículos',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaFamiliaPatchCuerpo,
      response: { 200: esquemaFamiliaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aFamiliaSalida(await actualizarFamilia(sesion, request.params.id, request.body));
    },
  });
  app.route({
    method: 'DELETE',
    url: '/ruta-critica/familias/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Desactivar una familia de artículos (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaFamiliaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aFamiliaSalida(await desactivarFamilia(sesion, request.params.id));
    },
  });

  // ── Artículos ─────────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/ruta-critica/articulos',
    preHandler: app.conPermiso('rc.catalogo-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Listar artículos de la RC',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarRcQuery,
      response: { 200: z.array(esquemaArticuloSalida), ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const filas = await listarArticulos(sesion, request.query.incluirInactivos);
      return filas.map(aArticuloSalida);
    },
  });
  app.route({
    method: 'POST',
    url: '/ruta-critica/articulos',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Crear un artículo de la RC',
      security: SEGURIDAD_SESION,
      body: esquemaArticuloCrear,
      response: { 201: esquemaArticuloSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const articulo = await crearArticulo(sesion, request.body);
      return reply.code(201).send(aArticuloSalida(articulo));
    },
  });
  app.route({
    method: 'PATCH',
    url: '/ruta-critica/articulos/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Actualizar un artículo de la RC',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaArticuloPatchCuerpo,
      response: { 200: esquemaArticuloSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aArticuloSalida(await actualizarArticulo(sesion, request.params.id, request.body));
    },
  });
  app.route({
    method: 'DELETE',
    url: '/ruta-critica/articulos/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Desactivar un artículo de la RC (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaArticuloSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aArticuloSalida(await desactivarArticulo(sesion, request.params.id));
    },
  });

  // ── Plantillas de ruta ──────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/ruta-critica/plantillas',
    preHandler: app.conPermiso('rc.catalogo-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Listar plantillas de ruta',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarRcQuery,
      response: { 200: z.array(esquemaPlantillaSalida), ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const filas = await listarPlantillas(sesion, request.query.incluirInactivos);
      return filas.map(aPlantillaSalida);
    },
  });
  app.route({
    method: 'GET',
    url: '/ruta-critica/plantillas/:id',
    preHandler: app.conPermiso('rc.catalogo-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Obtener una plantilla de ruta',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaPlantillaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aPlantillaSalida(await obtenerPlantilla(sesion, request.params.id));
    },
  });
  app.route({
    method: 'POST',
    url: '/ruta-critica/plantillas',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Crear una plantilla de ruta',
      security: SEGURIDAD_SESION,
      body: esquemaPlantillaCrear,
      response: { 201: esquemaPlantillaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const plantilla = await crearPlantilla(sesion, request.body);
      return reply.code(201).send(aPlantillaSalida(plantilla));
    },
  });
  app.route({
    method: 'PATCH',
    url: '/ruta-critica/plantillas/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Actualizar una plantilla de ruta (encabezado y/o set de procesos)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaPlantillaPatchCuerpo,
      response: { 200: esquemaPlantillaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aPlantillaSalida(await actualizarPlantilla(sesion, request.params.id, request.body));
    },
  });
  app.route({
    method: 'DELETE',
    url: '/ruta-critica/plantillas/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Desactivar una plantilla de ruta (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaPlantillaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aPlantillaSalida(await desactivarPlantilla(sesion, request.params.id));
    },
  });

  // ── Reglas de duración: factor por cantidad ──────────────────────────────────
  app.route({
    method: 'GET',
    url: '/ruta-critica/reglas-duracion/cantidad',
    preHandler: app.conPermiso('rc.catalogo-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Listar factores de duración por cantidad',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarRcQuery,
      response: { 200: z.array(esquemaFactorCantidadSalida), ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const filas = await listarFactoresCantidad(sesion, request.query.incluirInactivos);
      return filas.map(aFactorSalida);
    },
  });
  app.route({
    method: 'POST',
    url: '/ruta-critica/reglas-duracion/cantidad',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Crear un factor de duración por cantidad',
      security: SEGURIDAD_SESION,
      body: esquemaFactorCantidadCrear,
      response: { 201: esquemaFactorCantidadSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const fila = await crearFactorCantidad(sesion, request.body);
      return reply.code(201).send(aFactorSalida(fila));
    },
  });
  app.route({
    method: 'PATCH',
    url: '/ruta-critica/reglas-duracion/cantidad/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Actualizar un factor de duración por cantidad',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaFactorCantidadPatchCuerpo,
      response: { 200: esquemaFactorCantidadSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aFactorSalida(await actualizarFactorCantidad(sesion, request.params.id, request.body));
    },
  });
  app.route({
    method: 'DELETE',
    url: '/ruta-critica/reglas-duracion/cantidad/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Desactivar un factor de duración por cantidad (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaFactorCantidadSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aFactorSalida(await desactivarFactorCantidad(sesion, request.params.id));
    },
  });

  // ── Reglas de duración: días por tipo de tela ─────────────────────────────────
  app.route({
    method: 'GET',
    url: '/ruta-critica/reglas-duracion/tela',
    preHandler: app.conPermiso('rc.catalogo-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Listar días de duración por tipo de tela',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarRcQuery,
      response: { 200: z.array(esquemaDuracionTelaSalida), ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const filas = await listarDuracionesTela(sesion, request.query.incluirInactivos);
      return filas.map(aTelaSalida);
    },
  });
  app.route({
    method: 'POST',
    url: '/ruta-critica/reglas-duracion/tela',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Crear una duración por tipo de tela',
      security: SEGURIDAD_SESION,
      body: esquemaDuracionTelaCrear,
      response: { 201: esquemaDuracionTelaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const fila = await crearDuracionTela(sesion, request.body);
      return reply.code(201).send(aTelaSalida(fila));
    },
  });
  app.route({
    method: 'PATCH',
    url: '/ruta-critica/reglas-duracion/tela/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Actualizar una duración por tipo de tela',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaDuracionTelaPatchCuerpo,
      response: { 200: esquemaDuracionTelaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aTelaSalida(await actualizarDuracionTela(sesion, request.params.id, request.body));
    },
  });
  app.route({
    method: 'DELETE',
    url: '/ruta-critica/reglas-duracion/tela/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Desactivar una duración por tipo de tela (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaDuracionTelaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aTelaSalida(await desactivarDuracionTela(sesion, request.params.id));
    },
  });

  // ── Reglas de duración: días por aplicación ───────────────────────────────────
  app.route({
    method: 'GET',
    url: '/ruta-critica/reglas-duracion/aplicacion',
    preHandler: app.conPermiso('rc.catalogo-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Listar días de duración por aplicación',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarRcQuery,
      response: { 200: z.array(esquemaDuracionAplicacionSalida), ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const filas = await listarDuracionesAplicacion(sesion, request.query.incluirInactivos);
      return filas.map(aAplicacionSalida);
    },
  });
  app.route({
    method: 'POST',
    url: '/ruta-critica/reglas-duracion/aplicacion',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Crear una duración por aplicación',
      security: SEGURIDAD_SESION,
      body: esquemaDuracionAplicacionCrear,
      response: { 201: esquemaDuracionAplicacionSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const fila = await crearDuracionAplicacion(sesion, request.body);
      return reply.code(201).send(aAplicacionSalida(fila));
    },
  });
  app.route({
    method: 'PATCH',
    url: '/ruta-critica/reglas-duracion/aplicacion/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Actualizar una duración por aplicación',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaDuracionAplicacionPatchCuerpo,
      response: { 200: esquemaDuracionAplicacionSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aAplicacionSalida(
        await actualizarDuracionAplicacion(sesion, request.params.id, request.body),
      );
    },
  });
  app.route({
    method: 'DELETE',
    url: '/ruta-critica/reglas-duracion/aplicacion/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Desactivar una duración por aplicación (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaDuracionAplicacionSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aAplicacionSalida(await desactivarDuracionAplicacion(sesion, request.params.id));
    },
  });

  // ── Reglas de duración: rangos de DIFICULTAD por # de operaciones (R4, B7) ────
  app.route({
    method: 'GET',
    url: '/ruta-critica/reglas-duracion/dificultad',
    preHandler: app.conPermiso('rc.catalogo-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Listar los rangos de dificultad por # de operaciones (tabla configurable)',
      security: SEGURIDAD_SESION,
      querystring: esquemaListarRcQuery,
      response: { 200: z.array(esquemaRangoDificultadSalida), ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const filas = await listarRangosDificultad(sesion, request.query.incluirInactivos);
      return filas.map(aRangoDificultadSalida);
    },
  });
  app.route({
    method: 'POST',
    url: '/ruta-critica/reglas-duracion/dificultad',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Crear un rango de dificultad (valida que no se solape con los activos)',
      security: SEGURIDAD_SESION,
      body: esquemaRangoDificultadCrear,
      response: { 201: esquemaRangoDificultadSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const fila = await crearRangoDificultad(sesion, request.body);
      return reply.code(201).send(aRangoDificultadSalida(fila));
    },
  });
  app.route({
    method: 'PATCH',
    url: '/ruta-critica/reglas-duracion/dificultad/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Actualizar un rango de dificultad',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaRangoDificultadPatchCuerpo,
      response: { 200: esquemaRangoDificultadSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aRangoDificultadSalida(
        await actualizarRangoDificultad(sesion, request.params.id, request.body),
      );
    },
  });
  app.route({
    method: 'DELETE',
    url: '/ruta-critica/reglas-duracion/dificultad/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Desactivar un rango de dificultad (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaRangoDificultadSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aRangoDificultadSalida(await desactivarRangoDificultad(sesion, request.params.id));
    },
  });

  // ── Calendario laboral por empresa ────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/ruta-critica/calendario/:idEmpresa',
    preHandler: app.conPermiso('rc.catalogo-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Obtener el calendario laboral de una empresa',
      security: SEGURIDAD_SESION,
      params: esquemaParamEmpresa,
      response: { 200: esquemaCalendarioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aCalendarioSalida(await obtenerCalendario(sesion, request.params.idEmpresa));
    },
  });
  app.route({
    method: 'PUT',
    url: '/ruta-critica/calendario/:idEmpresa',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Fijar el calendario laboral de una empresa (días hábiles de la semana)',
      security: SEGURIDAD_SESION,
      params: esquemaParamEmpresa,
      body: esquemaCalendarioActualizar,
      response: { 200: esquemaCalendarioSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aCalendarioSalida(
        await actualizarCalendario(sesion, request.params.idEmpresa, request.body),
      );
    },
  });

  // ── Días festivos por empresa ─────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/ruta-critica/calendario/:idEmpresa/festivos',
    preHandler: app.conPermiso('rc.catalogo-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Listar los días festivos de una empresa',
      security: SEGURIDAD_SESION,
      params: esquemaParamEmpresa,
      querystring: esquemaListarRcQuery,
      response: { 200: z.array(esquemaFestivoSalida), ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const filas = await listarFestivos(
        sesion,
        request.params.idEmpresa,
        request.query.incluirInactivos,
      );
      return filas.map(aFestivoSalida);
    },
  });
  app.route({
    method: 'POST',
    url: '/ruta-critica/calendario/:idEmpresa/festivos',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Crear un día festivo para una empresa',
      security: SEGURIDAD_SESION,
      params: esquemaParamEmpresa,
      body: esquemaFestivoCrear,
      response: { 201: esquemaFestivoSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      // El idEmpresa de la URL manda: se fuerza para que el cuerpo no pueda apuntar a otra empresa.
      const fila = await crearFestivo(sesion, {
        ...request.body,
        idEmpresa: request.params.idEmpresa,
      });
      return reply.code(201).send(aFestivoSalida(fila));
    },
  });
  app.route({
    method: 'PATCH',
    url: '/ruta-critica/calendario/festivos/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Actualizar un día festivo',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaFestivoPatchCuerpo,
      response: { 200: esquemaFestivoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aFestivoSalida(await actualizarFestivo(sesion, request.params.id, request.body));
    },
  });
  app.route({
    method: 'DELETE',
    url: '/ruta-critica/calendario/festivos/:id',
    preHandler: app.conPermiso('rc.catalogo-administrar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Desactivar un día festivo (borrado suave)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaFestivoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return aFestivoSalida(await desactivarFestivo(sesion, request.params.id));
    },
  });

  done();
};
