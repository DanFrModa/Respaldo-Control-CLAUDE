/**
 * Pruebas de integración del INTERRUPTOR de la Ruta Crítica **por el API REAL** (V1-E3t,
 * `DECISIONES.md §Post-F9.36 punto 1`).
 *
 * Levantan la app Fastify de verdad (better-auth incluido) contra el Postgres efímero y entran con
 * el **admin del seed** — el usuario con MÁS permisos que existe en el sistema. Si a él la Ruta
 * Crítica le queda cerrada, le queda cerrada a todos.
 *
 * Prueban la capa que de verdad manda de §Post-F9.68 (*el backend rechaza la operación*): esconder
 * el menú y cerrar la ruta son de presentación y se le pueden brincar tecleando la URL o llamando
 * al API a mano. Aquí se comprueba el **403 del SERVIDOR**, en los cuatro permisos del módulo
 * (`rc.ruta-ver`, `rc.programar`, `rc.capturar`, `rc.catalogo-ver`), y que la sesión no le entrega
 * al frontend ni una clave `rc.*` con la que pintar un menú.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { construirApp } from '../app.js';
import { CLAVES_PERMISO, permisoApagado } from '../contrato/index.js';
import type { PrismaClient } from '../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sembrar } from '../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;

const PASSWORD_ADMIN = 'Control.2026!';

/** Cookie de una sesión de ADMIN lista para reenviar en peticiones protegidas. */
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

describe('Ruta Crítica APAGADA (V1-E3t) — el servidor la cierra', () => {
  /** Una ruta de LECTURA por cada permiso del módulo (el 403 no depende del método). */
  const ENDPOINTS: readonly (readonly [permiso: string, url: string])[] = [
    ['rc.ruta-ver', '/api/ruta-critica/ordenes/1/ruta'],
    ['rc.ruta-ver', '/api/ruta-critica/bandeja'],
    ['rc.ruta-ver', '/api/ruta-critica/alertas/conteo'],
    ['rc.ruta-ver', '/api/ruta-critica/concentrado'],
    ['rc.ruta-ver', '/api/ruta-critica/analisis'],
    ['rc.ruta-ver', '/api/ruta-critica/ordenes/1/hitos'],
    ['rc.catalogo-ver', '/api/ruta-critica/familias'],
    ['rc.catalogo-ver', '/api/ruta-critica/articulos'],
  ];

  it.each(ENDPOINTS)('%s → 403 en %s, hasta para el ADMIN', async (_permiso, url) => {
    const cookie = await cookieAdmin();
    const res = await app.inject({ method: 'GET', url, headers: { cookie } });
    // 403 y no 404/500: el guard corta ANTES de tocar el dominio (deny-by-default, A4).
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ codigo: 'PERMISO' });
  });

  // Las de ESCRITURA, cada una con su método real Y UN CUERPO VÁLIDO. Las dos cosas importan: con
  // el método equivocado el servidor responde 404 y con un cuerpo inválido 400 (Fastify valida
  // ANTES del preHandler), y en los dos casos la prueba pasaría sin haber tocado el permiso.
  it('programar la RC de una orden (rc.programar, POST) da 403', async () => {
    const cookie = await cookieAdmin();
    const res = await app.inject({
      method: 'POST',
      url: '/api/ruta-critica/ordenes/1/programar',
      headers: { cookie },
      payload: {
        idArticuloRC: 1,
        fechaEntregaRC: '2026-09-01',
        idTipoTela: 1,
        idAplicacion: 1,
        esResurtido: false,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ codigo: 'PERMISO' });
  });

  it('capturar el cumplimiento de un proceso (rc.capturar, PUT) da 403', async () => {
    const cookie = await cookieAdmin();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/ruta-critica/procesos/1/cumplimiento',
      headers: { cookie },
      payload: { cumplido: true, fechaReal: '2026-09-01' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ codigo: 'PERMISO' });
  });

  it('los KPIs de Ruta Crítica de Indicadores caen con el módulo (piden las DOS llaves)', async () => {
    // Es la única superficie de RC gateada por un permiso que NO empieza con `rc.`
    // (`indicadores.ver`, que el admin sí tiene): sin `conTodosPermisos` habría quedado abierta.
    const cookie = await cookieAdmin();
    const res = await app.inject({
      method: 'GET',
      url: '/api/indicadores/rc?anio=2026',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    // Y el resto de Indicadores sigue ENCENDIDO: apagar la RC no puede tumbar el módulo vecino.
    const wip = await app.inject({
      method: 'GET',
      url: '/api/indicadores/wip',
      headers: { cookie },
    });
    expect(wip.statusCode).toBe(200);
  });

  it('la sesión no le entrega al frontend ni una clave rc.* (menú y ruta se apagan solos)', async () => {
    const cookie = await cookieAdmin();
    const res = await app.inject({ method: 'GET', url: '/api/sesion', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const { permisos } = res.json<{ permisos: string[] }>();

    expect(permisos.filter((p) => p.startsWith('rc.'))).toEqual([]);
    // Y NO se llevó de corbata a nadie más: todo lo que no está apagado sigue en la sesión del
    // admin (sin esto, "no hay rc.*" también pasaría con la sesión vacía o el login roto).
    const esperados = CLAVES_PERMISO.filter((clave) => !permisoApagado(clave));
    expect([...permisos].sort()).toEqual([...esperados].sort());
  });

  it('el permiso apagado NO surte efecto aunque un rol a la medida lo tenga en la BD', async () => {
    // La cerradura es la SESIÓN, no el seed: un rol creado a mano (o una base vieja sin re-sembrar)
    // puede conservar la fila `RolPermiso`, y aun así el servidor debe negar.
    const permiso = await cliente.permiso.findUniqueOrThrow({ where: { clave: 'rc.ruta-ver' } });
    const rolAdmin = await cliente.rol.findUniqueOrThrow({ where: { nombre: 'Administrador' } });
    // `skipDuplicates`: la fila puede existir ya (si el seed dejara de restar los apagados) — lo
    // que esta prueba afirma es que CON la fila puesta el servidor sigue negando, no quién la puso.
    await cliente.rolPermiso.createMany({
      data: [{ idRol: rolAdmin.id, idPermiso: permiso.id }],
      skipDuplicates: true,
    });
    expect(
      await cliente.rolPermiso.count({ where: { idRol: rolAdmin.id, idPermiso: permiso.id } }),
    ).toBe(1);

    const cookie = await cookieAdmin();
    const res = await app.inject({
      method: 'GET',
      url: '/api/ruta-critica/bandeja',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
  });
});
