/**
 * Rutas REST de la IMPORTACIÓN de CFDI de proveedores (Módulo 14, F9-E3; R11). Handlers DELGADOS
 * (A1): validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan a `dominio/terceros/cfdi`.
 * Importar/previsualizar un CFDI de proveedor ES administrar CxP → REUSAN `cxp.administrar` (sin
 * permiso nuevo). Es importación (jala el XML sellado), NO emisión.
 *
 * Endpoints (por la empresa activa = A9):
 *  • `POST /terceros/cfdi/previsualizar`  (perm `cxp.administrar`) → parsea + concilia (no escribe).
 *  • `POST /terceros/cfdi/importar`       (perm `cxp.administrar`) → el SERVIDOR sube el XML a R2
 *                                          (server-side) + crea el cargo FISCAL de CxP (A2).
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaCfdiXml,
  esquemaCfdiPrevisualizacion,
  esquemaCfdiImportarEntrada,
  esquemaCfdiImportarSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { previsualizarCfdi, importarCfdi } from '../../dominio/terceros/cfdi/cfdi-proveedor.js';

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de importación de CFDI de proveedores (montadas bajo `/api`). */
export const rutasCfdi: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Previsualizar un CFDI (parsear + conciliar; no escribe) ────────────────────
  app.route({
    method: 'POST',
    url: '/terceros/cfdi/previsualizar',
    preHandler: app.conPermiso('cxp.administrar'),
    schema: {
      tags: ['cxp'],
      summary: 'Previsualizar un CFDI de proveedor (datos extraídos + candidatos de conciliación)',
      security: SEGURIDAD_SESION,
      body: esquemaCfdiXml,
      response: { 200: esquemaCfdiPrevisualizacion, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return previsualizarCfdi(sesion, request.body);
    },
  });

  // ── Importar un CFDI (guardar XML en R2 + crear el cargo fiscal, A2) ────────────
  app.route({
    method: 'POST',
    url: '/terceros/cfdi/importar',
    preHandler: app.conPermiso('cxp.administrar'),
    schema: {
      tags: ['cxp'],
      summary: 'Importar un CFDI de proveedor a CxP (cargo fiscal por el total del CFDI, A2)',
      security: SEGURIDAD_SESION,
      body: esquemaCfdiImportarEntrada,
      response: { 201: esquemaCfdiImportarSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const resultado = await importarCfdi(sesion, request.body);
      return reply.code(201).send(resultado);
    },
  });

  done();
};
