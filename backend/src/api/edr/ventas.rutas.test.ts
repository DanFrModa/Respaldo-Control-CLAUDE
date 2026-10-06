import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClavePermiso, VentasSalida } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

/**
 * ⭐⭐ Fila 0.251 (§Post-F9.260(b)) — **LA PUERTA HTTP de Ventas, partida de la del EDR**, probada
 * SIN base de datos.
 *
 * Daniel le negó `edr.ver` a Administración y Finanzas (abre el estado de resultados entero: costo
 * actual y utilidad bruta), y esa misma llave era la única que abría Ventas. Desde la 0.251 Ventas se
 * abre con `ventas.ver` **o** con `edr.ver`. Lo que se fija aquí son las DOS mitades de la promesa:
 *
 *  • `ventas.ver` a secas abre Ventas (pantalla y Excel) y **NINGUNA** ruta del EDR;
 *  • `edr.ver` sigue abriendo todo lo que abría, Ventas incluida (nadie pierde nada).
 *
 * El dominio re-exige lo mismo (`exigirVerVentas`, `ventas.int.test.ts`); esto fija la decisión
 * del ARCHIVO DE RUTAS. Mismo molde que `ordenes-cierre.rutas.test.ts`: el plugin REAL sobre un
 * Fastify pelado, el dominio mockeado y los guards con la semántica de `auth/plugin.ts`.
 */

const listarVentas = vi.fn();
const excelVentas = vi.fn();
const dominioEdr = {
  actualizarEncabezado: vi.fn(),
  agregarLineaManual: vi.fn(),
  ajustarLineaEdr: vi.fn(),
  calcularEdr: vi.fn(),
  edrPorAnio: vi.fn(),
  edrPorMes: vi.fn(),
  eliminarLineaManual: vi.fn(),
  generarEdrMes: vi.fn(),
  listarLineasEdr: vi.fn(),
};
const impresoEdrMensual = vi.fn();
const impresoEdrAnual = vi.fn();
const excelEdr = vi.fn();

vi.mock('../../dominio/edr/ventas.js', () => ({
  listarVentas: (...a: unknown[]) => listarVentas(...a) as unknown,
}));
vi.mock('../../dominio/edr/impresos/excel-ventas.js', () => ({
  excelVentas: (...a: unknown[]) => excelVentas(...a) as unknown,
}));
vi.mock('../../dominio/edr/edr.js', () => dominioEdr);
vi.mock('../../dominio/edr/impresos/impreso-edr-mensual.js', () => ({
  impresoEdrMensual: (...a: unknown[]) => impresoEdrMensual(...a) as unknown,
}));
vi.mock('../../dominio/edr/impresos/impreso-edr-anual.js', () => ({
  impresoEdrAnual: (...a: unknown[]) => impresoEdrAnual(...a) as unknown,
}));
vi.mock('../../dominio/edr/impresos/excel-edr.js', () => ({
  excelEdr: (...a: unknown[]) => excelEdr(...a) as unknown,
}));

const { rutasEdr } = await import('./edr.rutas.js');

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
  await app.register(rutasEdr, { prefix: '/api' });
  await app.ready();
  return app;
}

function con(...permisos: ClavePermiso[]): SesionUsuario {
  return sesionDePrueba({ permisos, idEmpresaActiva: 1 });
}

async function codigo(sesion: SesionUsuario | null, url: string): Promise<number> {
  const app = await appCon(sesion);
  try {
    const res = await app.inject({ method: 'GET', url });
    return res.statusCode;
  } finally {
    await app.close();
  }
}

const VENTAS = '/api/edr/ventas?anio=2026&mes=6';
const VENTAS_EXCEL = '/api/edr/ventas/excel?anio=2026';

/** TODAS las lecturas del EDR (las que guarda `edr.ver`). Ninguna puede abrirse con `ventas.ver`. */
const LECTURAS_DEL_EDR: readonly string[] = [
  '/api/edr/por-mes?anio=2026&mes=6',
  '/api/edr/por-anio?anio=2026',
  '/api/edr/por-anio/impreso?anio=2026',
  '/api/edr/7',
  '/api/edr/7/lineas',
  '/api/edr/7/impreso',
  '/api/edr/7/excel',
];

const SALIDA_VENTAS: VentasSalida = {
  anio: 2026,
  mes: 6,
  resumen: { importe: 0, unidades: 0, ticketPromedio: 0, lineas: 0 },
  lineas: [],
  total: 0,
  pagina: 1,
  porPagina: 50,
  totalPaginas: 0,
};

describe('0.251 — Ventas tiene puerta propia, y el EDR no se abre con ella', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarVentas.mockResolvedValue(SALIDA_VENTAS);
    excelVentas.mockResolvedValue({ buffer: Buffer.from('xlsx') });
  });

  it('⭐ con SÓLO `ventas.ver` entra a Ventas (200) y llega al dominio', async () => {
    expect(await codigo(con('ventas.ver'), VENTAS)).toBe(200);
    expect(listarVentas).toHaveBeenCalledTimes(1);
  });

  it('⭐ con SÓLO `ventas.ver` también baja el Excel de Ventas', async () => {
    expect(await codigo(con('ventas.ver'), VENTAS_EXCEL)).toBe(200);
    expect(excelVentas).toHaveBeenCalledTimes(1);
  });

  it.each(LECTURAS_DEL_EDR)(
    '⛔ con SÓLO `ventas.ver` el EDR sigue cerrado: %s → 403, sin tocar el dominio',
    async (url) => {
      expect(await codigo(con('ventas.ver'), url)).toBe(403);
      for (const fn of [
        ...Object.values(dominioEdr),
        impresoEdrMensual,
        impresoEdrAnual,
        excelEdr,
      ]) {
        expect(fn).not.toHaveBeenCalled();
      }
    },
  );

  it('⭐ con `edr.ver` (sin `ventas.ver`) Ventas sigue abierta: quien la tenía no pierde nada', async () => {
    expect(await codigo(con('edr.ver'), VENTAS)).toBe(200);
    expect(await codigo(con('edr.ver'), VENTAS_EXCEL)).toBe(200);
  });

  it.each(LECTURAS_DEL_EDR)('con `edr.ver` el EDR sigue abierto: %s ≠ 403', async (url) => {
    // El cuerpo no importa (el dominio está mockeado y puede no serializar): lo que se fija es que
    // el guard DEJÓ PASAR.
    expect(await codigo(con('edr.ver'), url)).not.toBe(403);
  });

  it('sin ninguna de las dos → 403; sin sesión → 401', async () => {
    expect(await codigo(con('edr.capturar', 'costos.ver'), VENTAS)).toBe(403);
    expect(await codigo(con('edr.capturar', 'costos.ver'), VENTAS_EXCEL)).toBe(403);
    expect(await codigo(null, VENTAS)).toBe(401);
    expect(listarVentas).not.toHaveBeenCalled();
    expect(excelVentas).not.toHaveBeenCalled();
  });
});
