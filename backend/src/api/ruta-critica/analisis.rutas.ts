/**
 * Rutas REST del tablero de gestión "ANÁLISIS RC" (Módulo 8, rediseño R7; doc `REDISENO-FRONTEND.md`
 * §4.10; B14). Handlers DELGADOS (A1): validan (Zod compartido de `src/contrato`), autorizan
 * (`conPermiso`, A4) y delegan al dominio `dominio/ruta-critica/analisisRc`. CERO lógica de negocio
 * aquí — la salud, el semáforo, el forward pass, el scoring y la agregación los hace el dominio (SQL/
 * dominio, sin pivoteo en el cliente).
 *
 * Endpoints (todos GET, por la empresa activa = A9):
 *  • `GET /ruta-critica/analisis`                  → tablero (salud/entrega/alertas/riesgo/cuellos).
 *    Gate `rc.ruta-ver` (REUSADO — sin permiso nuevo → deploy SIN `SEED_ON_START`).
 *  • `GET /ruta-critica/analisis/desempeno`        → scoring por persona + bono. Gate `rc.programar`
 *    (management, el MISMO permiso que ver pendientes ajenos en la bandeja).
 *  • `GET /ruta-critica/analisis/desempeno/excel`  → MISMO desempeño en `.xlsx` (no entra al cliente).
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasAnalisisRc, { prefix: '/api' })`), junto a las demás rutas de RC.
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaAnalisisRc, esquemaDesempenoRc, esquemaErrorApi } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { analisisRc, desempenoRc } from '../../dominio/ruta-critica/analisisRc.js';
import { excelDesempenoRc } from '../../dominio/ruta-critica/impresos/excel-desempeno-rc.js';

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
} as const;

/** Registra las rutas del tablero Análisis RC (montadas bajo `/api`). */
export const rutasAnalisisRc: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Tablero: salud + entrega/ciclo + alertas predictivas + riesgo por cliente + cuellos.
  app.route({
    method: 'GET',
    url: '/ruta-critica/analisis',
    preHandler: app.conPermiso('rc.ruta-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary:
        'Tablero "Análisis RC": salud de órdenes, entrega/ciclo, alertas predictivas, riesgo y cuellos',
      security: SEGURIDAD_SESION,
      response: { 200: esquemaAnalisisRc, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return analisisRc(sesion);
    },
  });

  // Desempeño del equipo (scoring + bono). Management: exige `rc.programar`.
  app.route({
    method: 'GET',
    url: '/ruta-critica/analisis/desempeno',
    preHandler: app.conPermiso('rc.programar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Desempeño del equipo de la Ruta Crítica: scoring, calificación y bono por persona',
      security: SEGURIDAD_SESION,
      response: { 200: esquemaDesempenoRc, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return desempenoRc(sesion);
    },
  });

  // "Generar evaluación semanal": el MISMO desempeño en Excel (binario .xlsx). No entra al cliente
  // tipado: solo se documentan los errores. Mismo patrón que el Excel del concentrado.
  app.route({
    method: 'GET',
    url: '/ruta-critica/analisis/desempeno/excel',
    preHandler: app.conPermiso('rc.programar'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Evaluación semanal del equipo en Excel (.xlsx): mismo resultado que el desempeño',
      security: SEGURIDAD_SESION,
      response: { ...respuestasError },
    },
    handler: async (request, reply) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      const { buffer } = await excelDesempenoRc(sesion);
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="evaluacion-semanal-rc.xlsx"');
      return reply.send(buffer as unknown as never);
    },
  });

  done();
};
