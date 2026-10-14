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
 * ⭐⭐ Fila 0.235 (§Post-F9.247(c)) — LAS PUERTAS HTTP del arte, partidas de `modelos.administrar`
 * (arte del modelo) y de `desarrollo.administrar` (fotos de arte de la orden), probadas SIN base.
 *
 * Daniel, sobre Diseño Gráfico: *«desarrolla todos los artes, define quién es el proveedor y cotiza
 * cuánto cuesta cada uno»*. Lo que fija este archivo es la decisión de los ARCHIVOS DE RUTAS:
 *  • las 7 mutaciones del arte del MODELO se abren con `modelos.arte` **o** `modelos.administrar`;
 *  • las 4 de las fotos de arte de la ORDEN, con `modelos.arte` **o** `desarrollo.administrar`;
 *  • NINGUNA otra mutación de los tres plugins (ficha, telas, avíos, medidas, fotos del modelo,
 *    copiar receta, curva, versión, revisión…) se abre con `modelos.arte`.
 *
 * 🔑 El inventario se lee de lo que los plugins REGISTRAN (hook `onRoute`) y de la reja que cada ruta
 * DECLARA (el guard falso se marca con sus llaves): una mutación nueva que acepte `modelos.arte` y
 * nadie clasifique, o una del arte que la pierda, rompe la igualdad. Mismo molde que
 * `clientes/clientes-permisos.rutas.test.ts` (fila 0.239): plugins REALES sobre un Fastify pelado y
 * el dominio del arte mockeado (lanza: lo que se mide es si la petición LLEGÓ a él o se quedó en 403).
 */

/** Lo que lanza el dominio mockeado: la petición cruzó la puerta. */
class LlegoAlDominio extends Error {}

const llegar = () => vi.fn(() => Promise.reject(new LlegoAlDominio()));

vi.mock('../../dominio/modelos/arte-modelo.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  actualizarArte: llegar(),
  copiarArteDeOtroModelo: llegar(),
  crearArte: llegar(),
  eliminarArte: llegar(),
  marcarArtePrincipal: llegar(),
  quitarFotoArte: llegar(),
  solicitarSubidaFotoArte: llegar(),
}));
vi.mock('../../dominio/produccion/fotos-arte-orden.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  mostrarFotoArteEnOrden: llegar(),
  ocultarFotoArteEnOrden: llegar(),
  quitarFotoArteOrden: llegar(),
  solicitarSubidaFotoArteOrden: llegar(),
}));

const { rutasModelos } = await import('./modelos.rutas.js');
const { rutasMedidasAvioTalla } = await import('./medidas-avio-talla.rutas.js');
const { rutasFotosArteOrden } = await import('../produccion/fotos-arte-orden.rutas.js');

/** Cada ruta registrada (`MÉTODO /url`) con las llaves que DECLARA su reja. */
const rejas = new Map<string, readonly ClavePermiso[]>();

/** El guard falso: semántica de `auth/plugin.ts` y marcado con sus llaves para el inventario. */
function guardCon(sesion: SesionUsuario | null) {
  return (...claves: ClavePermiso[]) =>
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
      { claves },
    );
}

