/**
 * Setup por archivo del proyecto "integracion" (Vitest `setupFiles`).
 *
 * Corre en CADA worker ANTES de importar el archivo de prueba, así que fija
 * `DATABASE_URL` (la URL del Postgres efímero que publicó `entorno-global.ts`)
 * antes de que se construya el cliente Prisma SINGLETON de `src/datos`. Con eso,
 * el código que usa el singleton —la app Fastify, better-auth, los servicios de
 * dominio sin `bd` explícito— apunta al contenedor de pruebas y no a una base
 * vacía. También deja un `BETTER_AUTH_SECRET` fijo para que la autenticación
 * funcione en pruebas sin depender del entorno del desarrollador.
 */
import { inject } from 'vitest';

process.env.DATABASE_URL = inject('urlBaseDatosPruebas');
process.env.BETTER_AUTH_SECRET ??= 'secreto-de-pruebas-fijo-para-integracion';
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
