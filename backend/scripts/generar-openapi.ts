/**
 * Genera `backend/openapi.json` desde la app (contrato versionado en el repo).
 *
 * El OpenAPI sale de los MISMOS esquemas Zod que validan las rutas (no se
 * escribe a mano): se construye la app, se la deja lista (`ready`) para que
 * `@fastify/swagger` recorra las rutas, y se vuelca `app.swagger()` a disco.
 * Lo corre `npm run openapi`. El frontend (E4) deriva su cliente de este archivo.
 *
 * No necesita base de datos: solo registra rutas y esquemas (no los ejecuta).
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { construirApp } from '../src/app.js';
import { corregirMediaTypesBinarios } from '../src/openapi.js';

/** Ruta del contrato versionado, junto a package.json. */
const DESTINO = fileURLToPath(new URL('../openapi.json', import.meta.url));

async function generar(): Promise<void> {
  const app = await construirApp();
  try {
    await app.ready();
    const documento = app.swagger();
    // Las respuestas BINARIAS (imágenes) salen envueltas en `application/json` por
    // `@fastify/swagger`; aquí se les pone su tipo real antes de volcar el contrato.
    corregirMediaTypesBinarios(documento);
    await writeFile(DESTINO, `${JSON.stringify(documento, null, 2)}\n`, 'utf8');
    console.log(`OpenAPI generado en ${DESTINO}`);
  } finally {
    await app.close();
  }
}

await generar();
