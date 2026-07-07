/**
 * Rutas REST de las CONSULTAS/TABLEROS/BÚSQUEDA del Módulo ÓRDENES (F2-E4). Calca el ESTÁNDAR de
 * `ordenes.rutas.ts`: cada handler solo (A1)
 *
 *  1. **Valida** la entrada con los esquemas Zod COMPARTIDOS de `src/contrato`.
 *  2. **Autoriza** server-side con `app.conPermiso('ordenes.ver')` (deny-by-default, §9.2): TODAS
 *     estas vistas son de LECTURA (no crean permisos nuevos: E4 no requiere re-seed).
 *  3. **Delega** a los servicios de dominio (`dominio/produccion/consultas.ts`).
 *
 * Endpoints (todos GET, todos `ordenes.ver`, todos filtran por empresa activa A9):
 *  • `GET /ordenes/consulta` — listado LIGERO con filtros de servidor (proyección ligera).
 *  • `GET /ordenes/incompletas` — capturadas sin matriz, con `diasAntiguedad` + semáforo derivado.
 *  • `GET /ordenes/tablero/pedidos-por-mes` — agregado por mes (extensible a avances en F3).
 *  • `GET /ordenes/centro` — centro de comando (rediseño R2: 13 columnas agregadas en servidor).
 *  • `GET /ordenes/buscar` — buscador global ligero para el layout.
 *
 * OJO Fastify (orden de rutas): estos paths ESTÁTICOS (`/ordenes/consulta`, `/ordenes/incompletas`,
 * `/ordenes/buscar`, `/ordenes/tablero/...`) tienen prioridad sobre `/ordenes/:id` de
 * `ordenes.rutas.ts`, así que NO colisionan con el detalle por id aunque se registren aparte.
 *
 * CERO lógica de negocio o acceso a datos aquí; los errores de dominio los traduce el error handler
 * global (`src/api/errores.ts`).
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasConsultasOrden, { prefix: '/api' })`).
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaConsultaOrdenes,
  esquemaErrorApi,
  esquemaIncompletasQuery,
  esquemaOrdenesBuscarQuery,
  esquemaOrdenesBuscarSalida,
  esquemaOrdenesCentroPagina,
  esquemaOrdenesCentroQuery,
  esquemaOrdenesIncompletasPagina,
  esquemaOrdenesLigerasPagina,
  esquemaTableroPedidosMes,
  esquemaTableroPedidosMesQuery,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { centroComandoOrdenes } from '../../dominio/produccion/centro-comando.js';
import {
  buscarOrdenesGlobal,
  consultarIncompletas,
  consultarOrdenes,
  tableroPedidosPorMes,
} from '../../dominio/produccion/consultas.js';

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
} as const;

/** Registra las rutas de consulta/tablero/búsqueda de órdenes (montadas bajo `/api`). */
export const rutasConsultasOrden: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Consulta: listado LIGERO con filtros de servidor (cliente/año/modelo/estado/canceladas + búsqueda).
  app.route({
    method: 'GET',
    url: '/ordenes/consulta',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Consultar órdenes (listado ligero con filtros)',
      security: SEGURIDAD_SESION,
      querystring: esquemaConsultaOrdenes,
      response: { 200: esquemaOrdenesLigerasPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return consultarOrdenes(sesion, request.query);
    },
  });

  // Incompletas: capturadas sin matriz, con antigüedad + semáforo derivado en servidor.
  app.route({
    method: 'GET',
    url: '/ordenes/incompletas',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Listar órdenes incompletas (capturadas sin matriz) con semáforo de antigüedad',
      security: SEGURIDAD_SESION,
      querystring: esquemaIncompletasQuery,
      response: { 200: esquemaOrdenesIncompletasPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return consultarIncompletas(sesion, request.query);
    },
  });

  // Tablero "pedidos por mes": agregado por mes (extensible a avances en F3).
  app.route({
    method: 'GET',
    url: '/ordenes/tablero/pedidos-por-mes',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Tablero de pedidos por mes (agregado de órdenes)',
      security: SEGURIDAD_SESION,
      querystring: esquemaTableroPedidosMesQuery,
      response: { 200: esquemaTableroPedidosMes, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return tableroPedidosPorMes(sesion, request.query);
    },
  });

  // Centro de comando (rediseño R2, §4.2): las 13 columnas del proto agregadas en servidor.
  app.route({
    method: 'GET',
    url: '/ordenes/centro',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Centro de comando de órdenes (13 columnas agregadas, filtros de servidor)',
      security: SEGURIDAD_SESION,
      querystring: esquemaOrdenesCentroQuery,
      response: { 200: esquemaOrdenesCentroPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return centroComandoOrdenes(sesion, request.query);
    },
  });

  // Buscador global del layout: hits ligeros por folio/modelo/cliente/referencia (D7).
  app.route({
    method: 'GET',
    url: '/ordenes/buscar',
    preHandler: app.conPermiso('ordenes.ver'),
    schema: {
      tags: ['ordenes'],
      summary: 'Buscador global de órdenes (hits ligeros para el layout)',
      security: SEGURIDAD_SESION,
      querystring: esquemaOrdenesBuscarQuery,
      response: { 200: esquemaOrdenesBuscarSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return buscarOrdenesGlobal(sesion, request.query);
    },
  });

  done();
};
