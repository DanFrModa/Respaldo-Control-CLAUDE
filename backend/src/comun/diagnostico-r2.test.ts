import { describe, expect, it } from 'vitest';

import {
  enmascarar,
  interpretarErrorR2,
  politicaCorsSugerida,
  probarPreflightCors,
} from './diagnostico-r2.js';

/**
 * Pruebas del DIAGNÓSTICO de R2. Lo que se cubre es el CRITERIO —el mapa «código de Cloudflare → qué
 * le pasó de verdad al usuario»— y la lectura del preflight, que es la parte que el navegador no
 * puede contar. Las llamadas a R2 no se prueban aquí (son del SDK): se inyecta un `fetch` de mentiras.
 */

/** Arma un error del SDK de S3 como llega en la vida real (nombre + metadata HTTP). */
function errorS3(nombre: string, codigoHttp: number): Error {
  const error = new Error(`${nombre} ocurrió`);
  error.name = nombre;
  Object.assign(error, { $metadata: { httpStatusCode: codigoHttp } });
  return error;
}

/** Respuesta de mentiras con las cabeceras que interesan del preflight. */
function respuestaConCabeceras(estado: number, cabeceras: Record<string, string>): Response {
  return new Response(null, { status: estado, headers: cabeceras });
}

describe('interpretarErrorR2', () => {
  const contexto = { bucket: 'control-v2-prueba', operacion: 'escribir' };

  it('reconoce un token que ya no existe (vencido, rotado o borrado)', () => {
    const { detalle, sugerencia } = interpretarErrorR2(
      errorS3('InvalidAccessKeyId', 403),
      contexto,
    );
    expect(detalle).toContain('no reconoce el Access Key');
    expect(sugerencia).toContain('R2_ACCESS_KEY_ID');
  });

  it('distingue el secreto equivocado del token inexistente', () => {
    const { detalle } = interpretarErrorR2(errorS3('SignatureDoesNotMatch', 403), contexto);
    expect(detalle).toContain('el secreto no es el suyo');
  });

  it('traduce el 403 pelón a "token de solo lectura o fuera de alcance"', () => {
    const { sugerencia } = interpretarErrorR2(errorS3('AccessDenied', 403), contexto);
    expect(sugerencia).toContain('Object Read & Write');
  });

  it('nombra el bucket cuando no existe', () => {
    const { detalle } = interpretarErrorR2(errorS3('NoSuchBucket', 404), contexto);
    expect(detalle).toContain('control-v2-prueba');
  });

  it('trata el DNS caído como cuenta mal escrita, no como falla del sistema', () => {
    const { sugerencia } = interpretarErrorR2(new Error('getaddrinfo ENOTFOUND x.r2'), contexto);
    expect(sugerencia).toContain('R2_ACCOUNT_ID');
  });

  it('no se calla ante un error desconocido: devuelve el código tal cual', () => {
    const { detalle } = interpretarErrorR2(errorS3('AlgoRaro', 500), contexto);
    expect(detalle).toContain('AlgoRaro');
    expect(detalle).toContain('500');
  });
});

describe('politicaCorsSugerida', () => {
  it('incluye PUT y los orígenes dados, en JSON pegable', () => {
    const politica: unknown = JSON.parse(politicaCorsSugerida(['https://front.example']));
    expect(politica).toEqual([
      {
        AllowedOrigins: ['https://front.example'],
        AllowedMethods: ['GET', 'PUT', 'HEAD'],
        AllowedHeaders: ['content-type'],
        ExposeHeaders: ['etag'],
        MaxAgeSeconds: 3600,
      },
    ]);
  });
});

describe('probarPreflightCors', () => {
  const url = 'https://cuenta.r2.cloudflarestorage.com/bucket/key';
  const origen = 'https://front.example';

  it('aprueba cuando R2 devuelve el origen permitido', async () => {
    const prueba = await probarPreflightCors(url, origen, () =>
      Promise.resolve(
        respuestaConCabeceras(200, {
          'access-control-allow-origin': origen,
          'access-control-allow-methods': 'GET, PUT, HEAD',
        }),
      ),
    );
    expect(prueba.estado).toBe('ok');
  });

  it('detecta el bucket SIN política CORS (la causa que el navegador disfraza de falla de red)', async () => {
    const prueba = await probarPreflightCors(url, origen, () =>
      Promise.resolve(respuestaConCabeceras(403, {})),
    );
    expect(prueba.estado).toBe('falla');
    expect(prueba.detalle).toContain('access-control-allow-origin');
  });

  it('detecta que la política quedó con el dominio VIEJO', async () => {
    const prueba = await probarPreflightCors(url, origen, () =>
      Promise.resolve(
        respuestaConCabeceras(200, { 'access-control-allow-origin': 'https://viejo.example' }),
      ),
    );
    expect(prueba.estado).toBe('falla');
    expect(prueba.detalle).toContain('viejo.example');
  });

  it('detecta el origen permitido pero SIN el método PUT', async () => {
    const prueba = await probarPreflightCors(url, origen, () =>
      Promise.resolve(
        respuestaConCabeceras(200, {
          'access-control-allow-origin': origen,
          'access-control-allow-methods': 'GET, HEAD',
        }),
      ),
    );
    expect(prueba.estado).toBe('falla');
    expect(prueba.detalle).toContain('falta PUT');
  });

  it('acepta el comodín', async () => {
    const prueba = await probarPreflightCors(url, origen, () =>
      Promise.resolve(respuestaConCabeceras(200, { 'access-control-allow-origin': '*' })),
    );
    expect(prueba.estado).toBe('ok');
  });

  it('no truena si la red se cae durante la prueba', async () => {
    const prueba = await probarPreflightCors(url, origen, () =>
      Promise.reject(new Error('sin red')),
    );
    expect(prueba.estado).toBe('falla');
    expect(prueba.detalle).toContain('sin red');
  });
});

describe('enmascarar', () => {
  it('deja ver el principio y el largo, nunca el resto', () => {
    expect(enmascarar('abcdef1234567890', 4)).toBe('abcd… (16 caracteres)');
  });

  it('avisa cuando el valor viene vacío', () => {
    expect(enmascarar('   ', 4)).toBe('(vacío)');
  });
});
