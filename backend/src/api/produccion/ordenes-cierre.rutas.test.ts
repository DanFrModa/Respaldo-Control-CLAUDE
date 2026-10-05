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
 * ⭐⭐ 0.228 (§Post-F9.244 decisión 4) — **LA PUERTA HTTP de cerrar y de reabrir una orden**, probada
 * SIN base de datos.
 *
 * Daniel: *«solo yo (o el que yo autorice… un permiso que de entrada solo yo tengo activo)»*. Hasta
 * la 0.228 `POST /ordenes/:id/reabrir` pedía `ordenes.cerrar`, la misma llave que cerrar. El dominio
 * ya re-exige la llave buena (`cierre-orden.test.ts`), pero **el `preHandler` de la ruta es una
 * decisión del ARCHIVO DE RUTAS** y es aquí donde se fija: si alguien lo devolviera a
 * `conPermiso('ordenes.cerrar')`, la ruta dejaría pasar a `Directivo` hasta el dominio —y bastaría
 * que el dominio se torciera también para que reabriera—.
 *
 * Mismo molde que `receta-orden.rutas.test.ts`: el plugin REAL sobre un Fastify pelado, el dominio
 * mockeado y los guards con la semántica de `auth/plugin.ts` (401 sin sesión, 403 sin la clave).
 * Lo que se afirma es **qué llave pide cada ruta**, no el cuerpo de la respuesta.
 */

const cerrarOrden = vi.fn();
const reabrirOrden = vi.fn();

vi.mock('../../dominio/produccion/cierre-orden.js', () => ({
  cerrarOrden: (...a: unknown[]) => cerrarOrden(...a) as unknown,
  reabrirOrden: (...a: unknown[]) => reabrirOrden(...a) as unknown,
  previaCierreOrden: vi.fn(),
}));
vi.mock('../../dominio/produccion/ordenes.js', () => ({
  actualizarOrden: vi.fn(),
  agregarComentarioOrden: vi.fn(),
  cancelarOrden: vi.fn(),
  copiarDetalleOrden: vi.fn(),
  crearOrden: vi.fn(),
  guardarMatrizOrden: vi.fn(),
  guardarReferenciasOrden: vi.fn(),
  listarOrdenes: vi.fn(),
  obtenerOrden: vi.fn(),
}));
vi.mock('../../dominio/produccion/precios-orden.js', () => ({
  actualizarPreciosOrden: vi.fn(),
  listarEventosPrecioOrden: vi.fn(),
  obtenerPreciosOrden: vi.fn(),
}));
vi.mock('../../dominio/produccion/habilitacion-orden.js', () => ({
  habilitacionOrden: vi.fn(),
}));

const { rutasOrdenes } = await import('./ordenes.rutas.js');

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
  await app.register(rutasOrdenes, { prefix: '/api' });
  await app.ready();
  return app;
}

function con(...permisos: ClavePermiso[]): SesionUsuario {
  return sesionDePrueba({ permisos, idEmpresaActiva: 1 });
}

/**
 * El código de la petición (≠403 = el guard dejó pasar). El cuerpo NO es decorativo: la validación
 * corre ANTES del `preHandler`, y un cuerpo inválido taparía el 403 con un 400.
 */
async function codigo(
  sesion: SesionUsuario | null,
  url: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const app = await appCon(sesion);
  try {
    const res = await app.inject({ method: 'POST', url, payload });
    return res.statusCode;
  } finally {
    await app.close();
  }
}

const REABRIR = ['/api/ordenes/50/reabrir', { motivo: 'faltaba un recibo' }] as const;
const CERRAR = ['/api/ordenes/50/cerrar', {}] as const;

describe('0.228 — la puerta HTTP de cerrar y de reabrir una orden', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cerrarOrden.mockResolvedValue(undefined);
    reabrirOrden.mockResolvedValue(undefined);
  });

  it('⭐ REABRIR con SÓLO `ordenes.cerrar` (el caso de Directivo) → 403, y el dominio ni se toca', async () => {
    expect(await codigo(con('ordenes.cerrar', 'ordenes.ver'), ...REABRIR)).toBe(403);
    expect(reabrirOrden).not.toHaveBeenCalled();
  });

  it('⭐ REABRIR con `ordenes.reabrir` pasa la puerta (aunque no lleve la llave de cerrar)', async () => {
    expect(await codigo(con('ordenes.reabrir', 'ordenes.ver'), ...REABRIR)).not.toBe(403);
    expect(reabrirOrden).toHaveBeenCalledTimes(1);
  });

  it('⭐ CERRAR sigue con `ordenes.cerrar`: pasa sin `ordenes.reabrir`', async () => {
    expect(await codigo(con('ordenes.cerrar', 'ordenes.ver'), ...CERRAR)).not.toBe(403);
    expect(cerrarOrden).toHaveBeenCalledTimes(1);
  });

  it('…y la llave de reabrir NO abre la puerta de cerrar → 403', async () => {
    expect(await codigo(con('ordenes.reabrir', 'ordenes.ver'), ...CERRAR)).toBe(403);
    expect(cerrarOrden).not.toHaveBeenCalled();
  });

  it('sin sesión → 401', async () => {
    expect(await codigo(null, ...REABRIR)).toBe(401);
  });
});
