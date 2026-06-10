import type { FastifyPluginCallback } from 'fastify';

import { prisma } from '../../datos/index.js';
import type { RespuestaSalud } from './salud.tipos.js';

/**
 * Router del modulo de salud.
 *
 * Expone GET /health (montado bajo el prefijo /api en el servidor) para que el
 * proxy de nginx y los chequeos de Railway/Docker confirmen que el backend
 * responde. Desde E2 hace un ping ligero a PostgreSQL (`SELECT 1` via Prisma):
 *
 *  • BD responde  → 200 `{ estado: "ok",    servicio, bd: "ok",    hora }`.
 *  • BD NO responde → 503 `{ estado: "error", servicio, bd: "error", hora }`
 *    (un backend sin base no debe recibir trafico).
 *
 * El plugin usa la forma de callback porque su unico trabajo es registrar la
 * ruta; el handler es async para esperar el ping a la base.
 */
export const rutasSalud: FastifyPluginCallback = (app, _opciones, done) => {
  app.get('/health', async (_peticion, respuesta): Promise<RespuestaSalud> => {
    let bd: RespuestaSalud['bd'] = 'ok';
    try {
      // Ping minimo: confirma que la conexion vive sin tocar tablas de negocio.
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      bd = 'error';
      app.log.error({ error }, 'Chequeo de salud: la base de datos no respondio.');
    }

    if (bd !== 'ok') {
      void respuesta.code(503);
    }

    return {
      estado: bd === 'ok' ? 'ok' : 'error',
      servicio: 'backend',
      bd,
      hora: new Date().toISOString(),
    };
  });

  done();
};
