/**
 * Ruta REST del RESUMEN OPERATIVO de la portada (rediseño R9, proto `vResumen`). Handler DELGADO
 * (A1): autoriza y delega a `dominio/resumen/resumen`. El guard pide TENER AL MENOS UNO de los
 * permisos de los bloques (`conAlgunPermiso`); el dominio decide bloque por bloque qué devolver
 * según el permiso de su dominio dueño (A4, patrón `contarAlertas`) — sin permiso, el bloque llega
 * `null` y el frontend oculta la tarjeta.
 *
 * NOTA DE INTEGRACIÓN: este plugin se registra en `app.ts`
 * (`await app.register(rutasResumen, { prefix: '/api' })`).
 */
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { esquemaResumenOperativo, esquemaErrorApi } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { SEGURIDAD_SESION } from '../../openapi.js';
import { resumenOperativo } from '../../dominio/resumen/resumen.js';

/** Respuestas de error comunes a toda ruta protegida (para documentar el contrato). */
const respuestasError = {
  401: esquemaErrorApi,
  403: esquemaErrorApi,
} as const;

/** Registra la ruta del Resumen operativo (montada bajo `/api`). */
export const rutasResumen: FastifyPluginCallbackZod = (app, _opciones, done) => {
  const exigirSesion = async (
    obtener: () => Promise<SesionUsuario | null>,
  ): Promise<SesionUsuario> => {
    const sesion = await obtener();
    if (sesion === null) {
      throw new Error('Ruta protegida sin sesión: falta el guard conAlgunPermiso.');
    }
    return sesion;
  };

  // Resumen operativo: KPIs + órdenes por vencer + cortes por semana, por bloque según permisos.
  app.route({
    method: 'GET',
    url: '/resumen',
    preHandler: app.conAlgunPermiso(
      'produccion.wip-ver',
      'indicadores.ver',
      'inventario-pt.ver',
      'rc.ruta-ver',
    ),
    schema: {
      tags: ['resumen'],
      summary: 'Resumen operativo de la portada (cada bloque respeta el permiso de su dominio)',
      security: SEGURIDAD_SESION,
      response: { 200: esquemaResumenOperativo, ...respuestasError },
    },
    handler: async (request) => {
      const sesion = await exigirSesion(() => request.obtenerSesion());
      return resumenOperativo(sesion);
    },
  });

  done();
};
