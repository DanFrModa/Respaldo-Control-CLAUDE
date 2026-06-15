import { describe, expect, it, vi } from 'vitest';

import { sesionDePrueba } from '../pruebas/sesiones.js';
import {
  configR2DesdeEnv,
  crearClienteR2,
  crearServicioArchivos,
  EXPIRACION_SUBIDA_SEGUNDOS,
  sanearNombreArchivo,
  TAMANO_MAXIMO_BYTES,
} from './archivos.js';
import { ErrorValidacion } from './errores.js';
import type { Tx } from './transaccion.js';

const ENV_COMPLETA = {
  R2_ACCOUNT_ID: 'cuenta123',
  R2_ACCESS_KEY_ID: 'llave-falsa',
  R2_SECRET_ACCESS_KEY: 'secreto-falso',
  R2_BUCKET: 'control-v2-prueba',
};

/**
 * Cliente y servicio reales pero con credenciales FALSAS: `getSignedUrl`
 * firma localmente (no hay red), así que probamos la integración real de la
 * firma sin tocar R2.
 */
function servicioDePrueba() {
  const config = configR2DesdeEnv(ENV_COMPLETA);
  return crearServicioArchivos({
    cliente: crearClienteR2(config),
    bucket: config.bucket,
  });
}

/** Stub mínimo de transacción: solo `archivo.create`, como lo usa el servicio. */
function txConArchivoCreate() {
  const create = vi.fn(
    (args: {
      data: Record<string, unknown>;
      select: Record<string, true>;
    }): Promise<Record<string, unknown>> => Promise.resolve({ id: 'arch_1', ...args.data }),
  );
  const tx = { archivo: { create } } as unknown as Tx;
  return { tx, create };
}

