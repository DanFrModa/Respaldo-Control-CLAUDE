/**
 * Pruebas de integración de las rutas de Tallas + Curvas (F1-E2, PIEZA B — D4): el API
 * REST de punta a punta.
 *
 * Levantan la app Fastify REAL (better-auth incluido) apuntada al Postgres efímero de
 * testcontainers y la ejercitan con `app.inject` (sin abrir puerto), reusando el seed
 * real (admin `Control.2026!`, 9 roles, FR Moda). Cubren:
 *  - deny-by-default: un usuario con rol `Basico` (sin permisos) recibe 403; sin sesión, 401;
 *  - CRUD de tallas (crear→listar→obtener→editar→desactivar→reactivar);
 *  - CRUD de curvas con items ORDENADOS en el body, y la salida con su posición/etiqueta;
 *  - la REGLA CLAVE de Gabriel: una talla usada por una curva activa NO se puede borrar (409);
 *  - filtros `incluirInactivos`/`busqueda`, duplicado → 409 y reglas de captura → 400.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { construirApp } from '../../app.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrar } from '../../../prisma/seed.js';

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

/**
 * Crea una talla por HTTP y devuelve su id.
 *
 * ⚠️ V1-E3r: el `orden` se OMITE cuando no se da. Antes se mandaba `0` por default, que el contrato
 * ya rechaza (el 0 quedó como sentinela puro, §Post-F9.81) — y omitirlo es además el camino real: el
 * servidor lo deduce de la etiqueta.
 */
async function crearTallaHttp(cookie: string, etiqueta: string, orden?: number): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tallas',
    headers: { cookie },
    payload: { etiqueta, ...(orden === undefined ? {} : { orden }) },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: number }>().id;
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

