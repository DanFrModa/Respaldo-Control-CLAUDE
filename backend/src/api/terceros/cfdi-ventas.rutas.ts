/**
 * Rutas REST de la IMPORTACIÓN de CFDI de VENTAS (Módulo 14, F9-E4; R12). Handlers DELGADOS (A1):
 * validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan a `dominio/terceros/cfdi`.
 * Importar/previsualizar un CFDI de venta ES administrar CxC → usan `cxc.administrar`. Es importación
 * (jala el XML ya timbrado de la venta propia), NO emisión.
 *
 * Endpoints (por la empresa activa = A9):
 *  • `POST /terceros/cfdi-ventas/previsualizar`  (perm `cxc.administrar`) → parsea + concilia (no escribe).
 *  • `POST /terceros/cfdi-ventas/importar`       (perm `cxc.administrar`) → el SERVIDOR sube el XML a R2
 *                                                 (server-side) + crea el cargo FISCAL de CxC (A2).
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaCfdiXml,
  esquemaCfdiVentaPrevisualizacion,
  esquemaCfdiVentaImportarEntrada,
  esquemaCfdiVentaImportarSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  previsualizarCfdiVenta,
  importarCfdiVenta,
} from '../../dominio/terceros/cfdi/cfdi-ventas.js';

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de importación de CFDI de ventas (montadas bajo `/api`). */
export const rutasCfdiVentas: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Previsualizar un CFDI de venta (parsear + conciliar; no escribe) ───────────
  app.route({
    method: 'POST',
    url: '/terceros/cfdi-ventas/previsualizar',
    preHandler: app.conPermiso('cxc.administrar'),
    schema: {
      tags: ['cxc'],
      summary: 'Previsualizar un CFDI de venta (datos extraídos + candidatos de conciliación)',
      security: SEGURIDAD_SESION,
      body: esquemaCfdiXml,
      response: { 200: esquemaCfdiVentaPrevisualizacion, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return previsualizarCfdiVenta(sesion, request.body);
    },
  });

  // ── Importar un CFDI de venta (guardar XML en R2 + crear el cargo fiscal, A2) ───
  app.route({
    method: 'POST',
    url: '/terceros/cfdi-ventas/importar',
    preHandler: app.conPermiso('cxc.administrar'),
    schema: {
      tags: ['cxc'],
      summary: 'Importar un CFDI de venta a CxC (cargo fiscal por el total del CFDI, A2)',
      security: SEGURIDAD_SESION,
      body: esquemaCfdiVentaImportarEntrada,
      response: { 201: esquemaCfdiVentaImportarSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const resultado = await importarCfdiVenta(sesion, request.body);
      return reply.code(201).send(resultado);
    },
  });

  done();
};
