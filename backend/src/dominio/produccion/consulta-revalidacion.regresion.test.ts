import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import {
  esquemaConsultaOrdenes,
  esquemaTableroPedidosMesQuery,
} from '../../contrato/esquemas/orden-consulta.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { consultarOrdenes, tableroPedidosPorMes } from './consultas.js';

/**
 * Regresión del HOTFIX `tarea/fix-stringbool-query-400`.
 *
 * ROOT CAUSE: la ruta (fastify-type-provider-zod) coacciona el querystring (texto → boolean) y el
 * dominio RE-VALIDABA ese `request.query` (ya booleano) con el MISMO esquema del contrato. Con Zod
 * 4.4.x `z.stringbool()` SOLO acepta texto, así que re-validar un booleano LANZA `ErrorValidacion` y
 * el error handler responde 400. Se veía en `/api/ordenes/consulta` y
 * `/api/ordenes/tablero/pedidos-por-mes`.
 *
 * EL ARREGLO (consistente con el resto del codebase): el dominio (`consultas.ts`) define SU PROPIO
 * esquema con `z.boolean()` (`esquemaConsultaOrdenesDominio`/`esquemaTableroPedidosMesDominio`) y
 * re-valida con ese; el contrato conserva `z.stringbool()` para la URL.
 *
 * Este test cubre las DOS puntas, sin Docker:
 *  1) La RUTA real (Fastify inject) coacciona la bandera a `boolean` (no 400 de validación).
 *  2) El DOMINIO (`consultarOrdenes`/`tableroPedidosPorMes`) acepta ese `boolean` SIN lanzar. Si
 *     alguien revirtiera el dominio a re-validar con el esquema del contrato (stringbool), estos
 *     casos volverían a lanzar `ErrorValidacion` → el test los caza.
 */

const sesionVer = () => sesionDePrueba({ permisos: ['ordenes.ver'] });

// ── 1) La ruta coacciona la querystring a boolean (no 400) ───────────────────────────

/** Monta una app Fastify mínima que valida `querystring` con el esquema dado y devuelve `req.query`. */
function montarApp(esquema: z.ZodType): FastifyInstance {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.get('/t', { schema: { querystring: esquema } }, (req) => req.query);
  return app;
}

/** Forma mínima de la salida de `/t` (eco de `req.query` ya coaccionado). */
interface SalidaBandera {
  incluirCanceladas?: boolean;
  entregadosTienda?: boolean;
  noProducir?: boolean;
}

describe('ruta /ordenes/consulta — la bandera del querystring se coacciona a boolean', () => {
  it('?incluirCanceladas=true → 200 y boolean true', async () => {
    const app = montarApp(esquemaConsultaOrdenes);
    const res = await app.inject({ method: 'GET', url: '/t?incluirCanceladas=true&pagina=1' });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json<SalidaBandera>().incluirCanceladas).toBe(true);
  });

  it('?incluirCanceladas=false → 200 y boolean false', async () => {
    const app = montarApp(esquemaConsultaOrdenes);
    const res = await app.inject({ method: 'GET', url: '/t?incluirCanceladas=false&pagina=1' });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json<SalidaBandera>().incluirCanceladas).toBe(false);
  });
});

describe('ruta /ordenes/tablero/pedidos-por-mes — banderas del querystring a boolean', () => {
  it('?incluirCanceladas=true&entregadosTienda=true&noProducir=false → 200 y booleanos', async () => {
    const app = montarApp(esquemaTableroPedidosMesQuery);
    const res = await app.inject({
      method: 'GET',
      url: '/t?incluirCanceladas=true&entregadosTienda=true&noProducir=false',
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const salida = res.json<SalidaBandera>();
    expect(salida.incluirCanceladas).toBe(true);
    expect(salida.entregadosTienda).toBe(true);
    expect(salida.noProducir).toBe(false);
  });
});

// ── 2) El dominio re-valida ese boolean SIN lanzar (el meollo del bug) ────────────────

/** Stub mínimo de BD: ninguna orden (basta para llegar pasada la re-validación sin tocar datos). */
function bdVacia(): ContextoBd {
  const tx = {
    orden: {
      count: vi.fn(() => Promise.resolve(0)),
      findMany: vi.fn(() => Promise.resolve([])),
    },
    ordenLinea: { findMany: vi.fn(() => Promise.resolve([])) },
    ordenLineaTalla: { groupBy: vi.fn(() => Promise.resolve([])) },
  } as unknown as Tx;
  return { tx };
}

describe('dominio — re-valida la bandera boolean ya coaccionada SIN lanzar (no stringbool)', () => {
  it('consultarOrdenes acepta incluirCanceladas:true (boolean) sin ErrorValidacion', async () => {
    await expect(
      consultarOrdenes(sesionVer(), { incluirCanceladas: true, pagina: 1 }, bdVacia()),
    ).resolves.toBeDefined();
  });

  it('consultarOrdenes acepta incluirCanceladas:false (boolean) sin ErrorValidacion', async () => {
    await expect(
      consultarOrdenes(sesionVer(), { incluirCanceladas: false }, bdVacia()),
    ).resolves.toBeDefined();
  });

  it('tableroPedidosPorMes acepta banderas boolean sin ErrorValidacion', async () => {
    await expect(
      tableroPedidosPorMes(
        sesionVer(),
        { incluirCanceladas: true, entregadosTienda: true, noProducir: false },
        bdVacia(),
      ),
    ).resolves.toBeDefined();
  });

  it('control negativo: el esquema del CONTRATO (stringbool) SÍ rechaza el boolean (caza el bug)', () => {
    // Si el dominio volviera a re-validar con el contrato, esto es lo que pasaría: lanza. El dominio
    // NO debe comportarse así: re-valida con z.boolean() (probado en los casos de arriba).
    expect(() => esquemaConsultaOrdenes.parse({ incluirCanceladas: true, pagina: 1 })).toThrow();
  });
});
