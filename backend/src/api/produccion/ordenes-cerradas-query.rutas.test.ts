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
import { registrarManejadorErrores } from '../errores.js';

/**
 * ⭐ 0.227 (§Post-F9.244, etapa 2) — **EL PARÁMETRO `cerradas` POR LA PUERTA HTTP**, sin base de datos.
 *
 * Lo que se fija aquí es lo que decide la RUTA: que la querystring `?cerradas=` llegue coaccionada al
 * dominio, que **sin él valga `incluir`** (así ninguna pantalla de consulta cambia) y que un valor
 * inventado sea 400. Lo que el filtro hace contra la base lo prueba `filtro-cerradas.int.test.ts`.
 *
 * Mismo molde que `ordenes-cierre.rutas.test.ts`: el plugin REAL sobre un Fastify pelado y el dominio
 * mockeado; la respuesta se devuelve vacía (la forma de la página no es lo que se mide).
 */

const listarOrdenes = vi.fn();
const consultarOrdenes = vi.fn();
const PAGINA_VACIA = { datos: [], total: 0, pagina: 1, porPagina: 20, totalPaginas: 0 };

vi.mock('../../dominio/produccion/ordenes.js', () => ({
  actualizarOrden: vi.fn(),
  agregarComentarioOrden: vi.fn(),
  cancelarOrden: vi.fn(),
  copiarDetalleOrden: vi.fn(),
  crearOrden: vi.fn(),
  guardarMatrizOrden: vi.fn(),
  guardarReferenciasOrden: vi.fn(),
  listarOrdenes: (...a: unknown[]) => listarOrdenes(...a) as unknown,
  obtenerOrden: vi.fn(),
}));
vi.mock('../../dominio/produccion/cierre-orden.js', () => ({
  cerrarOrden: vi.fn(),
  reabrirOrden: vi.fn(),
  previaCierreOrden: vi.fn(),
}));
vi.mock('../../dominio/produccion/precios-orden.js', () => ({
  actualizarPreciosOrden: vi.fn(),
  listarEventosPrecioOrden: vi.fn(),
  obtenerPreciosOrden: vi.fn(),
}));
vi.mock('../../dominio/produccion/habilitacion-orden.js', () => ({
  habilitacionOrden: vi.fn(),
}));
vi.mock('../../dominio/produccion/consultas.js', () => ({
  buscarOrdenesGlobal: vi.fn(),
  consultarIncompletas: vi.fn(),
  consultarOrdenes: (...a: unknown[]) => consultarOrdenes(...a) as unknown,
  tableroPedidosPorMes: vi.fn(),
}));
vi.mock('../../dominio/produccion/centro-comando.js', () => ({
  centroComandoOrdenes: vi.fn(),
}));

const { rutasOrdenes } = await import('./ordenes.rutas.js');
const { rutasConsultasOrden } = await import('./consultas.rutas.js');

async function app(): Promise<FastifyInstance> {
  const sesion: SesionUsuario = sesionDePrueba({
    permisos: ['ordenes.ver'] as ClavePermiso[],
    idEmpresaActiva: 1,
  });
  const instancia = Fastify().withTypeProvider<ZodTypeProvider>();
  instancia.setValidatorCompiler(validatorCompiler);
  instancia.setSerializerCompiler(serializerCompiler);
  // El manejador REAL de la API: es el que traduce la validación de la querystring a 400.
  registrarManejadorErrores(instancia);
  instancia.decorateRequest('obtenerSesion', () => Promise.resolve(sesion));
  const pasa = (): Promise<void> => Promise.resolve();
  instancia.decorate('conPermiso', () => pasa);
  instancia.decorate('conAlgunPermiso', () => pasa);
  await instancia.register(rutasOrdenes, { prefix: '/api' });
  await instancia.register(rutasConsultasOrden, { prefix: '/api' });
  await instancia.ready();
  return instancia;
}

/** Pide la URL y devuelve el código y el `cerradas` que recibió el dominio. */
async function pedir(
  url: string,
  dominio: ReturnType<typeof vi.fn>,
): Promise<{ codigo: number; cerradas: unknown }> {
  const instancia = await app();
  try {
    const res = await instancia.inject({ method: 'GET', url });
    const parametros = dominio.mock.lastCall?.[1] as { cerradas?: unknown } | undefined;
    return { codigo: res.statusCode, cerradas: parametros?.cerradas };
  } finally {
    await instancia.close();
  }
}

describe.each([
  ['GET /api/ordenes', '/api/ordenes', listarOrdenes],
  ['GET /api/ordenes/consulta', '/api/ordenes/consulta', consultarOrdenes],
] as const)('0.227 — %s y su `?cerradas=`', (_nombre, ruta, dominio) => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarOrdenes.mockResolvedValue(PAGINA_VACIA);
    consultarOrdenes.mockResolvedValue(PAGINA_VACIA);
  });

  it('⭐ SIN el parámetro el dominio recibe `incluir` (la consulta no cambia)', async () => {
    expect(await pedir(ruta, dominio)).toEqual({ codigo: 200, cerradas: 'incluir' });
  });

  it('`ocultar` y `solo` viajan tal cual al dominio', async () => {
    expect(await pedir(`${ruta}?cerradas=ocultar`, dominio)).toEqual({
      codigo: 200,
      cerradas: 'ocultar',
    });
    expect(await pedir(`${ruta}?cerradas=solo`, dominio)).toEqual({
      codigo: 200,
      cerradas: 'solo',
    });
  });

  it('un valor inventado es 400 y el dominio ni se toca', async () => {
    const { codigo } = await pedir(`${ruta}?cerradas=todas`, dominio);
    expect(codigo).toBe(400);
    expect(dominio).not.toHaveBeenCalled();
  });
});