describe('configR2DesdeEnv', () => {
  it('acepta una configuración completa', () => {
    const config = configR2DesdeEnv(ENV_COMPLETA);
    expect(config).toEqual({
      cuentaId: 'cuenta123',
      accessKeyId: 'llave-falsa',
      secretAccessKey: 'secreto-falso',
      bucket: 'control-v2-prueba',
    });
  });

  it('lanza ErrorValidacion nombrando la variable faltante', () => {
    const { R2_BUCKET: _omitida, ...incompleta } = ENV_COMPLETA;
    try {
      configR2DesdeEnv(incompleta);
      expect.unreachable('debió lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorValidacion);
      expect(JSON.stringify((error as ErrorValidacion).detalles)).toContain('R2_BUCKET');
    }
  });
});

describe('crearClienteR2', () => {
  it('apunta al endpoint de la cuenta con región auto', async () => {
    const cliente = crearClienteR2(configR2DesdeEnv(ENV_COMPLETA));
    const region = await cliente.config.region();
    expect(region).toBe('auto');
    const endpoint = await cliente.config.endpoint?.();
    expect(endpoint?.hostname).toBe('cuenta123.r2.cloudflarestorage.com');
  });
});

describe('sanearNombreArchivo', () => {
  it('quita acentos, ñ, espacios y mayúsculas', () => {
    expect(sanearNombreArchivo('Diseño Otoño 2026.JPG')).toBe('diseno-otono-2026.jpg');
  });

  it('neutraliza intentos de ruta (../../)', () => {
    const saneado = sanearNombreArchivo('../../etc/passwd');
    expect(saneado).not.toContain('..');
    expect(saneado).not.toContain('/');
  });

  it('nunca devuelve vacío', () => {
    expect(sanearNombreArchivo('¡¡¡···!!!')).toBe('archivo');
  });
});

describe('solicitarSubida', () => {
  it('crea el registro Archivo en la transacción y devuelve URL PUT firmada', async () => {
    const { tx, create } = txConArchivoCreate();
    const sesion = sesionDePrueba();

    const subida = await servicioDePrueba().solicitarSubida(tx, sesion, {
      nombreOriginal: 'Modelo 501 frente.jpg',
      tipoMime: 'image/jpeg',
      tamanoBytes: 1024,
      carpeta: 'modelos/fotos',
    });

    // El registro va a la transacción del llamador (A2/A5) con quién lo subió.
    expect(create).toHaveBeenCalledTimes(1);
    const datosCreados = create.mock.calls[0]?.[0]?.data;
    expect(datosCreados).toMatchObject({
      bucket: 'control-v2-prueba',
      nombreOriginal: 'Modelo 501 frente.jpg',
      tipoMime: 'image/jpeg',
      tamanoBytes: 1024,
      subidoPorId: sesion.id,
    });

    // Key: carpeta/uuid/nombre-saneado.
    expect(subida.archivo.key).toMatch(/^modelos\/fotos\/[0-9a-f-]{36}\/modelo-501-frente\.jpg$/);

    // URL prefirmada contra el endpoint de la cuenta, con la key y firma.
    const url = new URL(subida.urlSubida);
    expect(url.hostname).toContain('r2.cloudflarestorage.com');
    expect(url.pathname.endsWith(subida.archivo.key)).toBe(true);
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(EXPIRACION_SUBIDA_SEGUNDOS));
    // Regresión: la URL prefirmada NO debe firmar content-type ni content-length.
    // El navegador trata `Content-Length` como "forbidden header" (lo fija él) y
    // maneja content-type de forma especial; si se firman, el PUT real desde el
    // navegador no cuadra el SigV4 y R2 lo rechaza con 403 (que el navegador
    // disfraza de "error de CORS"). Se firma solo lo esencial (host).
    const firmados = url.searchParams.get('X-Amz-SignedHeaders');
    expect(firmados).not.toContain('content-type');
    expect(firmados).not.toContain('content-length');
    expect(firmados).toContain('host');
    expect(subida.expiraEnSegundos).toBe(EXPIRACION_SUBIDA_SEGUNDOS);
  });

  it("usa la carpeta 'general' si no se indica", async () => {
    const { tx } = txConArchivoCreate();
    const subida = await servicioDePrueba().solicitarSubida(tx, sesionDePrueba(), {
      nombreOriginal: 'ficha.pdf',
      tipoMime: 'application/pdf',
      tamanoBytes: 10,
    });
    expect(subida.archivo.key.startsWith('general/')).toBe(true);
  });

  it('rechaza archivos que exceden el tamaño máximo sin tocar la base', async () => {
    const { tx, create } = txConArchivoCreate();
    await expect(
      servicioDePrueba().solicitarSubida(tx, sesionDePrueba(), {
        nombreOriginal: 'video.mp4',
        tipoMime: 'video/mp4',
        tamanoBytes: TAMANO_MAXIMO_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(create).not.toHaveBeenCalled();
  });

  it('rechaza tipos MIME malformados y carpetas inválidas', async () => {
    const { tx } = txConArchivoCreate();
    const servicio = servicioDePrueba();
    await expect(
      servicio.solicitarSubida(tx, sesionDePrueba(), {
        nombreOriginal: 'x.bin',
        tipoMime: 'no-es-mime',
        tamanoBytes: 1,
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    await expect(
      servicio.solicitarSubida(tx, sesionDePrueba(), {
        nombreOriginal: 'x.bin',
        tipoMime: 'application/octet-stream',
        tamanoBytes: 1,
        carpeta: '../otra',
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('urlDescarga', () => {
  it('devuelve URL GET firmada para la key', async () => {
    const urlTexto = await servicioDePrueba().urlDescarga('modelos/fotos/abc/uno.jpg');
    const url = new URL(urlTexto);
    expect(url.pathname.endsWith('modelos/fotos/abc/uno.jpg')).toBe(true);
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  it('con nombreDescarga fuerza la descarga con ese nombre (saneado)', async () => {
    const urlTexto = await servicioDePrueba().urlDescarga('a/b/c.pdf', {
      nombreDescarga: 'Ficha Técnica.pdf',
    });
    const disposicion = new URL(urlTexto).searchParams.get('response-content-disposition');
    expect(disposicion).toBe('attachment; filename="ficha-tecnica.pdf"');
  });

  it('rechaza key vacía', async () => {
    await expect(servicioDePrueba().urlDescarga('  ')).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
