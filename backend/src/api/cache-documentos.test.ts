import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { esDocumentoGenerado, registrarNoCacheDocumentos } from './cache-documentos.js';

/** App mínima con el hook + tres rutas: un PDF, un JSON y un asset con su propia caché. */
async function appDePrueba() {
  const app = Fastify();
  registrarNoCacheDocumentos(app);

  app.get('/impreso', (_p, reply) => {
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'inline; filename="orden-1.pdf"');
    return reply.send(Buffer.from('%PDF-1.7'));
  });

  app.get('/export', (_p, reply) => {
    reply.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    return reply.send(Buffer.from('PK'));
  });

  app.get('/datos', (_p, reply) => reply.send({ ok: true }));

  // Espejo del `GET /api/empresas/logo`: binario, pero es un ASSET y decide su propia caché.
  app.get('/logo', (_p, reply) => {
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(Buffer.from('\x89PNG'));
  });

  // Caso borde: una ruta que sirve PDF y YA decidió su caché a mano → el hook la respeta.
  app.get('/pdf-con-cache', (_p, reply) => {
    reply.header('Content-Type', 'application/pdf');
    reply.header('Cache-Control', 'private, max-age=600');
    return reply.send(Buffer.from('%PDF-1.7'));
  });

  await app.ready();
  return app;
}

describe('esDocumentoGenerado', () => {
  it('reconoce el PDF (con y sin parámetros en el content-type)', () => {
    expect(esDocumentoGenerado('application/pdf')).toBe(true);
    expect(esDocumentoGenerado('application/pdf; charset=utf-8')).toBe(true);
    expect(esDocumentoGenerado('APPLICATION/PDF')).toBe(true);
  });

  it('reconoce el Excel de los exports', () => {
    expect(
      esDocumentoGenerado('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe(true);
  });

  it('NO marca imágenes, JSON ni un content-type ausente', () => {
    expect(esDocumentoGenerado('image/png')).toBe(false);
    expect(esDocumentoGenerado('application/json; charset=utf-8')).toBe(false);
    expect(esDocumentoGenerado(undefined)).toBe(false);
  });
});

describe('registrarNoCacheDocumentos (incidente del PDF viejo, 26-jul-2026)', () => {
  it('un impreso PDF sale con Cache-Control: no-store', async () => {
    const app = await appDePrueba();
    const r = await app.inject({ method: 'GET', url: '/impreso' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('un export Excel también sale con no-store', async () => {
    const app = await appDePrueba();
    const r = await app.inject({ method: 'GET', url: '/export' });
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('el LOGO conserva su caché larga (el hook no lo toca)', async () => {
    const app = await appDePrueba();
    const r = await app.inject({ method: 'GET', url: '/logo' });
    expect(r.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    await app.close();
  });

  it('respeta un Cache-Control que la ruta ya fijó, aunque sea un PDF', async () => {
    const app = await appDePrueba();
    const r = await app.inject({ method: 'GET', url: '/pdf-con-cache' });
    expect(r.headers['cache-control']).toBe('private, max-age=600');
    await app.close();
  });

  it('no le pone cabecera de caché a los JSON del API', async () => {
    const app = await appDePrueba();
    const r = await app.inject({ method: 'GET', url: '/datos' });
    expect(r.headers['cache-control']).toBeUndefined();
    await app.close();
  });
});
