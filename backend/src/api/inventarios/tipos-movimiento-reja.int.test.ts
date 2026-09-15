/**
 * ⭐ Pruebas de integración de la REJA del catálogo de tipos de movimiento (fila 0.193).
 *
 * Lo que aquí se mide es UNA frase: **quien lleva sólo la llave de telas, o sólo la de avíos, puede
 * leer el catálogo**. Hasta esta fila la ruta abría con `conAlgunPermiso` de las TRES claves de
 * inventario y el dominio reaplicaba **sólo** `inventario-pt.ver` ⇒ ese usuario pasaba la puerta y
 * chocaba con un 403 adentro, dejando sin tipo de movimiento a las dos pantallas de AJUSTE de
 * material (que resuelven `ajuste-entrada`/`ajuste-salida` por código contra esta lista). Es la
 * fila 0.190 al revés y en el mismo sitio: allí la reja pedía de más, aquí reconocía de menos.
 *
 * Se levanta una app Fastify con SÓLO estas rutas montadas bajo `/api`, contra el Postgres efímero,
 * con la autenticación REAL (better-auth) y el seed real. Las aserciones entran SIEMPRE por la ruta
 * (con su `preHandler` de permisos puesto): una guarda probada como función suelta no está probada.
 *
 * 🔑 **CÓMO DISTINGUE QUIÉN NEGÓ**, que es la trampa que cazó el reviewer de la 0.190 (una prueba
 * que sólo entra por el `preHandler` no mide el dominio):
 *  - los casos que dan **200 con renglones** sólo pueden salir de las DOS capas en verde — el
 *    handler llama al dominio y devuelve lo que éste le entregue; si el dominio negara, el cuerpo
 *    sería un 403 y no una lista. Son, por tanto, la medición del dominio;
 *  - el caso que da **403** entra por el `preHandler` (ninguna de las tres), y la negativa del
 *    DOMINIO por su cuenta se mide aparte, sin ruta de por medio, en
 *    `dominio/inventarios/tipos-movimiento.int.test.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { hashPassword } from 'better-auth/crypto';

import { registrarManejadorErrores } from '../errores.js';
import { rutasTiposMovimiento } from './tipos-movimiento.rutas.js';
import { registrarAuth } from '../../auth/plugin.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrar } from '../../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;

const PASSWORD = 'Control.2026!';

/** Forma de un renglón del catálogo tal como sale por el API. */
interface TipoSalida {
  id: number;
  codigo: string;
  nombre: string;
  direccion: string;
  activo: boolean;
  capturaManual: boolean;
}

/**
 * Crea un usuario con un rol NUEVO que tiene EXACTAMENTE las claves pedidas (ninguna más), y su
 * credencial. Así cada prueba describe un perfil real de Daniel: «éste puede esto y nada más».
 */
async function crearUsuarioCon(username: string, claves: string[]): Promise<void> {
  const rol = await cliente.rol.create({
    data: {
      nombre: `Perfil ${username}`,
      descripcion: `Rol de prueba con ${claves.length} permiso(s).`,
      permisos: { create: claves.map((clave) => ({ permiso: { connect: { clave } } })) },
    },
  });
  const usuario = await cliente.usuario.create({
    data: {
      username,
      nombre: `Usuario ${username}`,
      email: `${username}@control.local`,
      emailVerified: true,
      roles: { create: { idRol: rol.id } },
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
}

async function cookieDe(username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    payload: { username, password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  const set = res.headers['set-cookie'];
  const cookies = set === undefined ? [] : Array.isArray(set) ? set : [set];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

/** Pide el catálogo con la cookie dada. */
async function pedirCatalogo(cookie: string): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'GET', url: '/api/tipos-movimiento', headers: { cookie } });
}

beforeAll(async () => {
  cliente = clientePruebas();
  const instancia = Fastify({ logger: false });
  instancia.setValidatorCompiler(validatorCompiler);
  instancia.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(instancia);
  registrarAuth(instancia, {});
  await instancia.register(rutasTiposMovimiento, { prefix: '/api' });
  await instancia.ready();
  app = instancia;
});

afterAll(async () => {
  await app.close();
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await sembrar(cliente);
});

describe('GET /api/tipos-movimiento — la reja del catálogo de movimientos (fila 0.193)', () => {
  it('sin sesión responde 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tipos-movimiento' });
    expect(res.statusCode).toBe(401);
  });

  it('con sesión pero sin ninguna de las tres llaves de inventario responde 403 (deny-by-default)', async () => {
    await crearUsuarioCon('pelon', ['modelos.ver']);
    const res = await pedirCatalogo(await cookieDe('pelon'));
    expect(res.statusCode).toBe(403);
    expect(res.json<{ codigo: string }>().codigo).toBe('PERMISO');
  });

  it('quien sólo lleva `inventario-telas.ver` obtiene la lista (no un 403 de adentro)', async () => {
    await crearUsuarioCon('telera', ['inventario-telas.ver']);
    const res = await pedirCatalogo(await cookieDe('telera'));
    expect(res.statusCode).toBe(200);
    // Con renglones: un 200 vacío podría salir de cualquier capa; uno con datos sólo sale del
    // dominio, que es a quien esta fila le arregla la reja.
    expect(res.json<{ datos: TipoSalida[] }>().datos.length).toBeGreaterThan(0);
  });

  it('quien sólo lleva `inventario-avios.ver` obtiene la lista (no un 403 de adentro)', async () => {
    await crearUsuarioCon('aviera', ['inventario-avios.ver']);
    const res = await pedirCatalogo(await cookieDe('aviera'));
    expect(res.statusCode).toBe(200);
    expect(res.json<{ datos: TipoSalida[] }>().datos.length).toBeGreaterThan(0);
  });

  it('quien sólo lleva `inventario-pt.ver` la sigue leyendo (no se rompió lo que ya funcionaba)', async () => {
    await crearUsuarioCon('ptera', ['inventario-pt.ver']);
    const res = await pedirCatalogo(await cookieDe('ptera'));
    expect(res.statusCode).toBe(200);
    expect(res.json<{ datos: TipoSalida[] }>().datos.length).toBeGreaterThan(0);
  });

  it('el de telas ve EL MISMO catálogo que el de PT: es global, no hay «lo suyo» de cada quien', async () => {
    await crearUsuarioCon('telera2', ['inventario-telas.ver']);
    await crearUsuarioCon('ptera2', ['inventario-pt.ver']);

    const deTelas = await pedirCatalogo(await cookieDe('telera2'));
    const dePt = await pedirCatalogo(await cookieDe('ptera2'));
    expect(deTelas.statusCode).toBe(200);
    expect(dePt.statusCode).toBe(200);

    const codigos = (res: { json: <T>() => T }): string[] =>
      res.json<{ datos: TipoSalida[] }>().datos.map((t) => t.codigo);
    expect(codigos(deTelas)).toEqual(codigos(dePt));
    // Y lo que de verdad van a buscar las dos pantallas de AJUSTE: resolverlo POR CÓDIGO.
    expect(codigos(deTelas)).toEqual(expect.arrayContaining(['ajuste-entrada', 'ajuste-salida']));
  });
});
