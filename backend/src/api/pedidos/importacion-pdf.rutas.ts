/**
 * Rutas REST del IMPORTADOR de OC del cliente por PDF (petición Daniel — plantilla C&A): analizar N
 * PDFs (vista previa) y confirmar (crea el pedido + una OP por PDF con matriz + RC + adjunto). Handlers
 * delgados (A1): validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/pedidos/importacion-pdf`. CERO lógica de negocio aquí. SIN permisos nuevos: analizar →
 * `pedidos.administrar`; confirmar → `pedidos.administrar` (el dominio exige ADEMÁS `ordenes.administrar`,
 * como Generar OP). Los PDFs viajan como base64 en JSON, por eso las rutas suben su `bodyLimit`.
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaAnalizarPdfCyaCuerpo,
  esquemaAnalizarPdfCyaSalida,
  esquemaConfirmarPdfCyaCuerpo,
  esquemaConfirmarPdfCyaSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import {
  analizarImportacionPdf,
  confirmarImportacionPdf,
} from '../../dominio/pedidos/importacion-pdf.js';

/**
 * Límite de cuerpo de las rutas que reciben VARIOS PDFs en base64. Hasta `MAX_ARCHIVOS_PDF` (40) PDFs;
 * en la práctica cada OC es ~200 KB, pero se deja holgura (64 MiB) para lotes grandes sin admitir
 * payloads absurdos (el dominio topa cada archivo a 10 MB decodificados).
 */
const LIMITE_CUERPO_IMPORTACION = 64 * 1024 * 1024;

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas del importador de OC por PDF (montadas bajo `/api`). */
export const rutasImportacionPdf: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Analizar los PDFs del cliente (vista previa por PDF) ─────────────────────
  app.route({
    method: 'POST',
    url: '/pedidos/importacion-pdf/analizar',
    bodyLimit: LIMITE_CUERPO_IMPORTACION,
    preHandler: app.conPermiso('pedidos.administrar'),
    schema: {
      tags: ['pedidos'],
      summary: 'Analizar los PDFs de C&A: un renglón por PDF con su liga sugerida y advertencias',
      security: SEGURIDAD_SESION,
      body: esquemaAnalizarPdfCyaCuerpo,
      response: { 200: esquemaAnalizarPdfCyaSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return analizarImportacionPdf(sesion, request.body);
    },
  });

  // ── Confirmar la importación (pedido + OPs con matriz + RC + adjuntos) ────────
  app.route({
    method: 'POST',
    url: '/pedidos/importacion-pdf/confirmar',
    bodyLimit: LIMITE_CUERPO_IMPORTACION,
    preHandler: app.conPermiso('pedidos.administrar'),
    schema: {
      tags: ['pedidos'],
      summary:
        'Confirmar la importación por PDF: pedido interno + una OP por PDF (matriz + RC + adjunto)',
      security: SEGURIDAD_SESION,
      body: esquemaConfirmarPdfCyaCuerpo,
      response: { 201: esquemaConfirmarPdfCyaSalida, ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const resultado = await confirmarImportacionPdf(sesion, request.body);
      return reply.code(201).send(resultado);
    },
  });

  done();
};
