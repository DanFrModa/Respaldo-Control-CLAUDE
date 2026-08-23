/**
 * Rutas REST de REPORTES FISCALES para el contador (Módulo 14, F9-E5; D12/R13). Handlers DELGADOS
 * (A1): validan (Zod compartido), autorizan (`conPermiso`, A4) y delegan a
 * `dominio/terceros/reportes/reportes-fiscales`. Es LECTURA: la vista fiscal del libro de terceros (E1).
 *
 * Endpoints (por la empresa activa = A9; TODOS con `terceros.fiscal` —REUSADO, sin permiso nuevo →
 * deploy SIN `SEED_ON_START`—):
 *  • `GET /reportes-fiscales`         → movimientos fiscales paginados + totales del periodo (JSON).
 *  • `GET /reportes-fiscales/salud`   → tablero de salud fiscal (conciliación + saldos por tercero).
 *  • `GET /reportes-fiscales/excel`   → MISMO reporte, binario `.xlsx` (no entra al cliente tipado).
 *  • `GET /reportes-fiscales/impreso` → MISMO reporte, binario PDF (R9).
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaReporteFiscalQuery,
  esquemaReporteFiscalSalida,
  esquemaSaludFiscalQuery,
  esquemaSaludFiscalSalida,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { reporteFiscal, saludFiscal } from '../../dominio/terceros/reportes/reportes-fiscales.js';
import { excelReporteFiscal } from '../../dominio/terceros/reportes/impresos/excel-reporte-fiscal.js';
import { impresoReporteFiscal } from '../../dominio/terceros/reportes/impresos/impreso-reporte-fiscal.js';

/** Respuestas de error comunes. */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
  409: esquemaErrorApi,
} as const;

/** Registra las rutas de reportes fiscales (montadas bajo `/api`). */
export const rutasReportesFiscales: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // ── Reporte fiscal (movimientos fiscales paginados + totales) ─────────────────
  app.route({
    method: 'GET',
    url: '/reportes-fiscales',
    preHandler: app.conPermiso('terceros.fiscal'),
    schema: {
      tags: ['reportes-fiscales'],
      summary: 'Reporte fiscal del contador: movimientos fiscales (CxP + CxC) con CFDI + totales',
      security: SEGURIDAD_SESION,
      querystring: esquemaReporteFiscalQuery,
      response: { 200: esquemaReporteFiscalSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return reporteFiscal(sesion, request.query);
    },
  });

  // ── Tablero de salud fiscal (conciliación consolidada + saldos por tercero) ───
  app.route({
    method: 'GET',
    url: '/reportes-fiscales/salud',
    preHandler: app.conPermiso('terceros.fiscal'),
    schema: {
      tags: ['reportes-fiscales'],
      summary: 'Salud fiscal: % conciliado, pendientes de CFDI/XML y saldos fiscales por tercero',
      security: SEGURIDAD_SESION,
      querystring: esquemaSaludFiscalQuery,
      response: { 200: esquemaSaludFiscalSalida, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return saludFiscal(sesion, request.query);
    },
  });

  // ── Export a Excel (binario .xlsx) ────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/reportes-fiscales/excel',
    preHandler: app.conPermiso('terceros.fiscal'),
    schema: {
      tags: ['reportes-fiscales'],
      summary: 'Reporte fiscal en Excel (.xlsx): mismo resultado que la pantalla',
      security: SEGURIDAD_SESION,
      querystring: esquemaReporteFiscalQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await excelReporteFiscal(sesion, request.query);
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="reporte-fiscal.xlsx"');
      return reply.send(buffer as unknown as never);
    },
  });

  // ── Impreso PDF (R9) ──────────────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/reportes-fiscales/impreso',
    preHandler: app.conPermiso('terceros.fiscal'),
    schema: {
      tags: ['reportes-fiscales'],
      summary: 'Reporte fiscal en PDF (R9): mismo resultado que la pantalla',
      security: SEGURIDAD_SESION,
      querystring: esquemaReporteFiscalQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await impresoReporteFiscal(sesion, request.query);
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'inline; filename="reporte-fiscal.pdf"');
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
