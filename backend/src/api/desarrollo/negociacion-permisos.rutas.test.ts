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
 * ⭐⭐ Fila 0.238 (§Post-F9.248(b)) — LAS PUERTAS HTTP de la negociación, partidas entre
 * `listas.comentar` y `listas.negociar`, probadas SIN base de datos.
 *
 * Daniel, sobre Aurora: *«las listas negociar **solo de lectura y poder agregar comentarios**, pero
 * no modificar lo que yo hice»*. Lo que fija este archivo, ruta por ruta:
 *  • las NUEVE rutas de `listas.negociar` (7 de la lista y 2 de cotizaciones) se cierran con sólo
 *    `listas.comentar` y siguen abriendo con `listas.negociar`;
 *  • agregar un comentario abre con `listas.comentar` **o** con `listas.negociar`, y se cierra sin
 *    ninguna de las dos;
 *  • leer los comentarios abre con sólo `listas.ver`.
 *
 * 🔑 **El inventario de las nueve es el de las rutas REGISTRADAS** (hook `onRoute`), no el de una
 * lista escrita aquí: los guards falsos de este archivo marcan qué claves lleva cada preHandler y de
 * ahí se saca qué rutas exigen `listas.negociar` a secas. Una ruta nueva con esa llave —o la de
 * comentar cambiada a `conPermiso('listas.negociar')`— rompe la igualdad.
 *
 * Mismo molde que `api/clientes/clientes-permisos.rutas.test.ts` (fila 0.239): los plugins REALES
 * sobre un Fastify pelado, el dominio mockeado y los guards con la semántica de `auth/plugin.ts`.
 * El dominio mockeado LANZA: lo que se mide es si la petición llegó a él (418) o se quedó en 403.
 */

const { LlegoAlDominio, sustituirFunciones } = vi.hoisted(() => {
  /** Lo que lanza el dominio mockeado: la petición cruzó la puerta. */
  class LlegoAlDominio extends Error {}
  /** Reemplaza cada FUNCIÓN exportada del módulo real por una que lanza `LlegoAlDominio`. */
  function sustituirFunciones(real: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(real).map(([nombre, valor]) => [
        nombre,
        typeof valor === 'function' ? () => Promise.reject(new LlegoAlDominio()) : valor,
      ]),
    );
  }
  return { LlegoAlDominio, sustituirFunciones };
});

vi.mock('../../dominio/desarrollo/listas-precios.js', async (original) =>
  sustituirFunciones(await original()),
);
vi.mock('../../dominio/desarrollo/negociacion.js', async (original) =>
  sustituirFunciones(await original()),
);
vi.mock('../../dominio/desarrollo/comentarios-negociacion.js', async (original) =>
  sustituirFunciones(await original()),
);
vi.mock('../../dominio/desarrollo/modelo-en-la-mesa.js', async (original) =>
  sustituirFunciones(await original()),
);
vi.mock('../../dominio/desarrollo/pendientes-linea.js', async (original) =>
  sustituirFunciones(await original()),
);
vi.mock('../../dominio/desarrollo/cotizaciones.js', async (original) =>
  sustituirFunciones(await original()),
);

const { rutasListasPrecios } = await import('./listas-precios.rutas.js');
const { rutasCotizaciones } = await import('./cotizaciones.rutas.js');

/** Un guard falso, con las claves que exige pegadas para que `onRoute` las pueda leer. */
type GuardMarcado = ((
  req: unknown,
  reply: { code: (n: number) => { send: (c: unknown) => unknown } },
) => Promise<void>) & { tipo: 'todas' | 'alguna'; claves: ClavePermiso[] };

/** Las rutas que los plugins REGISTRAN de verdad, con los guards de su preHandler. */
const rutasRegistradas: { ruta: string; guards: GuardMarcado[] }[] = [];

function esGuardMarcado(valor: unknown): valor is GuardMarcado {
  return typeof valor === 'function' && 'tipo' in valor && 'claves' in valor;
}

