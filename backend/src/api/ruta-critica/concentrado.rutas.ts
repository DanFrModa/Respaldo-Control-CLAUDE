/**
 * Rutas REST del CONCENTRADO "planeado vs real" de la RUTA CRÍTICA (Módulo 8, F5-E7; doc
 * `08-Ruta-Critica.md` §2.4 — reemplaza `RC_ConcentradoDif`). Handlers DELGADOS (A1): validan (Zod
 * compartido de `src/contrato`), autorizan (`conPermiso`, A4) y delegan al dominio
 * `dominio/ruta-critica/concentrado`. CERO lógica de negocio aquí — el semáforo/atraso/orden y la
 * agregación los hace el dominio (SQL crudo, sin pivoteo en el cliente).
 *
 * Endpoints (ambos GET, ambos `rc.ruta-ver` —REUSADO, sin permiso nuevo→ deploy SIN `SEED_ON_START`—,
 * ambos por la empresa activa = A9):
 *  • `GET /ruta-critica/concentrado`        → tablero paginado (JSON, cliente tipado).
 *  • `GET /ruta-critica/concentrado/excel`  → MISMO resultado, binario `.xlsx` (no entra al cliente).
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasConcentradoRc, { prefix: '/api' })`), junto a las demás rutas de RC.
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaConcentradoPagina,
  esquemaConcentradoQuery,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { consultarConcentrado } from '../../dominio/ruta-critica/concentrado.js';
import { excelConcentrado } from '../../dominio/ruta-critica/impresos/excel-concentrado.js';

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
} as const;

/** Registra las rutas del concentrado de la RC (montadas bajo `/api`). */
export const rutasConcentradoRc: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Concentrado paginado (planeado vs real): todas las órdenes con RC viva × sus procesos.
  app.route({
    method: 'GET',
    url: '/ruta-critica/concentrado',
    preHandler: app.conPermiso('rc.ruta-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary:
        'Concentrado "planeado vs real" de la Ruta Crítica: órdenes con RC viva, semáforo y atraso',
      security: SEGURIDAD_SESION,
      querystring: esquemaConcentradoQuery,
      response: { 200: esquemaConcentradoPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return consultarConcentrado(sesion, request.query);
    },
  });

  // Export a Excel del MISMO concentrado (binario .xlsx). No entra al cliente tipado: solo se
  // documentan los errores. Mismo patrón que los impresos PDF (permiso + Zod del querystring + send).
  app.route({
    method: 'GET',
    url: '/ruta-critica/concentrado/excel',
    preHandler: app.conPermiso('rc.ruta-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Concentrado de la Ruta Crítica en Excel (.xlsx): mismo resultado que el tablero',
      security: SEGURIDAD_SESION,
      querystring: esquemaConcentradoQuery,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await excelConcentrado(sesion, request.query);
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="concentrado-ruta-critica.xlsx"');
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
