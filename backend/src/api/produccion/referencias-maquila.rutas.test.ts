import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

/**
 * ⭐ Fila 0.242 — LAS PUERTAS HTTP de las referencias de precio de maquila, probadas SIN base de datos
 * (molde de `clientes/clientes-permisos.rutas.test.ts`): el plugin REAL sobre un Fastify pelado, el
 * dominio mockeado (lanza: lo que se mide es si la petición LLEGÓ a él) y los guards con la semántica
 * de `auth/plugin.ts`.
 *
 * Dos inventarios cruzados, para que la prueba no se mida a sí misma:
 *  1. las rutas de la matriz = las que el plugin REGISTRA (hook `onRoute`);
 *  2. las funciones de dominio que las rutas llaman = las PUERTAS que exporta el módulo de dominio
 *     (las exportaciones que exigen permiso con `verificarPermiso`), leídas del archivo real.
 */

class LlegoAlDominio extends Error {}
const llegar = () => vi.fn(() => Promise.reject(new LlegoAlDominio()));

const dominio = {
  capturarReferenciaMaquila: llegar(),
  listarCambiosDeReferencias: llegar(),
  obtenerReferenciasOrden: llegar(),
};
vi.mock('../../dominio/produccion/referencias-maquila.js', () => dominio);

const { rutasReferenciasMaquila } = await import('./referencias-maquila.rutas.js');

const rutasRegistradas: string[] = [];

async function appCon(sesion: SesionUsuario | null): Promise<FastifyInstance> {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  rutasRegistradas.length = 0;
  app.addHook('onRoute', (ruta) => {
    const metodos = Array.isArray(ruta.method) ? ruta.method : [ruta.method];
    for (const metodo of metodos) {
      if (metodo !== 'HEAD') rutasRegistradas.push(`${metodo} ${ruta.url}`);
    }
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('obtenerSesion', () => Promise.resolve(sesion));
  const guard =
    (...claves: ClavePermiso[]) =>
    (
      _req: unknown,
      reply: { code: (n: number) => { send: (c: unknown) => unknown } },
    ): Promise<void> => {
      if (sesion === null) {
        reply.code(401).send({ codigo: 'NO_AUTENTICADO', mensaje: 'Necesitas iniciar sesión.' });
      } else if (!claves.some((c) => sesion.permisos.has(c))) {
        reply.code(403).send({ codigo: 'PERMISO', mensaje: 'No tienes permiso.' });
      }
      return Promise.resolve();
    };
  app.decorate('conPermiso', (clave: ClavePermiso) => guard(clave));
  app.decorate('conAlgunPermiso', (...claves: ClavePermiso[]) => guard(...claves));
  app.setErrorHandler((error, _req, reply) =>
    error instanceof LlegoAlDominio
      ? reply.code(418).send({ llego: true })
      : reply.code(500).send({ mensaje: error instanceof Error ? error.message : String(error) }),
  );
  await app.register(rutasReferenciasMaquila, { prefix: '/api' });
  await app.ready();
  return app;
}

type Peticion = { method: 'GET' | 'PATCH'; url: string; payload?: Record<string, unknown> };

/** Ruta tal como se registra → su petición, la ÚNICA llave que la abre y la función que alcanza. */
const MATRIZ: readonly {
  ruta: string;
  peticion: Peticion;
  llave: ClavePermiso;
  funcion: keyof typeof dominio;
}[] = [
  {
    ruta: 'GET /api/ordenes/referencias-maquila/cambios',
    peticion: {
      method: 'GET',
      url: '/api/ordenes/referencias-maquila/cambios?soloSobreprecios=true',
    },
    llave: 'ordenes.autorizar-sobreprecio',
    funcion: 'listarCambiosDeReferencias',
  },
  {
    ruta: 'GET /api/ordenes/:id/referencias-maquila',
    peticion: { method: 'GET', url: '/api/ordenes/7/referencias-maquila' },
    llave: 'ordenes.ver',
    funcion: 'obtenerReferenciasOrden',
  },
  {
    ruta: 'PATCH /api/ordenes/:id/referencias-maquila',
    peticion: {
      method: 'PATCH',
      url: '/api/ordenes/7/referencias-maquila',
      payload: { idTipoProceso: 1, precio: 10 },
    },
    llave: 'ordenes.precio-maquila',
    funcion: 'capturarReferenciaMaquila',
  },
];

async function codigo(sesion: SesionUsuario | null, peticion: Peticion): Promise<number> {
  const app = await appCon(sesion);
  try {
    return (await app.inject(peticion)).statusCode;
  } finally {
    await app.close();
  }
}

const con = (...permisos: ClavePermiso[]): SesionUsuario =>
  sesionDePrueba({ permisos, idEmpresaActiva: 1 });

/** Las llaves de las OTRAS rutas: ninguna de ellas debe abrir la de la fila. */
const otrasLlaves = (llave: ClavePermiso): ClavePermiso[] =>
  [...new Set(MATRIZ.map((m) => m.llave))].filter((k) => k !== llave);

describe('0.242 — las puertas HTTP de las referencias de maquila', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('el inventario de la matriz es EXACTAMENTE lo que el plugin registra (onRoute)', async () => {
    const app = await appCon(con());
    await app.close();
    expect(MATRIZ.map((m) => m.ruta).sort()).toEqual([...rutasRegistradas].sort());
  });

  it('las funciones que las rutas alcanzan son EXACTAMENTE las puertas del dominio (exports con permiso)', async () => {
    const { readFileSync } = await import('node:fs');
    const fuente = readFileSync(
      new URL('../../dominio/produccion/referencias-maquila.ts', import.meta.url),
      'utf8',
    );
    // Una PUERTA es una función exportada cuyo cuerpo exige permiso (hasta la siguiente exportación).
    const trozos = fuente.split(/\nexport (?=async function|function)/).slice(1);
    const puertas = trozos
      .filter((t) => /\bverificarPermiso\(/.test(t))
      .map((t) => /function\s+(\w+)/.exec(t)?.[1] ?? '')
      .sort();
    expect(puertas).toEqual(MATRIZ.map((m) => m.funcion).sort());
  });

  it.each(MATRIZ)('✅ $ruta abre con SÓLO `$llave` y llega a $funcion', async (fila) => {
    expect(await codigo(con(fila.llave), fila.peticion)).toBe(418);
    expect(dominio[fila.funcion]).toHaveBeenCalledTimes(1);
  });

  it.each(MATRIZ)('⛔ $ruta NO abre con las llaves de las otras rutas (403)', async (fila) => {
    expect(await codigo(con(...otrasLlaves(fila.llave)), fila.peticion)).toBe(403);
    expect(dominio[fila.funcion]).not.toHaveBeenCalled();
  });

  it.each(MATRIZ)('⛔ $ruta sin sesión: 401', async (fila) => {
    expect(await codigo(null, fila.peticion)).toBe(401);
  });

  it('⭐ la consulta NO abre con `ordenes.precio-maquila` (capturar no es ver lo que se cambió)', async () => {
    const consulta = MATRIZ.find((m) => m.funcion === 'listarCambiosDeReferencias');
    expect(consulta).toBeDefined();
    if (consulta === undefined) return;
    expect(await codigo(con('ordenes.precio-maquila', 'ordenes.ver'), consulta.peticion)).toBe(403);
  });
});