async function appCon(sesion: SesionUsuario | null): Promise<FastifyInstance> {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  rutasRegistradas.length = 0;
  app.addHook('onRoute', (ruta) => {
    const metodos = Array.isArray(ruta.method) ? ruta.method : [ruta.method];
    const pre: unknown[] = Array.isArray(ruta.preHandler)
      ? ruta.preHandler
      : ruta.preHandler === undefined
        ? []
        : [ruta.preHandler];
    for (const metodo of metodos) {
      rutasRegistradas.push({ ruta: `${metodo} ${ruta.url}`, guards: pre.filter(esGuardMarcado) });
    }
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('obtenerSesion', () => Promise.resolve(sesion));
  const guard = (tipo: 'todas' | 'alguna', claves: ClavePermiso[]): GuardMarcado =>
    Object.assign(
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
      },
      { tipo, claves },
    );
  app.decorate('conPermiso', (clave: ClavePermiso) => guard('todas', [clave]));
  app.decorate('conAlgunPermiso', (...claves: ClavePermiso[]) => guard('alguna', claves));
  // El dominio mockeado lanza a propósito: se responde 418 para distinguir «llegó» de un 500 real.
  app.setErrorHandler((error, _req, reply) =>
    error instanceof LlegoAlDominio
      ? reply.code(418).send({ llego: true })
      : reply.code(500).send({ mensaje: error instanceof Error ? error.message : String(error) }),
  );
  await app.register(rutasListasPrecios, { prefix: '/api' });
  await app.register(rutasCotizaciones, { prefix: '/api' });
  await app.ready();
  return app;
}

/** `listas.ver` + `consultas.ver-importes` (la calculadora y la mesa los piden) + lo que se pase. */
function con(...permisos: ClavePermiso[]): SesionUsuario {
  return sesionDePrueba({
    permisos: ['listas.ver', 'consultas.ver-importes', ...permisos],
    idEmpresaActiva: 1,
  });
}

type Peticion = {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  payload?: Record<string, unknown>;
};

async function codigo(sesion: SesionUsuario, peticion: Peticion): Promise<number> {
  const app = await appCon(sesion);
  try {
    const res = await app.inject(peticion);
    return res.statusCode;
  } finally {
    await app.close();
  }
}

const RENGLON_MESA = {
  conceptoCodigo: 'tela',
  conceptoNombre: 'Tela',
  etiqueta: 'Felpa',
  consumo: 1.2,
  precioUnit: 20,
};

/** Las NUEVE rutas de `listas.negociar`, con su nombre TAL COMO SE REGISTRA y un cuerpo válido. */
const DE_NEGOCIAR: readonly (readonly [string, Peticion])[] = [
  [
    'POST /api/listas-precios/lineas/:idLinea/rondas',
    {
      method: 'POST',
      url: '/api/listas-precios/lineas/1/rondas',
      payload: { idPrecostoNuevo: 2, acuerdo: 'Bajamos la tela' },
    },
  ],
  [
    'POST /api/listas-precios/lineas/:idLinea/acuerdos',
    {
      method: 'POST',
      url: '/api/listas-precios/lineas/1/acuerdos',
      payload: { acuerdo: 'Precio pactado' },
    },
  ],
  [
    'GET /api/listas-precios/lineas/:idLinea/simular',
    { method: 'GET', url: '/api/listas-precios/lineas/1/simular?precioObjetivo=100' },
  ],
  [
    'POST /api/listas-precios/lineas/:idLinea/simular-mesa',
    {
      method: 'POST',
      url: '/api/listas-precios/lineas/1/simular-mesa',
      payload: { renglones: [RENGLON_MESA], precioObjetivo: 100 },
    },
  ],
  [
    'POST /api/listas-precios/lineas/:idLinea/mesa',
    {
      method: 'POST',
      url: '/api/listas-precios/lineas/1/mesa',
      payload: { acuerdo: 'Cerramos así', renglones: [RENGLON_MESA], precioObjetivo: 100 },
    },
  ],
  [
    'PATCH /api/listas-precios/lineas/:idLinea/estado',
    {
      method: 'PATCH',
      url: '/api/listas-precios/lineas/1/estado',
      payload: { estado: 'cerrado' },
    },
  ],
  [
    'PATCH /api/listas-precios/:id/estado',
    { method: 'PATCH', url: '/api/listas-precios/1/estado', payload: { idEstadoLista: 2 } },
  ],
  ['POST /api/cotizaciones', { method: 'POST', url: '/api/cotizaciones', payload: { idLista: 1 } }],
  [
    'POST /api/cotizaciones/:id/cancelar',
    {
      method: 'POST',
      url: '/api/cotizaciones/1/cancelar',
      payload: { motivo: 'Se mandó a otro cliente' },
    },
  ],
];

const COMENTAR: Peticion = {
  method: 'POST',
  url: '/api/listas-precios/1/comentarios',
  payload: { texto: 'El cliente pidió muestra de color', idLinea: 3 },
};
const LEER_COMENTARIOS: Peticion = { method: 'GET', url: '/api/listas-precios/1/comentarios' };

describe('0.238 — las puertas HTTP de la negociación: comentar no es negociar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('el inventario es EXACTAMENTE lo que los plugins registran con `listas.negociar` a secas', async () => {
    const app = await appCon(con());
    await app.close();
    // Fastify registra un `HEAD` automático por cada `GET` (con el mismo preHandler): es la misma
    // puerta, así que no cuenta dos veces.
    const deNegociar = rutasRegistradas
      .filter(({ ruta }) => !ruta.startsWith('HEAD '))
      .filter(({ guards }) =>
        guards.some((g) => g.tipo === 'todas' && g.claves.includes('listas.negociar')),
      )
      .map(({ ruta }) => ruta)
      .sort();
    expect(DE_NEGOCIAR.map(([ruta]) => ruta).sort()).toEqual(deNegociar);
    expect(deNegociar).toHaveLength(9);

    // Y la de comentar es la ÚNICA que nombra `listas.comentar`, con `conAlgunPermiso` (comentar
    // O negociar) — nunca con `listas.negociar` a secas.
    const conComentar = rutasRegistradas.filter(({ guards }) =>
      guards.some((g) => g.claves.includes('listas.comentar')),
    );
    expect(conComentar.map(({ ruta }) => ruta)).toEqual([
      'POST /api/listas-precios/:id/comentarios',
    ]);
    const guardComentar = conComentar[0]?.guards.find((g) => g.claves.includes('listas.comentar'));
    expect(guardComentar?.tipo).toBe('alguna');
    expect([...(guardComentar?.claves ?? [])].sort()).toEqual([
      'listas.comentar',
      'listas.negociar',
    ]);
  });

  it.each(DE_NEGOCIAR)('⛔ %s NO abre con sólo `listas.comentar` (403)', async (_n, peticion) => {
    expect(await codigo(con('listas.comentar'), peticion)).toBe(403);
  });

  it.each(DE_NEGOCIAR)('✅ %s sigue abriendo con `listas.negociar`', async (_n, peticion) => {
    expect(await codigo(con('listas.negociar'), peticion)).toBe(418);
  });

  it('⭐ comentar abre con SÓLO `listas.comentar`', async () => {
    expect(await codigo(con('listas.comentar'), COMENTAR)).toBe(418);
  });

  it('✅ comentar abre con SÓLO `listas.negociar` (lo implica)', async () => {
    expect(await codigo(con('listas.negociar'), COMENTAR)).toBe(418);
  });

  it('⛔ comentar se cierra sin ninguna de las dos (403)', async () => {
    expect(await codigo(con(), COMENTAR)).toBe(403);
  });

  it('⛔ comentar se cierra con `listas.comentar` (o `negociar`) pero SIN `listas.ver` (403)', async () => {
    for (const llave of ['listas.comentar', 'listas.negociar'] as const) {
      const sinVer = sesionDePrueba({ permisos: [llave], idEmpresaActiva: 1 });
      expect(await codigo(sinVer, COMENTAR), llave).toBe(403);
    }
  });

  it('📖 leer los comentarios abre con SÓLO `listas.ver`', async () => {
    const soloVer = sesionDePrueba({ permisos: ['listas.ver'], idEmpresaActiva: 1 });
    expect(await codigo(soloVer, LEER_COMENTARIOS)).toBe(418);
    const sinVer = sesionDePrueba({ permisos: ['listas.comentar'], idEmpresaActiva: 1 });
    expect(await codigo(sinVer, LEER_COMENTARIOS)).toBe(403);
  });
});
