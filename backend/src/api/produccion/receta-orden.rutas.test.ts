import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

/**
 * ⭐ V1-E3j — **EL GUARD DE CADA RUTA DE LA RECETA**, probado a nivel HTTP y SIN base de datos.
 *
 * POR QUÉ EXISTE (hallazgo del reviewer). V1-E3j ensanchó la LECTURA de la receta a
 * `ordenes.ver` **O** `desarrollo.ver`, porque §Post-F9.72 había dejado un hueco: las ocho
 * mutaciones bajaron a `desarrollo.administrar` y la bandeja a `desarrollo.ver`, pero la lectura se
 * quedó en `ordenes.ver` — un usuario de Desarrollo puro podía FIRMAR una receta que no podía LEER,
 * y con la pantalla propia eso pasó de teórico a un 403 en la primera consulta.
 *
 * El problema: las pruebas del DOMINIO cubren `obtenerRecetaOrden`, pero **nadie cazaba** que
 * alguien devolviera el `preHandler` de la ruta a `conPermiso('ordenes.ver')`. Eso es una decisión
 * del ARCHIVO DE RUTAS, y es aquí donde se prueba.
 *
 * CÓMO. Se monta el plugin REAL sobre un Fastify pelado y el dominio mockeado, con los dos guards
 * implementados igual que en `auth/plugin.ts` (deny-by-default sobre `sesion.permisos`): 401 sin
 * sesión, 403 sin el permiso. Lo que se afirma NO es la implementación del guard —ésa vive en el
 * plugin real— sino **cuál pide cada ruta**, que es exactamente lo que puede volver a torcerse.
 */

const obtenerRecetaOrden = vi.fn();
const marcarRecetaRevisada = vi.fn();
const liberarReceta = vi.fn();
const traerDelModelo = vi.fn();
const corregirCapturaAvio = vi.fn();
const consultarRecetasPorLiberar = vi.fn();

vi.mock('../../dominio/produccion/receta-orden.js', () => ({
  obtenerRecetaOrden: (...a: unknown[]) => obtenerRecetaOrden(...a) as unknown,
  marcarRecetaRevisada: (...a: unknown[]) => marcarRecetaRevisada(...a) as unknown,
  liberarReceta: (...a: unknown[]) => liberarReceta(...a) as unknown,
  traerDelModelo: (...a: unknown[]) => traerDelModelo(...a) as unknown,
  corregirCapturaAvio: (...a: unknown[]) => corregirCapturaAvio(...a) as unknown,
  agregarRenglonReceta: vi.fn(),
  editarRenglonReceta: vi.fn(),
  quitarRenglonReceta: vi.fn(),
  restaurarRenglonReceta: vi.fn(),
}));

vi.mock('../../dominio/produccion/recetas-por-liberar.js', () => ({
  consultarRecetasPorLiberar: (...a: unknown[]) => consultarRecetasPorLiberar(...a) as unknown,
}));

const { rutasRecetaOrden } = await import('./receta-orden.rutas.js');

/**
 * Monta el plugin real. Los guards replican la semántica de `auth/plugin.ts` (deny-by-default):
 * sin sesión 401, con sesión pero sin permiso 403. La respuesta del dominio no se serializa contra
 * el esquema (se corta antes con `hijack`), porque lo que se prueba es la PUERTA, no el cuerpo.
 */
async function appCon(sesion: SesionUsuario | null): Promise<FastifyInstance> {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('obtenerSesion', () => Promise.resolve(sesion));

  // Deny-by-default, igual que `auth/plugin.ts`: sin sesión 401, con sesión pero sin ninguna de las
  // claves 403. El decorador exige un handler ASÍNCRONO, y aquí no hay nada que esperar: se devuelve
  // una promesa ya resuelta (mismo patrón que `logo.rutas.test.ts`).
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

  await app.register(rutasRecetaOrden, { prefix: '/api' });
  await app.ready();
  return app;
}

/** Sesión con exactamente estos permisos. */
function con(...permisos: ClavePermiso[]): SesionUsuario {
  return sesionDePrueba({ permisos, idEmpresaActiva: 1 });
}

/**
 * El código de una petición con la sesión dada (≠403 = el guard dejó pasar).
 *
 * ⚠️ El `payload` NO es decorativo: la validación del cuerpo corre ANTES del `preHandler`, así que
 * un cuerpo inválido devuelve un error de esquema y **taparía** el 403 que se quiere medir. Cada
 * mutación viaja con un cuerpo que su esquema acepta.
 */
async function codigo(
  sesion: SesionUsuario | null,
  metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
): Promise<number> {
  const app = await appCon(sesion);
  try {
    const res = await app.inject({
      method: metodo,
      url,
      ...(metodo === 'GET' ? {} : { payload: payload ?? {} }),
    });
    return res.statusCode;
  } finally {
    await app.close();
  }
}

