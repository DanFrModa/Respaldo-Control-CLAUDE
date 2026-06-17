/**
 * Pruebas de integración de las rutas de Administración (F1-E1 PIEZA C): el API
 * REST de Usuarios, Empresas y Roles de punta a punta.
 *
 * Levantan la app Fastify REAL (better-auth incluido) apuntada al Postgres
 * efímero de testcontainers y la ejercitan con `app.inject` (sin abrir puerto),
 * reusando el seed real (admin `Control.2026!`, 9 roles, FR Moda). Cubren:
 *  - deny-by-default: un usuario sin `usuarios.administrar` / `empresas.administrar`
 *    recibe 403 en las rutas (el rol `Basico` no tiene permisos);
 *  - alta de usuario con rol existente y su aparición en el listado;
 *  - reasignar roles y desbloquear;
 *  - cambio de contraseña por administrador → el usuario entra con la nueva clave
 *    y NO con la vieja (el hash scrypt lo verifica el login real de better-auth);
 *  - empresas: crear, editar el identificador y leer/actualizar la configuración;
 *  - roles: el selector lista los roles del seed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { construirApp } from '../app.js';
import type { PrismaClient } from '../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sembrar } from '../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;

const PASSWORD_ADMIN = 'Control.2026!';

/** Resultado de un login: status y, si hubo éxito, las cookies a reenviar. */
interface ResultadoLogin {
  status: number;
  cookies: string[];
}

/** Inicia sesión por usuario/contraseña y captura las cookies `set-cookie`. */
async function login(username: string, password: string): Promise<ResultadoLogin> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    payload: { username, password },
  });
  const set = res.headers['set-cookie'];
  const cookies = set === undefined ? [] : Array.isArray(set) ? set : [set];
  return { status: res.statusCode, cookies };
}

