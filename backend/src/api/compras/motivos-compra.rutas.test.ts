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
 * ⭐ Fila 0.231 (H3 del reviewer) — **LA PUERTA HTTP de `GET /api/compras/motivos-compra`**, probada
 * SIN base de datos (mismo molde que `edr/ventas.rutas.test.ts`: el plugin REAL sobre un Fastify
 * pelado, el dominio mockeado y los guards con la semántica de `auth/plugin.ts`).
 *
 * El catálogo lo piden quien VE compras (filtro de la lista) **y** quien sólo las CAPTURA (el
 * diálogo de la OC y la previa de la explosión, que es de `compras.administrar`). Si la ruta se
 * quedara en `conPermiso('compras.ver')`, el selector de quien captura saldría vacío.
 */

const listarMotivosCompra = vi.fn();
vi.mock('../../dominio/compras/motivos-compra.js', () => ({
  listarMotivosCompra: (...a: unknown[]) => listarMotivosCompra(...a) as unknown,
}));
vi.mock('../../dominio/compras/ordenes-compra.js', () => ({
  actualizarOC: vi.fn(),
  autorizarOC: vi.fn(),
  cancelarOC: vi.fn(),
  crearOC: vi.fn(),
  desautorizarOC: vi.fn(),
  listarOC: vi.fn(),
  obtenerOC: vi.fn(),
  resumenOC: vi.fn(),
}));
vi.mock('../../dominio/compras/impresos/impreso-orden-compra.js', () => ({
  impresoOrdenCompra: vi.fn(),
}));

const { rutasOrdenesCompra } = await import('./ordenes-compra.rutas.js');

async function appCon(sesion: SesionUsuario | null): Promise<FastifyInstance> {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
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
  await app.register(rutasOrdenesCompra, { prefix: '/api' });
  await app.ready();
  return app;
}

const con = (...permisos: ClavePermiso[]): SesionUsuario =>
  sesionDePrueba({ permisos, idEmpresaActiva: 1 });

async function pedir(sesion: SesionUsuario | null): Promise<{ status: number; cuerpo: unknown }> {
  const app = await appCon(sesion);
  try {
    const res = await app.inject({ method: 'GET', url: '/api/compras/motivos-compra' });
    return { status: res.statusCode, cuerpo: res.json() };
  } finally {
    await app.close();
  }
}

const MOTIVOS = [{ id: 3, codigo: 'sobre-corte', nombre: 'Sobre-corte', orden: 3, fijo: true }];

describe('0.231 — la puerta del catálogo de motivos de compra', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarMotivosCompra.mockResolvedValue(MOTIVOS);
  });

  it('⭐ con SÓLO `compras.administrar` (quien captura) entra y llega al dominio', async () => {
    const r = await pedir(con('compras.administrar'));
    expect(r.status).toBe(200);
    expect(r.cuerpo).toEqual(MOTIVOS);
    expect(listarMotivosCompra).toHaveBeenCalledTimes(1);
  });

  it('con SÓLO `compras.ver` también entra', async () => {
    expect((await pedir(con('compras.ver'))).status).toBe(200);
  });

  it('sin ninguna de las dos: 403, y el dominio ni se toca', async () => {
    expect((await pedir(con('ordenes.ver', 'compras.autorizar'))).status).toBe(403);
    expect(listarMotivosCompra).not.toHaveBeenCalled();
  });

  it('sin sesión: 401', async () => {
    expect((await pedir(null)).status).toBe(401);
  });
});
