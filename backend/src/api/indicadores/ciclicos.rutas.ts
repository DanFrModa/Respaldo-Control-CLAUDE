/**
 * Rutas REST del INVENTARIO CÍCLICO (Módulo Indicadores / Almacén, F7-E5; doc 05 §Almacén; ← forms
 * `Alm_IC_*`). Handlers DELGADOS (A1): validan (Zod de `src/contrato`), autorizan (guards de
 * `auth/plugin`, A4) y delegan al dominio `dominio/indicadores/inventario-ciclico.ts`. Alta congela el
 * teórico (D6), conteo CIEGO (`indicadores.ciclicos-conteo`), exactitud + ajuste como MOVIMIENTO de
 * kardex (`indicadores.ciclicos-consulta`, D3). A9 por empresa activa.
 */
import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaErrorApi,
  esquemaInventarioCiclicoCancelar,
  esquemaInventarioCiclicoConteo,
  esquemaInventarioCiclicoCrear,
  esquemaInventarioCiclicoResumen,
  esquemaInventariosCiclicosPagina,
  esquemaInventariosCiclicosQuery,
  esquemaConteoSalida,
  esquemaExactitudSalida,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  cancelarInventarioCiclico,
  capturarConteo,
  consultarExactitud,
  crearInventarioCiclico,
  generarAjusteCiclico,
  listarInventariosCiclicos,
  obtenerConteo,
  obtenerResumen,
} from '../../dominio/indicadores/inventario-ciclico.js';
import { impresoHojaConteo } from '../../dominio/indicadores/impresos/hoja-conteo-pdf.js';

const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

const esquemaParamId = z.object({ id: z.coerce.number().int().positive() });

/** Registra las rutas de inventarios cíclicos (montadas bajo `/api`). */
export const rutasCiclicos: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) throw new Error('Ruta protegida sin sesión: falta el guard.');
    return sesion;
  };
  // Lecturas compartidas (listado/cabecera): cualquiera de los tres permisos del módulo.
  const guardAlguno = app.conAlgunPermiso(
    'indicadores.ciclicos-alta',
    'indicadores.ciclicos-conteo',
    'indicadores.ciclicos-consulta',
  );
  const guardAlta = app.conPermiso('indicadores.ciclicos-alta');
  const guardConteo = app.conPermiso('indicadores.ciclicos-conteo');
  const guardConsulta = app.conPermiso('indicadores.ciclicos-consulta');
  // La HOJA de conteo la imprime quien da de alta o quien va a contar.
  const guardHoja = app.conAlgunPermiso('indicadores.ciclicos-alta', 'indicadores.ciclicos-conteo');

  app.route({
    method: 'GET',
    url: '/indicadores/ciclicos',
    preHandler: guardAlguno,
    schema: {
      tags: ['indicadores'],
      summary: 'Listar inventarios cíclicos',
      security: SEGURIDAD_SESION,
      querystring: esquemaInventariosCiclicosQuery,
      response: { 200: esquemaInventariosCiclicosPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return listarInventariosCiclicos(sesion, request.query);
    },
  });

  app.route({
    method: 'POST',
    url: '/indicadores/ciclicos',
    preHandler: guardAlta,
    schema: {
      tags: ['indicadores'],
      summary: 'Dar de alta un cíclico (congela el teórico, D6)',
      security: SEGURIDAD_SESION,
      body: esquemaInventarioCiclicoCrear,
      response: { 201: esquemaInventarioCiclicoResumen, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return reply.code(201).send(await crearInventarioCiclico(sesion, request.body));
    },
  });

  app.route({
    method: 'GET',
    url: '/indicadores/ciclicos/:id',
    preHandler: guardAlguno,
    schema: {
      tags: ['indicadores'],
      summary: 'Resumen (encabezado) de un cíclico',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaInventarioCiclicoResumen, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerResumen(sesion, request.params.id);
    },
  });

  app.route({
    method: 'GET',
    url: '/indicadores/ciclicos/:id/conteo',
    preHandler: guardConteo,
    schema: {
      tags: ['indicadores'],
      summary: 'Vista de conteo CIEGO (sin teórico)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaConteoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return obtenerConteo(sesion, request.params.id);
    },
  });

  app.route({
    method: 'POST',
    url: '/indicadores/ciclicos/:id/conteo',
    preHandler: guardConteo,
    schema: {
      tags: ['indicadores'],
      summary: 'Capturar el conteo físico de renglones (ciego)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaInventarioCiclicoConteo,
      response: { 200: esquemaConteoSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return capturarConteo(sesion, request.params.id, request.body);
    },
  });

  app.route({
    method: 'GET',
    url: '/indicadores/ciclicos/:id/exactitud',
    preHandler: guardConsulta,
    schema: {
      tags: ['indicadores'],
      summary: 'Exactitud (teórico vs real) de un cíclico',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaExactitudSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return consultarExactitud(sesion, request.params.id);
    },
  });

  app.route({
    method: 'POST',
    url: '/indicadores/ciclicos/:id/ajuste',
    preHandler: guardConsulta,
    schema: {
      tags: ['indicadores'],
      summary: 'Generar el ajuste (movimientos de kardex, D3)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { 200: esquemaExactitudSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return generarAjusteCiclico(sesion, request.params.id);
    },
  });

  app.route({
    method: 'POST',
    url: '/indicadores/ciclicos/:id/cancelar',
    preHandler: guardAlta,
    schema: {
      tags: ['indicadores'],
      summary: 'Cancelar (suave) un cíclico sin generar ajuste',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      body: esquemaInventarioCiclicoCancelar,
      response: { 200: esquemaInventarioCiclicoResumen, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return cancelarInventarioCiclico(sesion, request.params.id, request.body);
    },
  });

  app.route({
    method: 'GET',
    url: '/indicadores/ciclicos/:id/hoja-conteo',
    preHandler: guardHoja,
    schema: {
      tags: ['indicadores'],
      summary: 'Hoja de conteo en PDF (CIEGA — sin teórico, R9)',
      security: SEGURIDAD_SESION,
      params: esquemaParamId,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await impresoHojaConteo(sesion, request.params.id);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'inline; filename="hoja-conteo-ciclico.pdf"');
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