describe('API de tallas y curvas (F1-E2, D4)', () => {
  describe('autorización (deny-by-default)', () => {
    it('un usuario con rol Basico (sin permisos) recibe 403', async () => {
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

      const tallas = await app.inject({
        method: 'GET',
        url: '/api/tallas',
        headers: { cookie: cookieConsulta },
      });
      expect(tallas.statusCode).toBe(403);
      expect(tallas.json()).toMatchObject({ codigo: 'PERMISO' });

      const curvas = await app.inject({
        method: 'GET',
        url: '/api/curvas-talla',
        headers: { cookie: cookieConsulta },
      });
      expect(curvas.statusCode).toBe(403);
    });

    it('sin sesión responde 401', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/tallas' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/api/curvas-talla' })).statusCode).toBe(401);
    });
  });

  /*
   * ⭐ V1-E3r (§Post-F9.81) — LA REPARACIÓN DEL SEED, contra el seed REAL (el mismo que corre en el
   * arranque de `prueba` con `SEED_ON_START=true`). Es la mitad de la etapa que arregla los DATOS ya
   * cargados; la otra mitad —que `crearTalla` deduzca— vive en las pruebas del dominio.
   *
   * Se siembran a mano tallas como las dejó el ETL (`orden = 0`, que es lo que hace
   * `crearTalla(sesion, { etiqueta })` sin orden antes de esta etapa) más una que "alguien acomodó",
   * y se vuelve a correr el seed.
   */
  describe('el seed repara el ORDEN de las tallas migradas (V1-E3r)', () => {
    it('llena el orden de las que están en 0 y NUNCA pisa el que puso una persona', async () => {
      // Como las dejó el ETL: todas en el sentinela.
      for (const etiqueta of ['XG', 'M', 'CH', 'G', '12', '4', 'UT']) {
        await cliente.talla.create({ data: { etiqueta, orden: 0 } });
      }
      // Y una que alguien ordenó a mano, con un valor que la escala JAMÁS produciría para «EX».
      const aMano = await cliente.talla.create({ data: { etiqueta: 'EX', orden: 7 } });

      await sembrar(cliente);

      const porEtiqueta = new Map(
        (await cliente.talla.findMany({ select: { etiqueta: true, orden: true } })).map((t) => [
          t.etiqueta,
          t.orden,
        ]),
      );

      // El desempate deja de ser alfabético: CH, M, G, XG (antes salía CH, G, M, XG).
      const escalera = ['CH', 'M', 'G', 'XG'].map((e) => porEtiqueta.get(e) ?? 0);
      expect(escalera).toEqual([...escalera].sort((a, b) => a - b));
      expect(new Set(escalera).size).toBe(4);

      // Los números quedan por debajo de las letras.
      expect(porEtiqueta.get('4') ?? 0).toBeLessThan(porEtiqueta.get('12') ?? 0);
      expect(porEtiqueta.get('12') ?? 0).toBeLessThan(porEtiqueta.get('CH') ?? 0);

      // Lo que la escala no reconoce se queda en el sentinela, no recibe una posición inventada.
      expect(porEtiqueta.get('UT')).toBe(0);

      // 🔴 Y lo capturado a mano sigue INTACTO.
      const despues = await cliente.talla.findUniqueOrThrow({ where: { id: aMano.id } });
      expect(despues.orden).toBe(7);
    });

    it('es IDEMPOTENTE: correrlo otra vez no mueve nada', async () => {
      await cliente.talla.create({ data: { etiqueta: 'CH', orden: 0 } });
      await sembrar(cliente);
      const primera = await cliente.talla.findMany({
        select: { etiqueta: true, orden: true },
        orderBy: { etiqueta: 'asc' },
      });

      await sembrar(cliente);
      const segunda = await cliente.talla.findMany({
        select: { etiqueta: true, orden: true },
        orderBy: { etiqueta: 'asc' },
      });
      expect(segunda).toEqual(primera);
    });
  });

  describe('CRUD de tallas por HTTP', () => {
    it('crea, lista, obtiene, edita, desactiva y reactiva una talla', async () => {
      const cookie = await cookieAdmin();

      const creado = await app.inject({
        method: 'POST',
        url: '/api/tallas',
        headers: { cookie },
        payload: { etiqueta: 'CH', orden: 1 },
      });
      expect(creado.statusCode).toBe(201);
      const talla = creado.json<{ id: number; etiqueta: string; orden: number }>();
      expect(talla).toMatchObject({ etiqueta: 'CH', orden: 1 });

      const obtenido = await app.inject({
        method: 'GET',
        url: `/api/tallas/${talla.id}`,
        headers: { cookie },
      });
      expect(obtenido.statusCode).toBe(200);

      const editado = await app.inject({
        method: 'PATCH',
        url: `/api/tallas/${talla.id}`,
        headers: { cookie },
        payload: { orden: 5 },
      });
      expect(editado.statusCode).toBe(200);
      expect(editado.json()).toMatchObject({ orden: 5 });

      const desactivado = await app.inject({
        method: 'DELETE',
        url: `/api/tallas/${talla.id}`,
        headers: { cookie },
      });
      expect(desactivado.statusCode).toBe(200);
      expect(desactivado.json()).toMatchObject({ activo: false });

      expect(
        (await app.inject({ method: 'GET', url: '/api/tallas', headers: { cookie } })).json<{
          total: number;
        }>().total,
      ).toBe(0);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/tallas?incluirInactivos=true',
            headers: { cookie },
          })
        ).json<{ total: number }>().total,
      ).toBe(1);

      const reactivado = await app.inject({
        method: 'PATCH',
        url: `/api/tallas/${talla.id}`,
        headers: { cookie },
        payload: { activo: true },
      });
      expect(reactivado.json()).toMatchObject({ activo: true });
    });

    it('etiqueta vacía → 400; etiqueta duplicada (insensible a mayúsculas) → 409', async () => {
      const cookie = await cookieAdmin();
      const vacia = await app.inject({
        method: 'POST',
        url: '/api/tallas',
        headers: { cookie },
        payload: { etiqueta: '   ' },
      });
      expect(vacia.statusCode).toBe(400);

      await crearTallaHttp(cookie, 'M');
      const dup = await app.inject({
        method: 'POST',
        url: '/api/tallas',
        headers: { cookie },
        payload: { etiqueta: 'm' },
      });
      expect(dup.statusCode).toBe(409);
      expect(dup.json()).toMatchObject({ codigo: 'CONFLICTO' });
    });
  });

  describe('CRUD de curvas por HTTP (maestro-detalle ordenado)', () => {
    it('crea una curva con items en orden y los devuelve con posición/etiqueta', async () => {
      const cookie = await cookieAdmin();
      const idCH = await crearTallaHttp(cookie, 'CH', 1);
      const idM = await crearTallaHttp(cookie, 'M', 2);
      const idG = await crearTallaHttp(cookie, 'G', 3);

      const creado = await app.inject({
        method: 'POST',
        url: '/api/curvas-talla',
        headers: { cookie },
        payload: { nombre: 'Dama básica', items: [idG, idCH, idM] },
      });
      expect(creado.statusCode).toBe(201);
      const curva = creado.json<{
        id: number;
        items: { idTalla: number; etiqueta: string; posicion: number }[];
      }>();
      expect(curva.items.map((i) => i.idTalla)).toEqual([idG, idCH, idM]);
      expect(curva.items.map((i) => i.posicion)).toEqual([0, 1, 2]);
      expect(curva.items.map((i) => i.etiqueta)).toEqual(['G', 'CH', 'M']);

      // Editar: reordenar/reemplazar el set.
      const editado = await app.inject({
        method: 'PATCH',
        url: `/api/curvas-talla/${curva.id}`,
        headers: { cookie },
        payload: { items: [idM, idG] },
      });
      expect(editado.statusCode).toBe(200);
      expect(editado.json<{ items: { idTalla: number }[] }>().items.map((i) => i.idTalla)).toEqual([
        idM,
        idG,
      ]);

      // Listar incluye los items.
      const lista = await app.inject({
        method: 'GET',
        url: '/api/curvas-talla',
        headers: { cookie },
      });
      expect(lista.json<{ total: number }>().total).toBe(1);
    });

    it('curva sin items → 400; con talla inexistente → 400; nombre duplicado → 409', async () => {
      const cookie = await cookieAdmin();
      const idM = await crearTallaHttp(cookie, 'M');

      const vacia = await app.inject({
        method: 'POST',
        url: '/api/curvas-talla',
        headers: { cookie },
        payload: { nombre: 'Vacía', items: [] },
      });
      expect(vacia.statusCode).toBe(400);

      const fantasma = await app.inject({
        method: 'POST',
        url: '/api/curvas-talla',
        headers: { cookie },
        payload: { nombre: 'Fantasma', items: [999999] },
      });
      expect(fantasma.statusCode).toBe(400);

      await app.inject({
        method: 'POST',
        url: '/api/curvas-talla',
        headers: { cookie },
        payload: { nombre: 'Caballero', items: [idM] },
      });
      const dup = await app.inject({
        method: 'POST',
        url: '/api/curvas-talla',
        headers: { cookie },
        payload: { nombre: 'caballero', items: [idM] },
      });
      expect(dup.statusCode).toBe(409);
    });
  });

  describe('REGLA CLAVE (Gabriel): talla usada por una curva activa no se puede borrar', () => {
    it('DELETE de una talla en uso por una curva activa → 409', async () => {
      const cookie = await cookieAdmin();
      const idM = await crearTallaHttp(cookie, 'M');
      const idG = await crearTallaHttp(cookie, 'G');
      const curva = await app.inject({
        method: 'POST',
        url: '/api/curvas-talla',
        headers: { cookie },
        payload: { nombre: 'Básica', items: [idM, idG] },
      });
      expect(curva.statusCode).toBe(201);

      const borrar = await app.inject({
        method: 'DELETE',
        url: `/api/tallas/${idM}`,
        headers: { cookie },
      });
      expect(borrar.statusCode).toBe(409);
      expect(borrar.json()).toMatchObject({ codigo: 'CONFLICTO' });

      // La talla sigue activa.
      const obtenida = await app.inject({
        method: 'GET',
        url: `/api/tallas/${idM}`,
        headers: { cookie },
      });
      expect(obtenida.json()).toMatchObject({ activo: true });
    });

    it('tras desactivar la curva, la talla SÍ se puede desactivar', async () => {
      const cookie = await cookieAdmin();
      const idM = await crearTallaHttp(cookie, 'M');
      const curva = await app.inject({
        method: 'POST',
        url: '/api/curvas-talla',
        headers: { cookie },
        payload: { nombre: 'Básica', items: [idM] },
      });
      const idCurva = curva.json<{ id: number }>().id;

      await app.inject({
        method: 'DELETE',
        url: `/api/curvas-talla/${idCurva}`,
        headers: { cookie },
      });
      const borrar = await app.inject({
        method: 'DELETE',
        url: `/api/tallas/${idM}`,
        headers: { cookie },
      });
      expect(borrar.statusCode).toBe(200);
      expect(borrar.json()).toMatchObject({ activo: false });
    });
  });
});