async function appCon(sesion: SesionUsuario | null): Promise<FastifyInstance> {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  rejas.clear();
  app.addHook('onRoute', (ruta) => {
    const metodos = Array.isArray(ruta.method) ? ruta.method : [ruta.method];
    const pre = ruta.preHandler as unknown;
    const claves =
      typeof pre === 'function' && 'claves' in pre
        ? (pre as { claves: readonly ClavePermiso[] }).claves
        : [];
    for (const metodo of metodos) {
      if (metodo === 'HEAD') continue;
      rejas.set(`${metodo} ${ruta.url}`, claves);
    }
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('obtenerSesion', () => Promise.resolve(sesion));
  const guard = guardCon(sesion);
  app.decorate('conPermiso', (clave: ClavePermiso) => guard(clave));
  app.decorate('conAlgunPermiso', (...claves: ClavePermiso[]) => guard(...claves));
  app.setErrorHandler((error, _req, reply) =>
    error instanceof LlegoAlDominio
      ? reply.code(418).send({ llego: true })
      : reply.code(500).send({ mensaje: error instanceof Error ? error.message : String(error) }),
  );
  await app.register(rutasModelos, { prefix: '/api' });
  await app.register(rutasMedidasAvioTalla, { prefix: '/api' });
  await app.register(rutasFotosArteOrden, { prefix: '/api' });
  await app.ready();
  return app;
}

function con(...permisos: ClavePermiso[]): SesionUsuario {
  return sesionDePrueba({
    permisos: ['modelos.ver', 'ordenes.ver', ...permisos],
    idEmpresaActiva: 1,
  });
}

type Peticion = {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  payload?: Record<string, unknown>;
};

/** 418 = cruzó la puerta y llegó al dominio; 403 = la puerta lo detuvo. */
async function codigo(sesion: SesionUsuario, peticion: Peticion): Promise<number> {
  const app = await appCon(sesion);
  try {
    const res = await app.inject(peticion);
    return res.statusCode;
  } finally {
    await app.close();
  }
}

const FOTO = { nombreOriginal: 'logo.png', tipoMime: 'image/png', tamanoBytes: 1024 };

/** El arte del MODELO: `modelos.arte` o `modelos.administrar`. */
const DEL_ARTE_MODELO: readonly (readonly [string, Peticion])[] = [
  [
    'POST /api/modelos/:id/artes',
    {
      method: 'POST',
      url: '/api/modelos/1/artes',
      payload: { descripcion: 'Logo', idTipoArte: 3, precio: 12.5 },
    },
  ],
  [
    'PATCH /api/modelos/:id/artes/:idArte',
    { method: 'PATCH', url: '/api/modelos/1/artes/2', payload: { precio: 14, idProveedor: 5 } },
  ],
  ['DELETE /api/modelos/:id/artes/:idArte', { method: 'DELETE', url: '/api/modelos/1/artes/2' }],
  [
    'POST /api/modelos/:id/artes/:idArte/principal',
    { method: 'POST', url: '/api/modelos/1/artes/2/principal' },
  ],
  [
    'POST /api/modelos/:id/artes/copiar',
    { method: 'POST', url: '/api/modelos/1/artes/copiar', payload: { idArteOrigen: 9 } },
  ],
  [
    'POST /api/modelos/:id/artes/:idArte/fotos',
    { method: 'POST', url: '/api/modelos/1/artes/2/fotos', payload: FOTO },
  ],
  [
    'DELETE /api/modelos/:id/artes/:idArte/fotos/:idFoto',
    { method: 'DELETE', url: '/api/modelos/1/artes/2/fotos/3' },
  ],
];

/** Las fotos de arte de la ORDEN: `modelos.arte` o `desarrollo.administrar`. */
const DE_FOTOS_ARTE_ORDEN: readonly (readonly [string, Peticion])[] = [
  [
    'POST /api/ordenes/:idOrden/artes/:idOrdenArte/fotos-ocultas',
    {
      method: 'POST',
      url: '/api/ordenes/1/artes/2/fotos-ocultas',
      payload: { idModeloArteFoto: 3 },
    },
  ],
  [
    'DELETE /api/ordenes/:idOrden/artes/:idOrdenArte/fotos-ocultas/:idModeloArteFoto',
    { method: 'DELETE', url: '/api/ordenes/1/artes/2/fotos-ocultas/3' },
  ],
  [
    'POST /api/ordenes/:idOrden/artes/:idOrdenArte/fotos',
    { method: 'POST', url: '/api/ordenes/1/artes/2/fotos', payload: FOTO },
  ],
  [
    'DELETE /api/ordenes/:idOrden/artes/:idOrdenArte/fotos/:idFoto',
    { method: 'DELETE', url: '/api/ordenes/1/artes/2/fotos/3' },
  ],
];

describe('0.235 — el inventario de las puertas es el que registran los plugins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('las mutaciones que aceptan `modelos.arte` son EXACTAMENTE las 11 del arte', async () => {
    const app = await appCon(con());
    await app.close();
    const mutaciones = [...rejas.entries()].filter(([ruta]) => !/^(GET|OPTIONS) /.test(ruta));
    expect(mutaciones.length).toBeGreaterThan(20);
    const conArte = mutaciones
      .filter(([, claves]) => claves.includes('modelos.arte'))
      .map(([ruta]) => ruta)
      .sort();
    expect(conArte).toEqual(
      [...DEL_ARTE_MODELO, ...DE_FOTOS_ARTE_ORDEN].map(([ruta]) => ruta).sort(),
    );
    // Toda mutación tiene una reja declarada (ninguna se colaría sin guard).
    for (const [ruta, claves] of mutaciones) expect(claves.length, ruta).toBeGreaterThan(0);
  });

  it('la reja de cada puerta del arte es la par EXACTA (ni una llave de más)', async () => {
    const app = await appCon(con());
    await app.close();
    for (const [ruta] of DEL_ARTE_MODELO) {
      expect([...(rejas.get(ruta) ?? [])].sort(), ruta).toEqual([
        'modelos.administrar',
        'modelos.arte',
      ]);
    }
    for (const [ruta] of DE_FOTOS_ARTE_ORDEN) {
      expect([...(rejas.get(ruta) ?? [])].sort(), ruta).toEqual([
        'desarrollo.administrar',
        'modelos.arte',
      ]);
    }
  });

  it('las telas, los avíos, la ficha y las fotos del MODELO siguen en `modelos.administrar` a secas', async () => {
    const app = await appCon(con());
    await app.close();
    for (const ruta of [
      'PUT /api/modelos/:id/bom/telas',
      'PUT /api/modelos/:id/bom/avios',
      'PUT /api/modelos/:idModelo/avios/:idAvio/medidas',
      'POST /api/modelos/:id/bom/avios/favoritos',
      'PATCH /api/modelos/:id',
      'POST /api/modelos',
      'POST /api/modelos/:id/fotos',
      'DELETE /api/modelos/:id/fotos/:idFoto',
      'POST /api/modelos/:id/copiar-bom',
    ]) {
      expect(rejas.get(ruta), ruta).toEqual(['modelos.administrar']);
    }
  });
});

