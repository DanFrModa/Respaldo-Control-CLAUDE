/**
 * Rutas REST de la BANDEJA "mis tareas" + el CONTEO de alertas de la RUTA CRÍTICA (Módulo 8, F5-E5;
 * doc `08-Ruta-Critica.md` §4; D11). Handlers DELGADOS (A1): validan (Zod compartido de
 * `src/contrato`), autorizan (`conPermiso`, A4) y delegan al dominio `dominio/ruta-critica/bandeja`.
 * CERO lógica de negocio aquí — el semáforo/atraso/orden los DERIVA el dominio.
 *
 * Endpoints (ambos GET, ambos `rc.ruta-ver`, ambos por la empresa activa = A9):
 *  • `GET /ruta-critica/bandeja`        → tareas activas del usuario (o todas, con supervisión), paginadas.
 *  • `GET /ruta-critica/alertas/conteo` → { atrasados, enRiesgo } de MIS tareas (badge del header).
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasBandejaRc, { prefix: '/api' })`), junto a las demás rutas de ruta-crítica.
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  esquemaAlertasRcConteo,
  esquemaBandejaRcPagina,
  esquemaBandejaRcQuery,
  esquemaErrorApi,
} from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { consultarBandeja, contarAlertas } from '../../dominio/ruta-critica/bandeja.js';

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  400: esquemaErrorApi,
  401: esquemaErrorApi,
  403: esquemaErrorApi,
  404: esquemaErrorApi,
} as const;

/** Registra las rutas de la bandeja + conteo de alertas de la RC (montadas bajo `/api`). */
export const rutasBandejaRc: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conPermiso.');
    }
    return sesion;
  };

  // Bandeja "mis tareas": tareas activas del usuario (o todas, con supervisión), por urgencia.
  app.route({
    method: 'GET',
    url: '/ruta-critica/bandeja',
    preHandler: app.conPermiso('rc.ruta-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary:
        'Bandeja "mis tareas": procesos activos a capturar de la Ruta Crítica (por urgencia)',
      security: SEGURIDAD_SESION,
      querystring: esquemaBandejaRcQuery,
      response: { 200: esquemaBandejaRcPagina, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return consultarBandeja(sesion, request.query);
    },
  });

  // Conteo de alertas: { atrasados, enRiesgo } de MIS tareas activas (badge del header).
  app.route({
    method: 'GET',
    url: '/ruta-critica/alertas/conteo',
    preHandler: app.conPermiso('rc.ruta-ver'),
    schema: {
      tags: ['ruta-critica'],
      summary: 'Conteo de mis tareas activas atrasadas / en riesgo de la Ruta Crítica',
      security: SEGURIDAD_SESION,
      response: { 200: esquemaAlertasRcConteo, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return contarAlertas(sesion);
    },
  });

  done();
};
