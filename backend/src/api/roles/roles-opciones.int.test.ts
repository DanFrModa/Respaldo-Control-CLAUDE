/**
 * ⭐ Pruebas de integración de la REJA del catálogo de roles (fila 0.190).
 *
 * Lo que aquí se mide es UNA frase: **configurar los responsables de un proceso de la Ruta Crítica
 * no debe exigir la llave maestra del RBAC**. Hasta esta fila, el selector de roles del editor se
 * poblaba de `GET /api/roles`, que exige `roles.administrar` ⇒ repartir una responsabilidad
 * obligaba a poder administrar el sistema de permisos entero. Es el *«tener A implica B»* que Daniel
 * señaló en la fila 0.120 (§Post-F9.230), atado al revés.
 *
 * Se levanta una app Fastify con las rutas de Roles **y** las del catálogo de la RC montadas bajo
 * `/api`, contra el Postgres efímero, con la autenticación REAL (better-auth) y el seed real. Las
 * aserciones entran SIEMPRE por la ruta (con su `preHandler` de permisos puesto): una guarda
 * probada como función suelta no está probada.
 *
 * Cubre:
 *  - sin sesión → 401; con sesión sin ninguno de los tres permisos → 403 (deny-by-default, A4);
 *  - quien configura la RC (`rc.catalogo-ver` + `rc.catalogo-administrar`, SIN `roles.administrar`):
 *    lee `/api/roles/opciones` y **fija responsables de punta a punta**, mientras `/api/roles` le
 *    sigue cerrado;
 *  - quien sólo ve la RC (`rc.ruta-ver`, el filtro del concentrado): lee las opciones;
 *  - la carga es MÍNIMA (id + nombre): ni `clavesPermisos` ni `totalUsuarios` salen por ahí.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { hashPassword } from 'better-auth/crypto';

import { registrarManejadorErrores } from '../errores.js';
import { rutasRoles } from './roles.rutas.js';
import { rutasProcesosRc } from '../ruta-critica/procesos.rutas.js';
import { registrarAuth } from '../../auth/plugin.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrar } from '../../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;

const PASSWORD = 'Control.2026!';

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

beforeAll(async () => {
  cliente = clientePruebas();
  const instancia = Fastify({ logger: false });
  instancia.setValidatorCompiler(validatorCompiler);
  instancia.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(instancia);
  registrarAuth(instancia, {});
  await instancia.register(rutasRoles, { prefix: '/api' });
  await instancia.register(rutasProcesosRc, { prefix: '/api' });
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

describe('GET /api/roles/opciones — la reja del catálogo de roles', () => {
  it('sin sesión responde 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/roles/opciones' });
    expect(res.statusCode).toBe(401);
  });

  it('con sesión pero sin ninguno de los tres permisos responde 403 (deny-by-default)', async () => {
    await crearUsuarioCon('pelon', ['modelos.ver']);
    const cookie = await cookieDe('pelon');
    const res = await app.inject({
      method: 'GET',
      url: '/api/roles/opciones',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('el administrador del RBAC la sigue leyendo (`roles.administrar`)', async () => {
    await crearUsuarioCon('gobierno', ['roles.administrar']);
    const cookie = await cookieDe('gobierno');
    const res = await app.inject({
      method: 'GET',
      url: '/api/roles/opciones',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ id: number; nombre: string }[]>().length).toBeGreaterThan(0);
  });

  it('quien sólo VE la Ruta Crítica (`rc.ruta-ver`) la lee: es el filtro del concentrado', async () => {
    await crearUsuarioCon('mirona', ['rc.ruta-ver']);
    const cookie = await cookieDe('mirona');

    const opciones = await app.inject({
      method: 'GET',
      url: '/api/roles/opciones',
      headers: { cookie },
    });
    expect(opciones.statusCode).toBe(200);

    // Y el listado GORDO le sigue cerrado: ver nombres no es administrar el RBAC.
    const gordo = await app.inject({ method: 'GET', url: '/api/roles', headers: { cookie } });
    expect(gordo.statusCode).toBe(403);
  });

  it('devuelve SÓLO id + nombre: el mapa de permisos de cada rol no sale por aquí', async () => {
    await crearUsuarioCon('catalogo', ['rc.catalogo-ver']);
    const cookie = await cookieDe('catalogo');

    const res = await app.inject({
      method: 'GET',
      url: '/api/roles/opciones',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const datos = res.json<Record<string, unknown>[]>();
    const sembrados = await cliente.rol.count();
    expect(datos).toHaveLength(sembrados);
    for (const rol of datos) {
      expect(Object.keys(rol).sort()).toEqual(['id', 'nombre']);
    }
    // Orden alfabético estable, igual que el listado gordo.
    const nombres = datos.map((r) => String(r.nombre));
    expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b)));
  });
});

describe('Configurar responsables de un proceso SIN la llave maestra (fila 0.190)', () => {
  it('quien administra el catálogo de la RC lo hace de punta a punta, y `/api/roles` le sigue cerrado', async () => {
    await crearUsuarioCon('rutera', ['rc.catalogo-ver', 'rc.catalogo-administrar']);
    const cookie = await cookieDe('rutera');

    // 1) El listado GORDO le está negado: NO tiene la llave maestra del RBAC.
    const gordo = await app.inject({ method: 'GET', url: '/api/roles', headers: { cookie } });
    expect(gordo.statusCode).toBe(403);

    // 2) Aun así puebla el selector: eso es lo que esta fila destrabó.
    const opciones = await app.inject({
      method: 'GET',
      url: '/api/roles/opciones',
      headers: { cookie },
    });
    expect(opciones.statusCode).toBe(200);
    const roles = opciones.json<{ id: number; nombre: string }[]>();
    expect(roles.length).toBeGreaterThan(0);

    // 3) Y configura de verdad los responsables de un proceso suyo.
    const alta = await app.inject({
      method: 'POST',
      url: '/api/ruta-critica/procesos',
      headers: { cookie },
      payload: { codigo: 'prueba-0190', nombre: 'Proceso de la fila 0.190' },
    });
    expect(alta.statusCode).toBe(201);
    const idProceso = alta.json<{ id: number }>().id;

    const elegido = roles[0];
    const guardado = await app.inject({
      method: 'PUT',
      url: `/api/ruta-critica/procesos/${idProceso}/roles`,
      headers: { cookie },
      payload: { idsRoles: [elegido.id] },
    });
    expect(guardado.statusCode).toBe(200);
    expect(guardado.json<{ roles: { idRol: number; nombre: string }[] }>().roles).toEqual([
      { idRol: elegido.id, nombre: elegido.nombre },
    ]);
  });
});