describe('0.235 — las puertas del arte, por HTTP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(DEL_ARTE_MODELO)('⭐ %s abre con SÓLO `modelos.arte`', async (_r, peticion) => {
    expect(await codigo(con('modelos.arte'), peticion)).toBe(418);
  });

  it.each(DEL_ARTE_MODELO)(
    '✅ %s sigue abriendo con SÓLO `modelos.administrar`',
    async (_r, peticion) => {
      expect(await codigo(con('modelos.administrar'), peticion)).toBe(418);
    },
  );

  it.each(DE_FOTOS_ARTE_ORDEN)('⭐ %s abre con SÓLO `modelos.arte`', async (_r, peticion) => {
    expect(await codigo(con('modelos.arte'), peticion)).toBe(418);
  });

  it.each(DE_FOTOS_ARTE_ORDEN)(
    '✅ %s sigue abriendo con SÓLO `desarrollo.administrar`',
    async (_r, peticion) => {
      expect(await codigo(con('desarrollo.administrar'), peticion)).toBe(418);
    },
  );

  it.each(DE_FOTOS_ARTE_ORDEN)(
    '⛔ %s NO abre con `modelos.administrar` (nunca tocó la orden)',
    async (_r, peticion) => {
      expect(await codigo(con('modelos.administrar'), peticion)).toBe(403);
    },
  );

  it.each([...DEL_ARTE_MODELO, ...DE_FOTOS_ARTE_ORDEN])(
    '⛔ %s se queda en 403 sin ninguna llave',
    async (_r, peticion) => {
      expect(await codigo(con(), peticion)).toBe(403);
    },
  );

  // Por HTTP de verdad, con cuerpo VÁLIDO (si no, la validación respondería 400 antes de la reja).
  it.each([
    ['telas', { telas: [] }],
    ['avios', { avios: [] }],
  ] as const)(
    '⛔ guardar los/las %s de la receta con sólo `modelos.arte` es 403',
    async (s, cuerpo) => {
      const peticion: Peticion = { method: 'PUT', url: `/api/modelos/1/bom/${s}`, payload: cuerpo };
      expect(await codigo(con('modelos.arte'), peticion)).toBe(403);
    },
  );
});
