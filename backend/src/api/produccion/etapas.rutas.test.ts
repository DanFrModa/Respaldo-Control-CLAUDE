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
 * ⭐ V1-E8i (§Post-F9.131) — **LA PUERTA Y EL CABLE de `/produccion/ordenes/:id/sugerencia-captura`**,
 * probados a nivel HTTP y **SIN base de datos** (mismo patrón que `receta-orden.rutas.test.ts`, que
 * nació de un hallazgo de reviewer por este mismo hueco).
 *
 * POR QUÉ EXISTE (hallazgo del reviewer, H1). La consulta que alimenta los botones «Llenar con lo que
 * falta por cortar» / «Llenar con lo que se cortó» nacía **sin una sola prueba de su ruta**: ni el
 * permiso que exige, ni —lo que más duele— que el `idTipoProceso` de la querystring llegue al dominio
 * **como número**. Ese parámetro es el que distingue la base CORTE de la base ENVÍO y, dentro del
 * envío, **a qué proceso** se le pregunta (D8: costura y arte consumen las mismas piezas en flujos
 * paralelos y NO se restan entre sí). Si se perdiera por el camino, el botón de arte contestaría con
 * los envíos de costura — y nada lo cazaba.
 *
 * CÓMO. Se monta el plugin REAL sobre un Fastify pelado con el dominio mockeado, y el guard replica
 * la semántica de `auth/plugin.ts` (deny-by-default): 401 sin sesión, 403 sin el permiso. Lo que se
 * afirma no es la implementación del guard —ésa vive en el plugin real— sino **cuál pide esta ruta**
 * y **con qué argumentos** llama al dominio.
 */

const sugerirCaptura = vi.fn();
const pendientesPorOrden = vi.fn();

vi.mock('../../dominio/produccion/etapas.js', () => ({
  sugerirCaptura: (...a: unknown[]) => sugerirCaptura(...a) as unknown,
  pendientesPorOrden: (...a: unknown[]) => pendientesPorOrden(...a) as unknown,
  registrarCorte: vi.fn(),
  registrarEnvioMaquila: vi.fn(),
  cancelarEtapaMovimiento: vi.fn(),
  listarEtapasOrden: vi.fn(),
  corteSemanalPorCortador: vi.fn(),
}));

vi.mock('../../dominio/produccion/impresos/impreso-envio-maquila.js', () => ({
  impresoEnvioMaquila: vi.fn(),
  impresoFichaEstampado: vi.fn(),
}));

const { rutasEtapasProduccion } = await import('./etapas.rutas.js');

/** Monta el plugin real con el guard deny-by-default de `auth/plugin.ts`. */
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

  await app.register(rutasEtapasProduccion, { prefix: '/api' });
  await app.ready();
  return app;
}

/** Sesión con exactamente estos permisos. */
function con(...permisos: ClavePermiso[]): SesionUsuario {
  return sesionDePrueba({ permisos, idEmpresaActiva: 1 });
}

/** El código de una petición GET con la sesión dada (≠403 = el guard dejó pasar). */
async function codigo(sesion: SesionUsuario | null, url: string): Promise<number> {
  const app = await appCon(sesion);
  try {
    const res = await app.inject({ method: 'GET', url });
    return res.statusCode;
  } finally {
    await app.close();
  }
}

describe('GET /produccion/ordenes/:id/sugerencia-captura (V1-E8i)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // La sugerencia se serializa contra su esquema: se devuelve una respuesta VÁLIDA para que un
    // fallo de serialización no se disfrace del 200 que se está midiendo.
    sugerirCaptura.mockResolvedValue({
      idOrden: 50,
      base: 'corte',
      idTipoProceso: null,
      celdas: [],
      total: 0,
      motivo: 'todo-cortado',
    });
    pendientesPorOrden.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sin sesión → 401 (y el dominio ni se toca)', async () => {
    expect(await codigo(null, '/api/produccion/ordenes/50/sugerencia-captura')).toBe(401);
    expect(sugerirCaptura).not.toHaveBeenCalled();
  });

  it('con sesión pero SIN `produccion.wip-ver` → 403 (deny-by-default)', async () => {
    expect(
      await codigo(con('produccion.corte'), '/api/produccion/ordenes/50/sugerencia-captura'),
    ).toBe(403);
    expect(sugerirCaptura).not.toHaveBeenCalled();
  });

  it('con `produccion.wip-ver` la puerta se abre (200, la gemela positiva)', async () => {
    expect(
      await codigo(con('produccion.wip-ver'), '/api/produccion/ordenes/50/sugerencia-captura'),
    ).toBe(200);
    expect(sugerirCaptura).toHaveBeenCalledTimes(1);
  });

  it('SIN `idTipoProceso` el dominio recibe la orden y una query vacía (base CORTE)', async () => {
    await codigo(con('produccion.wip-ver'), '/api/produccion/ordenes/50/sugerencia-captura');
    expect(sugerirCaptura.mock.calls[0]?.slice(1)).toEqual([50, {}]);
  });

  it('⭐ `?idTipoProceso=5` llega al dominio como el NÚMERO 5 (no la cadena "5")', async () => {
    // Es el parámetro que elige la base ENVÍO y, dentro de ella, A QUÉ PROCESO se le pregunta (D8).
    // Si se perdiera o llegara como texto, el botón de arte contestaría con los envíos de costura.
    await codigo(
      con('produccion.wip-ver'),
      '/api/produccion/ordenes/50/sugerencia-captura?idTipoProceso=5',
    );
    expect(sugerirCaptura.mock.calls[0]?.slice(1)).toEqual([50, { idTipoProceso: 5 }]);
  });

  it('un `idTipoProceso` que no es entero positivo se corta ANTES del handler (no llega al dominio)', async () => {
    // ⚠️ Aquí NO se afirma el código 400: este Fastify pelado no monta el mapeador de errores de la
    // app real (`servidor.ts`), así que el rechazo de Zod sale como 500. Lo que sí se mide —y es lo
    // que importa— es que la validación de la querystring corre antes del handler y el dominio ni
    // se entera. El 400 de cara al usuario lo fija la app completa.
    const código = await codigo(
      con('produccion.wip-ver'),
      '/api/produccion/ordenes/50/sugerencia-captura?idTipoProceso=0',
    );
    expect(código).not.toBe(200);
    expect(sugerirCaptura).not.toHaveBeenCalled();
  });
});
