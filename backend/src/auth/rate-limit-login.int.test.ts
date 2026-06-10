/**
 * Regresión del rate limiter vs. bloqueo a 5 intentos (doc 00 §1.1).
 *
 * better-auth trae una regla especial para `/sign-in*` de 3 req / 10 s que, con
 * el limiter encendido (lo está en producción), cortaría con 429 ANTES de llegar
 * al 5º intento y disparar el bloqueo. La `customRule` de `src/auth/config.ts`
 * (`REGLA_RATE_LOGIN`, 20/60 s) SOBRESCRIBE esa regla para esta ruta.
 *
 * Esta prueba FUERZA el limiter encendido (vía `construirAuth(.., {forzarRateLimit})`)
 * y comprueba que 5 fallos seguidos llegan todos al contador (401, nunca 429) y
 * dejan la cuenta bloqueada — exactamente el comportamiento que el rate limiter
 * por defecto rompería.
 */
import { hashPassword } from 'better-auth/crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { construirApp } from '../app.js';
import { MAX_INTENTOS } from '../dominio/auth/login.js';
import type { PrismaClient } from '../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../pruebas/contexto.js';

import { construirAuth } from './config.js';

let cliente: PrismaClient;
let app: FastifyInstance;

const USUARIO = 'opera';
const PASSWORD = 'Clave.1234!';

beforeAll(async () => {
  cliente = clientePruebas();
  // App con el rate limiter FORZADO encendido (como producción), apuntada al
  // contenedor de pruebas. Así la prueba ejercita la customRule de verdad.
  const auth = construirAuth(cliente, { forzarRateLimit: true });
  app = await construirApp({ auth: { auth, prismaCliente: cliente } });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await crearEmpresaPrueba(cliente);
  const usuario = await cliente.usuario.create({
    data: {
      username: USUARIO,
      displayUsername: USUARIO,
      nombre: 'Operador',
      email: `${USUARIO}@control.local`,
      emailVerified: true,
    },
  });
  await cliente.cuenta.create({
    data: {
      providerId: 'credential',
      accountId: usuario.id,
      userId: usuario.id,
      password: await hashPassword(PASSWORD),
    },
  });
});

async function intentarLogin(password: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    payload: { username: USUARIO, password },
  });
  return res.statusCode;
}

describe('rate limiter vs. bloqueo a 5 intentos (con el limiter ENCENDIDO)', () => {
  it('5 intentos fallidos seguidos llegan todos al contador (401, nunca 429) y bloquean', async () => {
    const estados: number[] = [];
    for (let i = 0; i < MAX_INTENTOS; i += 1) {
      estados.push(await intentarLogin('mala'));
    }
    // Ninguno fue cortado por el rate limiter (429): la customRule lo permite.
    expect(estados.every((s) => s === 401)).toBe(true);

    const usuario = await cliente.usuario.findUniqueOrThrow({ where: { username: USUARIO } });
    expect(usuario.intentosFallidos).toBe(MAX_INTENTOS);
    expect(usuario.bloqueado).toBe(true);
  });

  it('un login válido (limiter encendido) sigue funcionando dentro de la cuota', async () => {
    expect(await intentarLogin(PASSWORD)).toBe(200);
  });
});
