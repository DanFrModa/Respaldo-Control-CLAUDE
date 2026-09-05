import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { esDocumentoGenerado, registrarNoCacheDocumentos } from './cache-documentos.js';

/**
 * ⭐⭐ 0.140 (4ª ronda) — **EL INVENTARIO SE SACA DEL CÓDIGO, NO SE ESCRIBE AQUÍ.**
 *
 * La ronda anterior puso una lista literal de tres cadenas y la llamó «cruce mecánico»: era la
 * misma lista de `MIMES_DOCUMENTO` copiada, así que un tipo nuevo la dejaba verde — justo el fallo
 * que decía prevenir (y el mismo defecto que el ZIP de esta fila: nadie se acordó de la lista).
 *
 * Esto recorre `src/api` y `src/dominio` y saca los MIME que el código pone de verdad en una
 * respuesta. Reconoce las tres formas que usa el repo: `header('Content-Type', '…')`, `.type('…')`
 * y `contentType: '…'`. Si mañana alguien inventa una cuarta forma, hay que añadirla aquí — pero
 * mientras use una de las tres, **un tipo nuevo aparece solo**.
 */
const FORMAS_DE_PONER_EL_TIPO =
  /(?:Content-Type'\s*,\s*'|\.type\('|contentType:\s*')([a-z]+\/[A-Za-z0-9.+_-]+)/g;

/** Todos los `.ts` de una carpeta y sus subcarpetas, saltándose las PRUEBAS (que traen ejemplos). */
function fuentesDe(carpeta: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) salida.push(...fuentesDe(ruta));
    else if (entrada.name.endsWith('.ts') && !entrada.name.includes('.test.')) salida.push(ruta);
  }
  return salida;
}

/** Los MIME que el API emite hoy, leídos del código fuente. */
function mimesQueEmiteElApi(): string[] {
  const raiz = join(import.meta.dirname, '..');
  const encontrados = new Set<string>();
  for (const archivo of [...fuentesDe(join(raiz, 'api')), ...fuentesDe(join(raiz, 'dominio'))]) {
    const texto = readFileSync(archivo, 'utf8');
    for (const coincidencia of texto.matchAll(FORMAS_DE_PONER_EL_TIPO)) {
      const mime = coincidencia[1];
      if (mime !== undefined) encontrados.add(mime);
    }
  }
  return [...encontrados].sort();
}

/** App mínima con el hook + una ruta por cada forma de respuesta que el API sabe producir. */
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

  // ⭐ 0.140: el impreso de órdenes POR LOTE responde un ZIP cuando el lote no cabe en un archivo.
  app.get('/lote-zip', (_p, reply) => {
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', 'attachment; filename="ordenes.zip"');
    return reply.send(Buffer.from('PK\u0003\u0004'));
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

  it('🔴 reconoce el ZIP del impreso por lote (0.140)', () => {
    // Se agregó un tipo nuevo y salió SIN `no-store` hasta que un reviewer lo midió: el hook
    // prometía cubrir «los que se agreguen mañana» y no cubre lo que no está en la lista.
    expect(esDocumentoGenerado('application/zip')).toBe(true);
    expect(esDocumentoGenerado('application/zip; charset=binary')).toBe(true);
  });

  it('🔴 CRUCE MECÁNICO: todo MIME que el API emite —leído del CÓDIGO— cae del lado correcto', () => {
    // La REGLA, que es lo único escrito a mano: `image/*` es un ASSET (decide su propia caché) y
    // todo lo demás que el API emita es un DOCUMENTO GENERADO y tiene que llevar `no-store`. No hay
    // lista de MIME aquí: el inventario sale de `src/api` + `src/dominio`, así que un tipo nuevo
    // pone esto en rojo AQUÍ —barato— y no en la pantalla de alguien viendo un archivo viejo.
    const emitidos = mimesQueEmiteElApi();
    // Red de seguridad del propio barrido: si el escaneo deja de encontrar nada (se movió una
    // carpeta, cambió la forma de poner el tipo), la prueba no puede pasar en vacío.
    expect(
      emitidos.length,
      'el barrido no encontró NINGÚN Content-Type: ya no lee el código',
    ).toBeGreaterThanOrEqual(3);
    expect(emitidos, 'el PDF de los impresos tiene que estar en el inventario').toContain(
      'application/pdf',
    );

    for (const mime of emitidos) {
      const esAsset = mime.startsWith('image/');
      expect(
        esDocumentoGenerado(mime),
        esAsset
          ? `${mime} es un asset y NO debería llevar no-store`
          : `${mime} lo emite el API y se cachearía en el navegador: falta en MIMES_DOCUMENTO`,
      ).toBe(!esAsset);
    }
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

  it('🔴 el ZIP del impreso por lote también sale con no-store (0.140)', async () => {
    const app = await appDePrueba();
    const respuesta = await app.inject({ method: 'GET', url: '/lote-zip' });
    expect(respuesta.headers['cache-control']).toBe('no-store');
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
