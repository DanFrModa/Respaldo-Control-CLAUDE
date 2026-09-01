/**
 * ⭐ EL RASTRO DE LA FUSIÓN, VISTO DESDE EL API (V1-E8s → esta etapa).
 *
 * La fusión de colores dejaba su rastro en la base (`Color.idFusionadoEn`, con su FK y su índice) y
 * en la bitácora, pero **la proyección de la ruta lo tiraba**: `aColorSalida` no lo copiaba a la
 * salida, así que el contrato no lo tenía y la pantalla de Colores pintaba un color ABSORBIDO igual
 * que uno que su dueño apagó a mano. Quien buscaba "Blanco" y lo encontraba apagado no tenía forma
 * de contestar la única pregunta que importa: **¿a dónde se fue?**
 *
 * Se prueba por HTTP a propósito: el defecto NO estaba en el dominio (que sí traía la columna) sino
 * en el último salto, la proyección — el único sitio donde el campo se puede perder sin que
 * TypeScript diga nada, porque rellenarlo con `null` compila igual de bien.
 *
 * ⚠️ **Las dos ramas van juntas y no se tapan**: un color FUSIONADO y otro apagado A MANO. Los dos
 * salen `activo: false`; sólo uno lleva destino. Una prueba que sembrara únicamente el fusionado
 * pasaría también con la regla equivocada ("si está inactivo, di que lo fusionaron").
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

/** Forma del color tal como sale del API (lo que consume la pantalla). */
interface ColorHttp {
  id: number;
  nombre: string;
  activo: boolean;
  fusionadoEn: { id: number; nombre: string } | null;
}

/** Cookie de una sesión de admin lista para reenviar en peticiones protegidas. */
async function cookieAdmin(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    payload: { username: 'admin', password: PASSWORD_ADMIN },
  });
  expect(res.statusCode).toBe(200);
  const set = res.headers['set-cookie'];
  const cookies = set === undefined ? [] : Array.isArray(set) ? set : [set];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

/** Crea un color por HTTP y devuelve su id. */
async function crearColorHttp(cookie: string, nombre: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/colores',
    headers: { cookie },
    payload: { nombre },
  });
  expect(res.statusCode).toBe(201);
  return res.json<ColorHttp>().id;
}

/** Lista los colores (incluidos los apagados) y los devuelve por nombre. */
async function listarPorNombre(cookie: string): Promise<Map<string, ColorHttp>> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/colores?incluirInactivos=true&porPagina=500',
    headers: { cookie },
  });
  expect(res.statusCode).toBe(200);
  const pagina = res.json<{ datos: ColorHttp[] }>();
  return new Map(pagina.datos.map((c) => [c.nombre, c]));
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

describe('API de colores — a dónde se fue un color fusionado', () => {
  it('⭐ el color ABSORBIDO sale con el DESTINO de la fusión (id + nombre del canónico)', async () => {
    const cookie = await cookieAdmin();
    const absorbido = await crearColorHttp(cookie, 'Blanco');
    const canonico = await crearColorHttp(cookie, 'Blanco Optico');

    const fusion = await app.inject({
      method: 'POST',
      url: '/api/colores/fusionar',
      headers: { cookie },
      payload: { idDestino: canonico, origenes: [absorbido] },
    });
    expect(fusion.statusCode).toBe(200);
    // El destino sobrevive y a ÉL no lo absorbió nadie: su propio rastro va limpio.
    expect(fusion.json<ColorHttp>()).toMatchObject({ id: canonico, fusionadoEn: null });

    const porNombre = await listarPorNombre(cookie);
    expect(porNombre.get('Blanco')).toMatchObject({
      activo: false,
      fusionadoEn: { id: canonico, nombre: 'Blanco Optico' },
    });
    // …y el canónico, que sigue vivo, no arrastra destino ninguno.
    expect(porNombre.get('Blanco Optico')).toMatchObject({ activo: true, fusionadoEn: null });
  });

  it('⚠️ la RAMA GEMELA: un color apagado A MANO sale inactivo pero SIN destino', async () => {
    const cookie = await cookieAdmin();
    const id = await crearColorHttp(cookie, 'Rojo');

    const baja = await app.inject({
      method: 'DELETE',
      url: `/api/colores/${String(id)}`,
      headers: { cookie },
    });
    expect(baja.statusCode).toBe(200);
    // La respuesta del propio DELETE ya lo dice: apagar no es fusionar.
    expect(baja.json<ColorHttp>()).toMatchObject({ activo: false, fusionadoEn: null });

    const porNombre = await listarPorNombre(cookie);
    expect(porNombre.get('Rojo')).toMatchObject({ activo: false, fusionadoEn: null });
  });

  it('reactivar a mano DESHACE la fusión, y el destino desaparece de la salida', async () => {
    // `actualizarColor` limpia `idFusionadoEn` al reactivar (V1-E8s). Si la salida siguiera
    // diciendo "a mí me absorbió aquél" con el color ya vivo, la pantalla mentiría.
    const cookie = await cookieAdmin();
    const absorbido = await crearColorHttp(cookie, 'Blanco');
    const canonico = await crearColorHttp(cookie, 'Blanco Optico');
    await app.inject({
      method: 'POST',
      url: '/api/colores/fusionar',
      headers: { cookie },
      payload: { idDestino: canonico, origenes: [absorbido] },
    });

    const alta = await app.inject({
      method: 'PATCH',
      url: `/api/colores/${String(absorbido)}`,
      headers: { cookie },
      payload: { activo: true },
    });
    expect(alta.statusCode).toBe(200);
    expect(alta.json<ColorHttp>()).toMatchObject({ activo: true, fusionadoEn: null });

    const uno = await app.inject({
      method: 'GET',
      url: `/api/colores/${String(absorbido)}`,
      headers: { cookie },
    });
    expect(uno.json<ColorHttp>()).toMatchObject({ activo: true, fusionadoEn: null });
  });
});
