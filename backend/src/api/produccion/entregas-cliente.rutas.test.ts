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
 * ⭐ Fila 0.200 — **LA PUERTA DEL COMPROBANTE DE ENTREGA A CLIENTE**, probada a nivel HTTP y **SIN
 * base de datos** (mismo patrón que `etapas.rutas.test.ts`).
 *
 * POR QUÉ EXISTE. La ruta `GET /produccion/entregas-cliente/:id/comprobante` pedía
 * `produccion.entrega` mientras su dominio (`impresoEntregaCliente` → `armarDatosImpresoEntrega` →
 * `obtenerEntrega`) exige **`produccion.wip-ver`**: quien tuviera el primero SIN el segundo **pasaba
 * la puerta y se estrellaba contra la reja de adentro**, con el PDF a medio abrir. Los tres impresos
 * hermanos (`envios/:id/impreso`, `recibos/:id/impreso`) nunca tuvieron el desajuste, y son el
 * patrón: el permiso de la RUTA coincide con el del DOMINIO porque una reimpresión del histórico es
 * una CONSULTA. Nada fijaba ese permiso, así que el desajuste podía volver sin que nadie se enterara.
 *
 * CÓMO. Se monta el plugin REAL sobre un Fastify pelado con el dominio mockeado, y el guard replica
 * la semántica de `auth/plugin.ts` (deny-by-default): 401 sin sesión, 403 sin el permiso. Lo que se
 * afirma no es la implementación del guard —ésa vive en el plugin real— sino **cuál permiso pide esta
 * ruta**. ⚠️ El dominio va mockeado, así que la reja de `obtenerEntrega` NO corre aquí: lo que estas
 * pruebas garantizan es que **la puerta pide lo mismo que la reja**, que es donde estaba el defecto.
 */

const impresoEntregaCliente = vi.fn();

vi.mock('../../dominio/produccion/entregas-cliente.js', () => ({
  registrarEntregaCliente: vi.fn(),
  cancelarEntregaCliente: vi.fn(),
  listarEntregasOrden: vi.fn(),
  seguimientoEntregaOrden: vi.fn(),
}));

vi.mock('../../dominio/produccion/impresos/impreso-entrega-cliente.js', () => ({
  impresoEntregaCliente: (...a: unknown[]) => impresoEntregaCliente(...a) as unknown,
}));

const { rutasEntregasCliente } = await import('./entregas-cliente.rutas.js');

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

  await app.register(rutasEntregasCliente, { prefix: '/api' });
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

const URL_COMPROBANTE = '/api/produccion/entregas-cliente/71/comprobante';

describe('GET /produccion/entregas-cliente/:id/comprobante (fila 0.200)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Un PDF válido para que un fallo del impreso no se disfrace del 200 que se está midiendo.
    impresoEntregaCliente.mockResolvedValue({ buffer: Buffer.from('%PDF-1.7'), folio: 3 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sin sesión → 401 (y el dominio ni se toca)', async () => {
    expect(await codigo(null, URL_COMPROBANTE)).toBe(401);
    expect(impresoEntregaCliente).not.toHaveBeenCalled();
  });

  it('⭐ con `produccion.entrega` pero SIN `produccion.wip-ver` → 403: la PUERTA lo corta', async () => {
    // EL corazón de la fila 0.200. Antes, este permiso abría la puerta y el 403 llegaba del DOMINIO,
    // ya dentro del handler. Ahora lo corta el guard y el impreso ni se intenta: capturar una entrega
    // no da derecho a reimprimir el histórico (para eso está `produccion.wip-ver`).
    expect(await codigo(con('produccion.entrega'), URL_COMPROBANTE)).toBe(403);
    expect(impresoEntregaCliente).not.toHaveBeenCalled();
  });

  it('con una sesión sin ninguno de los dos permisos → 403 (deny-by-default)', async () => {
    expect(await codigo(con('produccion.corte'), URL_COMPROBANTE)).toBe(403);
    expect(impresoEntregaCliente).not.toHaveBeenCalled();
  });

  it('con `produccion.wip-ver` la puerta se abre (200, la gemela positiva)', async () => {
    // Y se abre con `wip-ver` A SECAS: sin `produccion.entrega`, porque reimprimir es consultar.
    expect(await codigo(con('produccion.wip-ver'), URL_COMPROBANTE)).toBe(200);
    expect(impresoEntregaCliente).toHaveBeenCalledTimes(1);
  });

  it('el id de la entrega llega al dominio como NÚMERO (no la cadena "71")', async () => {
    await codigo(con('produccion.wip-ver'), URL_COMPROBANTE);
    expect(impresoEntregaCliente.mock.calls[0]?.slice(1)).toEqual([71]);
  });

  it('responde el PDF con su nombre de archivo por folio', async () => {
    const app = await appCon(con('produccion.wip-ver'));
    try {
      const res = await app.inject({ method: 'GET', url: URL_COMPROBANTE });
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe('inline; filename="entrega-cliente-3.pdf"');
    } finally {
      await app.close();
    }
  });
});

describe('Las consultas hermanas del mismo plugin piden `produccion.wip-ver`', () => {
  // Contexto de la fila 0.200: el comprobante quedó alineado con ESTAS dos, que ya iban con el
  // permiso de consulta. Se fijan aquí para que las tres se muevan juntas o no se muevan.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['historial de entregas', '/api/produccion/ordenes/50/entregas'],
    ['seguimiento de la entrega', '/api/produccion/ordenes/50/seguimiento-entrega'],
  ])('%s: con `produccion.entrega` a secas → 403', async (_nombre, url) => {
    expect(await codigo(con('produccion.entrega'), url)).toBe(403);
  });
});
