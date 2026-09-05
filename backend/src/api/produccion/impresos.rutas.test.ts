/**
 * ⭐⭐ 0.140 (3ª ronda) — **LA COSTURA QUE DECIDE QUÉ RECIBE EL NAVEGADOR.**
 *
 * ## El hueco que esto viene a tapar
 *
 * `POST /api/ordenes/impresos` responde **un PDF** cuando el lote cabe en un archivo y **un ZIP con
 * varios PDF** cuando no. El dominio que parte el lote y el empaquetador de ZIP tenían sus pruebas;
 * **la ruta que elige entre los dos, ninguna**. Un reviewer lo midió mutándola para que mandara
 * siempre `Content-Type: application/pdf` —o sea, entregarle al usuario un ZIP disfrazado de PDF,
 * un archivo que **no abre**— y la suite entera siguió verde: 228 pruebas pasaron.
 *
 * 🔑 **Y no es una cabecera cosmética: de ella cuelga la cadena entera.** El frontend deriva la
 * EXTENSIÓN del archivo de ese `Content-Type` (`ordenes-N.zip` vs `ordenes-N.pdf`), y el hook
 * anti-caché de `cache-documentos.ts` decide por él si la respuesta lleva `no-store`. Una línea mal
 * y el usuario acaba con un archivo que no abre, o viendo un impreso viejo.
 *
 * Se prueba SIN base de datos: el plugin real de rutas sobre un Fastify pelado, con el dominio
 * mockeado. Lo que se mira es el CONTRATO HTTP, que es donde estaba el riesgo.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SesionUsuario } from '../../comun/permisos.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { registrarNoCacheDocumentos } from '../cache-documentos.js';

/** Las partes que el dominio irá soltando: una por PDF del lote. */
let partesDelLote: Buffer[] = [];

vi.mock('../../dominio/produccion/impresos/impreso-orden.js', () => ({
  impresoOrden: vi.fn(() => Promise.resolve({ buffer: Buffer.from('%PDF-una'), folio: 900 })),
  impresoOrdenesPorPartes: vi.fn(function* generar(): Generator<Buffer> {
    yield* partesDelLote;
  }),
}));

const { rutasImpresosOrden } = await import('./impresos.rutas.js');

/** Monta el plugin real con los decoradores de auth simulados y el hook anti-caché de verdad. */
async function appDePrueba(
  sesion: SesionUsuario | null = sesionDePrueba(),
): Promise<FastifyInstance> {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('obtenerSesion', () => Promise.resolve(sesion));
  app.decorate('conPermiso', () => () => Promise.resolve(undefined));
  app.decorate('conAlgunPermiso', () => () => Promise.resolve(undefined));
  // El MISMO hook que monta `construirApp`: así estas pruebas también vigilan que el ZIP no se
  // quede fuera del anti-caché (fue justo lo que pasó al agregarlo).
  registrarNoCacheDocumentos(app);
  await app.register(rutasImpresosOrden, { prefix: '/api' });
  await app.ready();
  return app;
}

/** Pide el impreso por lote de `cuantas` órdenes. */
async function pedirLote(app: FastifyInstance, cuantas = 3) {
  return app.inject({
    method: 'POST',
    url: '/api/ordenes/impresos',
    payload: { ids: Array.from({ length: cuantas }, (_, i) => i + 1) },
  });
}

beforeEach(() => {
  partesDelLote = [];
});

describe('POST /ordenes/impresos — qué recibe el navegador (0.140)', () => {
  it('🔴 UNA sola parte ⇒ PDF, y el nombre del archivo dice .pdf', async () => {
    partesDelLote = [Buffer.from('%PDF-1.7 un solo archivo')];
    const app = await appDePrueba();

    const respuesta = await pedirLote(app);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.headers['content-type']).toContain('application/pdf');
    expect(String(respuesta.headers['content-disposition'])).toContain('.pdf');
    expect(String(respuesta.headers['content-disposition'])).not.toContain('.zip');
    expect(respuesta.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    await app.close();
  });

  it('🔴 VARIAS partes ⇒ ZIP, y el nombre del archivo dice .zip', async () => {
    // Ésta es la mutación que sobrevivió: si la ruta manda `application/pdf` aquí, el usuario baja
    // un ZIP con nombre .pdf y no lo puede abrir. El frontend saca la extensión de esta cabecera.
    partesDelLote = [Buffer.from('%PDF-parte-1'), Buffer.from('%PDF-parte-2')];
    const app = await appDePrueba();

    const respuesta = await pedirLote(app);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.headers['content-type']).toContain('application/zip');
    expect(String(respuesta.headers['content-disposition'])).toContain('.zip');
    expect(String(respuesta.headers['content-disposition'])).not.toContain('.pdf');
    // Y lo que sale es un ZIP de verdad: su firma son los bytes `PK\x03\x04`.
    expect([...respuesta.rawPayload.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    await app.close();
  });

  it('🔑 el ZIP trae DENTRO los PDF del lote, con nombre numerado', async () => {
    partesDelLote = [Buffer.from('%PDF-primera'), Buffer.from('%PDF-segunda')];
    const app = await appDePrueba();

    const zip = (await pedirLote(app)).rawPayload;

    // Sin descomprimir del todo: en un ZIP ALMACENADO los nombres y el contenido están en claro.
    const comoTexto = zip.toString('latin1');
    expect(comoTexto).toContain('ordenes-parte-01.pdf');
    expect(comoTexto).toContain('ordenes-parte-02.pdf');
    expect(comoTexto).toContain('%PDF-primera');
    expect(comoTexto).toContain('%PDF-segunda');
    await app.close();
  });

  it('🔴 LAS DOS respuestas salen con `no-store` (el incidente del PDF viejo, 26-jul)', async () => {
    // El hook anti-caché mira el `Content-Type`, así que cambiar la respuesta a un tipo nuevo la
    // saca de su cobertura sin que nada avise. Se comprueban las dos ramas, no una.
    const app = await appDePrueba();

    partesDelLote = [Buffer.from('%PDF-solo')];
    expect((await pedirLote(app)).headers['cache-control']).toBe('no-store');

    partesDelLote = [Buffer.from('%PDF-1'), Buffer.from('%PDF-2')];
    expect((await pedirLote(app)).headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('el impreso de UNA orden sigue saliendo como PDF con su folio', async () => {
    const app = await appDePrueba();
    const respuesta = await app.inject({ method: 'GET', url: '/api/ordenes/7/impreso' });

    expect(respuesta.headers['content-type']).toContain('application/pdf');
    expect(String(respuesta.headers['content-disposition'])).toContain('orden-900.pdf');
    expect(respuesta.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('sin sesión, el impreso por lote no se genera', async () => {
    const app = await appDePrueba(null);
    const respuesta = await pedirLote(app);
    expect(respuesta.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });
});