describe('Guards de las rutas de la receta (V1-E3j)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obtenerRecetaOrden.mockResolvedValue(undefined);
    marcarRecetaRevisada.mockResolvedValue(undefined);
    liberarReceta.mockResolvedValue(undefined);
    traerDelModelo.mockResolvedValue(undefined);
    corregirCapturaAvio.mockResolvedValue(undefined);
    consultarRecetasPorLiberar.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /ordenes/:id/receta — LEER', () => {
    it('⭐ pasa con SOLO `desarrollo.ver` (quien firma tiene que poder leer)', async () => {
      expect(await codigo(con('desarrollo.ver'), 'GET', '/api/ordenes/50/receta')).not.toBe(403);
      expect(obtenerRecetaOrden).toHaveBeenCalledTimes(1);
    });

    it('⭐ y sigue pasando con SOLO `ordenes.ver` (desde la OP, como siempre)', async () => {
      expect(await codigo(con('ordenes.ver'), 'GET', '/api/ordenes/50/receta')).not.toBe(403);
      expect(obtenerRecetaOrden).toHaveBeenCalledTimes(1);
    });

    it('sin NINGUNO de los dos → 403, y el dominio ni se toca (deny-by-default)', async () => {
      expect(await codigo(con('compras.ver'), 'GET', '/api/ordenes/50/receta')).toBe(403);
      expect(obtenerRecetaOrden).not.toHaveBeenCalled();
    });

    it('sin sesión → 401', async () => {
      expect(await codigo(null, 'GET', '/api/ordenes/50/receta')).toBe(401);
    });
  });

  describe('Las MUTACIONES no se ensancharon: siguen en `desarrollo.administrar`', () => {
    // LAS OCHO rutas de escritura del módulo, con un cuerpo que su esquema acepta.
    const mutaciones: readonly [
      nombre: string,
      metodo: 'POST' | 'PATCH' | 'DELETE',
      url: string,
      cuerpo?: unknown,
    ][] = [
      ['revisar', 'POST', '/api/ordenes/50/receta/revisar'],
      // ⭐ V1-E3k (§Post-F9.80): el cuerpo dejó de ser opcional — hay que NOMBRAR el renglón que se
      // firma. Sin él la ruta contestaría 400 y la prueba del permiso no probaría el permiso.
      [
        'liberar',
        'POST',
        '/api/ordenes/50/receta/liberar',
        { renglones: [{ tipo: 'tela', id: 3 }] },
      ],
      ['traer-del-modelo', 'POST', '/api/ordenes/50/receta/traer-del-modelo'],
      [
        'agregar renglón',
        'POST',
        '/api/ordenes/50/receta/renglones',
        { tipo: 'tela', idTela: 7, consumoPorPrenda: 1.5 },
      ],
      ['editar renglón', 'PATCH', '/api/ordenes/50/receta/renglones/tela/3', { precio: 10 }],
      ['quitar renglón', 'DELETE', '/api/ordenes/50/receta/renglones/tela/3', { motivo: 'x' }],
      ['restaurar renglón', 'POST', '/api/ordenes/50/receta/renglones/tela/3/restaurar'],
      // ⭐⭐ V1-E8h (§Post-F9.130) — el botón «Corregir». Es una ESCRITURA (apaga el
      // `consumoPorTalla` heredado), así que pasa por la misma puerta que las demás: nadie repara
      // la receta de una orden con permiso de sólo lectura.
      ['corregir captura del avío', 'POST', '/api/ordenes/50/receta/renglones/avio/3/corregir'],
    ];

    for (const [nombre, metodo, url, cuerpo] of mutaciones) {
      it(`⭐ «${nombre}» rechaza a quien solo puede VER la receta`, async () => {
        expect(await codigo(con('desarrollo.ver', 'ordenes.ver'), metodo, url, cuerpo)).toBe(403);
      });
    }

    it('son OCHO: si alguien agrega una escritura sin gate, esta cuenta lo delata', () => {
      expect(mutaciones).toHaveLength(8);
    });

    it('…y con `desarrollo.administrar` la puerta se abre (la gemela positiva)', async () => {
      expect(
        await codigo(con('desarrollo.administrar'), 'POST', '/api/ordenes/50/receta/revisar'),
      ).not.toBe(403);
      expect(marcarRecetaRevisada).toHaveBeenCalledTimes(1);
    });

    /**
     * ⭐⭐ V1-E8h (§Post-F9.130) — la gemela positiva del botón «Corregir», y **con los argumentos**.
     * La ruta lleva el tipo FIJO (`/avio/`) en vez de un `:tipo`, así que lo que puede torcerse es
     * que el handler mande el id equivocado: se afirma la pareja (orden, renglón) tal cual viaja.
     */
    it('⭐ «corregir» llama al dominio con la orden y el renglón de la URL', async () => {
      expect(
        await codigo(
          con('desarrollo.administrar'),
          'POST',
          '/api/ordenes/50/receta/renglones/avio/3/corregir',
        ),
      ).not.toBe(403);
      expect(corregirCapturaAvio).toHaveBeenCalledTimes(1);
      expect(corregirCapturaAvio.mock.calls[0]?.slice(1)).toEqual([50, 3]);
    });
  });

  describe('GET /recetas-por-liberar — la BANDEJA', () => {
    it('exige `desarrollo.ver`; `ordenes.ver` NO alcanza (es una pantalla de Desarrollo)', async () => {
      expect(await codigo(con('ordenes.ver'), 'GET', '/api/recetas-por-liberar')).toBe(403);
      expect(await codigo(con('desarrollo.ver'), 'GET', '/api/recetas-por-liberar')).not.toBe(403);
    });
  });
});