/** Convierte las cookies `set-cookie` en un header `cookie` para reenviar. */
function comoHeaderCookie(cookies: string[]): string {
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

/** Cookie de una sesión de admin lista para reenviar en peticiones protegidas. */
async function cookieAdmin(): Promise<string> {
  const sesion = await login('admin', PASSWORD_ADMIN);
  expect(sesion.status).toBe(200);
  return comoHeaderCookie(sesion.cookies);
}

/** Id del rol del seed por su nombre. */
async function idRol(nombre: string): Promise<number> {
  const rol = await cliente.rol.findUniqueOrThrow({ where: { nombre }, select: { id: true } });
  return rol.id;
}

beforeAll(async () => {
  cliente = clientePruebas();
  app = await construirApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await sembrar(cliente);
});

describe('API de administración (F1-E1 PIEZA C)', () => {
  describe('autorización (deny-by-default)', () => {
    it('un usuario sin permiso de administración recibe 403 en usuarios y empresas', async () => {
      // Alta de un usuario con rol "Basico" (sin ningún permiso) hecha por el admin.
      const cookie = await cookieAdmin();
      const creado = await app.inject({
        method: 'POST',
        url: '/api/usuarios',
        headers: { cookie },
        payload: {
          username: 'consulta',
          nombre: 'Usuario Consulta',
          password: 'Clave.1234!',
          idsRoles: [await idRol('Basico')],
        },
      });
      expect(creado.statusCode).toBe(201);

      const sesion = await login('consulta', 'Clave.1234!');
      const cookieConsulta = comoHeaderCookie(sesion.cookies);

      const usuarios = await app.inject({
        method: 'GET',
        url: '/api/usuarios',
        headers: { cookie: cookieConsulta },
      });
      expect(usuarios.statusCode).toBe(403);
      expect(usuarios.json()).toMatchObject({ codigo: 'PERMISO' });

      const empresas = await app.inject({
        method: 'GET',
        url: '/api/empresas',
        headers: { cookie: cookieConsulta },
      });
      expect(empresas.statusCode).toBe(403);

      const roles = await app.inject({
        method: 'GET',
        url: '/api/roles',
        headers: { cookie: cookieConsulta },
      });
      expect(roles.statusCode).toBe(403);
    });

    it('sin sesión responde 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/usuarios' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('usuarios', () => {
    it('crea un usuario con rol existente y aparece en el listado con sus roles', async () => {
      const cookie = await cookieAdmin();
      const creado = await app.inject({
        method: 'POST',
        url: '/api/usuarios',
        headers: { cookie },
        payload: {
          username: 'Caro',
          nombre: 'Carolina',
          password: 'secreta-larga-1',
          idsRoles: [await idRol('Ventas')],
        },
      });
      expect(creado.statusCode).toBe(201);
      const usuario = creado.json<{
        id: string;
        username: string;
        roles: { nombre: string }[];
      }>();
      expect(usuario.username).toBe('caro'); // normalizado a minúsculas
      expect(usuario.roles.map((rol) => rol.nombre)).toContain('Ventas');
      expect(creado.json()).not.toHaveProperty('password');

      const lista = await app.inject({
        method: 'GET',
        url: '/api/usuarios?busqueda=caro',
        headers: { cookie },
      });
      expect(lista.statusCode).toBe(200);
      const pagina = lista.json<{ total: number; datos: { username: string }[] }>();
      expect(pagina.total).toBe(1);
      expect(pagina.datos[0]?.username).toBe('caro');
    });

    it('reasigna los roles de un usuario (reemplaza el conjunto)', async () => {
      const cookie = await cookieAdmin();
      const creado = await app.inject({
        method: 'POST',
        url: '/api/usuarios',
        headers: { cookie },
        payload: {
          username: 'pedro',
          nombre: 'Pedro',
          password: 'secreta-larga-1',
          idsRoles: [await idRol('Ventas')],
        },
      });
      const { id } = creado.json<{ id: string }>();

      const res = await app.inject({
        method: 'POST',
        url: `/api/usuarios/${id}/roles`,
        headers: { cookie },
        payload: { idsRoles: [await idRol('Logistica')] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ roles: { nombre: string }[] }>().roles.map((r) => r.nombre)).toEqual([
        'Logistica',
      ]);
    });

    it('desbloquea un usuario bloqueado por intentos', async () => {
      const cookie = await cookieAdmin();
      const creado = await app.inject({
        method: 'POST',
        url: '/api/usuarios',
        headers: { cookie },
        payload: { username: 'bloq', nombre: 'Bloqueado', password: 'secreta-larga-1' },
      });
      const { id } = creado.json<{ id: string }>();
      await cliente.usuario.update({
        where: { id },
        data: { bloqueado: true, intentosFallidos: 5 },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/usuarios/${id}/desbloquear`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const usuario = res.json<{ bloqueado: boolean; intentosFallidos: number }>();
      expect(usuario.bloqueado).toBe(false);
      expect(usuario.intentosFallidos).toBe(0);
    });

    it('cambia la contraseña: el usuario entra con la nueva y no con la vieja', async () => {
      const cookie = await cookieAdmin();
      const creado = await app.inject({
        method: 'POST',
        url: '/api/usuarios',
        headers: { cookie },
        payload: {
          username: 'rotar',
          nombre: 'Rotar Clave',
          password: 'vieja-clave-1',
          idsRoles: [await idRol('Ventas')],
        },
      });
      const { id } = creado.json<{ id: string }>();

      // La vieja clave funciona antes del cambio.
      expect((await login('rotar', 'vieja-clave-1')).status).toBe(200);

      const res = await app.inject({
        method: 'POST',
        url: `/api/usuarios/${id}/contrasena`,
        headers: { cookie },
        payload: { password: 'nueva-clave-2' },
      });
      expect(res.statusCode).toBe(200);

      // El login real de better-auth verifica el hash recién escrito.
      expect((await login('rotar', 'nueva-clave-2')).status).toBe(200);
      expect((await login('rotar', 'vieja-clave-1')).status).toBe(401);
    });

    it('valida la entrada del alta (Zod) → 400', async () => {
      const cookie = await cookieAdmin();
      const res = await app.inject({
        method: 'POST',
        url: '/api/usuarios',
        headers: { cookie },
        payload: { username: 'ab', nombre: '', password: 'corta' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ codigo: 'VALIDACION' });
    });
  });

  describe('empresas', () => {
    it('crea una empresa y edita su identificador', async () => {
      const cookie = await cookieAdmin();
      const creada = await app.inject({
        method: 'POST',
        url: '/api/empresas',
        headers: { cookie },
        payload: { nombre: 'Marilyn Fitness', identificador: 'MF-01' },
      });
      expect(creada.statusCode).toBe(201);
      const empresa = creada.json<{ id: number; identificador: string | null }>();
      expect(empresa.identificador).toBe('MF-01');

      const editada = await app.inject({
        method: 'PATCH',
        url: `/api/empresas/${String(empresa.id)}`,
        headers: { cookie },
        payload: { identificador: 'MF-02' },
      });
      expect(editada.statusCode).toBe(200);
      expect(editada.json<{ identificador: string | null }>().identificador).toBe('MF-02');
    });

    it('lista las empresas (la favorita primero) e incluye FR Moda del seed', async () => {
      const cookie = await cookieAdmin();
      const res = await app.inject({ method: 'GET', url: '/api/empresas', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const empresas = res.json<{ nombre: string; favorita: boolean }[]>();
      expect(empresas.some((e) => e.nombre === 'FR Moda')).toBe(true);
      expect(empresas[0]?.favorita).toBe(true);
    });

    it('lee y actualiza la configuración de una empresa (con fecha ISO)', async () => {
      const cookie = await cookieAdmin();
      const empresa = await cliente.empresa.findUniqueOrThrow({ where: { nombre: 'FR Moda' } });

      const obtenida = await app.inject({
        method: 'GET',
        url: `/api/empresas/${String(empresa.id)}/configuracion`,
        headers: { cookie },
      });
      expect(obtenida.statusCode).toBe(200);
      expect(obtenida.json<{ idEmpresa: number }>().idEmpresa).toBe(empresa.id);

      const actualizada = await app.inject({
        method: 'PATCH',
        url: `/api/empresas/${String(empresa.id)}/configuracion`,
        headers: { cookie },
        payload: { utilidadSugerida: 42, fechaInventarioTelas: '2026-01-15T00:00:00.000Z' },
      });
      expect(actualizada.statusCode).toBe(200);
      const config = actualizada.json<{
        utilidadSugerida: number | null;
        fechaInventarioTelas: string | null;
      }>();
      expect(config.utilidadSugerida).toBe(42);
      expect(config.fechaInventarioTelas).toContain('2026-01-15');
    });
  });

  describe('roles (solo lectura)', () => {
    it('lista los roles del seed para el selector', async () => {
      const cookie = await cookieAdmin();
      const res = await app.inject({ method: 'GET', url: '/api/roles', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const roles = res.json<{ nombre: string; esSistema: boolean }[]>();
      expect(roles.some((r) => r.nombre === 'Administrador')).toBe(true);
      expect(roles.some((r) => r.nombre === 'Basico')).toBe(true);
      expect(roles.every((r) => r.esSistema)).toBe(true);
    });
  });
});
