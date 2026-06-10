import { construirApp } from './app.js';

/**
 * Punto de entrada del servicio de API.
 *
 * Arranca Fastify escuchando en `::` (dual-stack IPv4 + IPv6), requisito de la
 * red privada de Railway (PLANMAESTRO §2.2), y en el puerto `PORT` (3000 por
 * defecto). Maneja un apagado limpio ante SIGINT/SIGTERM para que Docker y
 * Railway puedan reiniciar/parar el contenedor sin dejar conexiones colgadas.
 */

const PUERTO = Number(process.env.PORT ?? 3000);
const HOST = '::';

const app = construirApp({ logBonito: process.env.NODE_ENV !== 'production' });

/** Cierra la app de forma ordenada y termina el proceso. */
async function apagar(senal: NodeJS.Signals): Promise<void> {
  app.log.info({ senal }, 'Apagando el servidor...');
  try {
    await app.close();
    app.log.info('Servidor apagado correctamente.');
    process.exit(0);
  } catch (error) {
    app.log.error({ error }, 'Error durante el apagado.');
    process.exit(1);
  }
}

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    void apagar(senal);
  });
}

try {
  await app.listen({ host: HOST, port: PUERTO });
} catch (error) {
  app.log.error({ error }, 'No se pudo iniciar el servidor.');
  process.exit(1);
}
