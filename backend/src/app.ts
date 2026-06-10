import Fastify, { type FastifyInstance } from 'fastify';

import { rutasSalud } from './api/salud/salud.rutas.js';

/** Opciones para construir la aplicacion Fastify. */
export interface OpcionesApp {
  /**
   * Habilita el formateo legible de logs (pino-pretty), util en desarrollo.
   * En produccion se dejan los logs en JSON estructurado.
   */
  logBonito?: boolean;
}

/**
 * Construye y configura la instancia de Fastify (sin ponerla a escuchar).
 *
 * Separar la construccion de la escucha (`servidor.ts`) mantiene la app
 * facilmente probable: los tests de integracion de fases posteriores podran
 * usar `app.inject()` sin abrir un puerto.
 */
export function construirApp(opciones: OpcionesApp = {}): FastifyInstance {
  const app = Fastify({
    logger: opciones.logBonito
      ? {
          level: process.env.LOG_LEVEL ?? 'info',
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' },
          },
        }
      : { level: process.env.LOG_LEVEL ?? 'info' },
  });

  // Cada modulo registra su router bajo el prefijo /api (el nginx del frontend
  // proxya /api -> backend). Aqui solo va salud; los demas modulos llegan en E3.
  void app.register(rutasSalud, { prefix: '/api' });

  return app;
}
