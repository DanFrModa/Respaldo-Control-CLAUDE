import type { FastifyPluginCallback } from 'fastify';

import type { RespuestaSalud } from './salud.tipos.js';

/**
 * Router del modulo de salud.
 *
 * Expone GET /health (montado bajo el prefijo /api en el servidor) para que el
 * proxy de nginx y los chequeos de Railway/Docker confirmen que el backend
 * responde. En E1 no consulta la base de datos; el chequeo real de
 * PostgreSQL/Prisma se incorpora en E2.
 *
 * El handler es sincrono: arma y devuelve la respuesta sin esperar a nada
 * (Fastify serializa el valor retornado). El plugin usa la forma de callback
 * porque su unico trabajo es registrar la ruta.
 */
export const rutasSalud: FastifyPluginCallback = (app, _opciones, done) => {
  app.get('/health', (): RespuestaSalud => {
    return {
      estado: 'ok',
      servicio: 'backend',
      hora: new Date().toISOString(),
    };
  });

  done();
};
