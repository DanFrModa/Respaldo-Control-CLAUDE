import { describe, expect, it, vi } from 'vitest';

import { sesionDePrueba } from '../pruebas/sesiones.js';
import {
  configR2DesdeEnv,
  crearClienteR2,
  crearServicioArchivos,
  decidirArranqueSubidaLocal,
  ErrorArchivoDemasiadoGrande,
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

describe('subirContenido (server-side)', () => {
  /** Servicio en modo LOCAL: la subida NO toca R2 (como en dev/CI con R2 dummy). */
  function servicioLocal() {
    const config = configR2DesdeEnv(ENV_COMPLETA);
    return crearServicioArchivos({
      cliente: crearClienteR2(config),
      bucket: config.bucket,
      subidaLocal: true,
    });
  }

  it('en modo local devuelve bucket/key/metadatos sin contactar a R2', async () => {
    const res = await servicioLocal().subirContenido({
      nombreOriginal: 'CFDI Factura.xml',
      tipoMime: 'application/xml',
      carpeta: 'cfdi/proveedores/2026',
      contenido: Buffer.from('<cfdi/>', 'utf8'),
    });
    expect(res.bucket).toBe('control-v2-prueba');
    // Key: carpeta/uuid/nombre-saneado (mismo criterio que el presigned).
    expect(res.key).toMatch(/^cfdi\/proveedores\/2026\/[0-9a-f-]{36}\/cfdi-factura\.xml$/);
    expect(res.tipoMime).toBe('application/xml');
    expect(res.tamanoBytes).toBe(Buffer.byteLength('<cfdi/>', 'utf8'));
  });

  it('valida carpeta/tamaño igual que el presigned (reusa el mismo esquema)', async () => {
    await expect(
      servicioLocal().subirContenido({
        nombreOriginal: 'x.xml',
        tipoMime: 'application/xml',
        carpeta: '../otra', // carpeta inválida
        contenido: Buffer.from('x'),
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('decidirArranqueSubidaLocal (guard de R2_SUBIDA_LOCAL)', () => {
  // Credenciales R2 REALES (no dummy): un access-key/secret que no son placeholders.
  const CREDS_REALES = {
    R2_ACCESS_KEY_ID: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    R2_SECRET_ACCESS_KEY: 'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f',
  };

  it("con el flag apagado → 'ok', sin mensaje (subida real, sin ruido)", () => {
    expect(decidirArranqueSubidaLocal({})).toEqual({ accion: 'ok' });
    expect(decidirArranqueSubidaLocal({ R2_SUBIDA_LOCAL: 'false' })).toEqual({ accion: 'ok' });
    // Aunque haya credenciales reales y NODE_ENV=production: sin el flag, arranca normal.
    expect(decidirArranqueSubidaLocal({ NODE_ENV: 'production', ...CREDS_REALES })).toEqual({
      accion: 'ok',
    });
  });

  it("con el flag + credenciales R2 DUMMY (dev/CI) → 'avisar' ruidoso (no arranca mudo)", () => {
    const d = decidirArranqueSubidaLocal({
      R2_SUBIDA_LOCAL: 'true',
      R2_ACCESS_KEY_ID: 'dev',
      R2_SECRET_ACCESS_KEY: 'dev',
    });
    expect(d.accion).toBe('avisar');
    expect(d.mensaje).toMatch(/R2_SUBIDA_LOCAL/);
  });

  it("REGRESIÓN e2e: flag + NODE_ENV=production + creds DUMMY → 'avisar' (NO aborta)", () => {
    // El stack de e2e corre la imagen de producción (NODE_ENV=production) con el flag y R2 dummy: NO
    // debe abortar (antes lo hacía por NODE_ENV → backend unhealthy).
    const d = decidirArranqueSubidaLocal({
      R2_SUBIDA_LOCAL: 'true',
      NODE_ENV: 'production',
      R2_ACCESS_KEY_ID: 'dev',
      R2_SECRET_ACCESS_KEY: 'dev',
    });
    expect(d.accion).toBe('avisar');
  });

  it("con el flag + credenciales R2 vacías (aún dummy) → 'avisar'", () => {
    expect(decidirArranqueSubidaLocal({ R2_SUBIDA_LOCAL: 'true' }).accion).toBe('avisar');
  });

  it("con el flag + credenciales R2 REALES → 'abortar' (no-op peligroso con R2 disponible)", () => {
    const d = decidirArranqueSubidaLocal({ R2_SUBIDA_LOCAL: 'true', ...CREDS_REALES });
    expect(d.accion).toBe('abortar');
    expect(d.mensaje).toMatch(/reales/i);
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

describe('descargarContenido (tope de tamaño)', () => {
  /**
   * Servicio con un cliente S3 FALSO: `send` devuelve lo que se le indique. Sirve para ejercer el
   * corte por tamaño sin red — que es justo lo que hay que probar: `descargarContenido` bufferea el
   * objeto ENTERO en memoria, y el `tamanoBytes` que validó el POST lo declaró el navegador (la URL
   * PUT prefirmada NO firma `Content-Length`), así que el objeto real puede ser mucho mayor.
   */
  function servicioConObjeto(objeto: { ContentLength?: number; bytes: Buffer }) {
    const cliente = {
      send: () =>
        Promise.resolve({
          ...(objeto.ContentLength === undefined ? {} : { ContentLength: objeto.ContentLength }),
          Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(objeto.bytes)) },
        }),
    };
    return crearServicioArchivos({
      cliente: cliente as unknown as ReturnType<typeof crearClienteR2>,
      bucket: 'control-v2-prueba',
    });
  }

  it('devuelve los bytes cuando el objeto cabe en el tope', async () => {
    const bytes = Buffer.from('logo-chico');
    const servicio = servicioConObjeto({ ContentLength: bytes.byteLength, bytes });

    const leidos = await servicio.descargarContenido('empresas/logos/1/logo.png', 1024);

    expect(leidos.equals(bytes)).toBe(true);
  });

  it('corta por el ContentLength que reporta R2, SIN bufferear el objeto', async () => {
    const bytes = Buffer.alloc(10);
    let leyoElCuerpo = false;
    const cliente = {
      send: () =>
        Promise.resolve({
          ContentLength: 9_000_000,
          Body: {
            transformToByteArray: () => {
              leyoElCuerpo = true;
              return Promise.resolve(new Uint8Array(bytes));
            },
          },
        }),
    };
    const servicio = crearServicioArchivos({
      cliente: cliente as unknown as ReturnType<typeof crearClienteR2>,
      bucket: 'control-v2-prueba',
    });

    await expect(
      servicio.descargarContenido('empresas/logos/1/enorme.png', 5 * 1024 * 1024),
    ).rejects.toBeInstanceOf(ErrorArchivoDemasiadoGrande);
    expect(leyoElCuerpo).toBe(false);
  });

  it('corta también si R2 no manda ContentLength (se revisan los bytes leídos)', async () => {
    const servicio = servicioConObjeto({ bytes: Buffer.alloc(50) });

    await expect(servicio.descargarContenido('empresas/logos/1/x.png', 10)).rejects.toBeInstanceOf(
      ErrorArchivoDemasiadoGrande,
    );
  });

  it('sin tope no corta nada (el resto del sistema sigue igual)', async () => {
    const servicio = servicioConObjeto({ ContentLength: 9_000_000, bytes: Buffer.alloc(20) });

    await expect(servicio.descargarContenido('k')).resolves.toHaveLength(20);
  });

  it('exige la key', async () => {
    await expect(servicioDePrueba().descargarContenido('  ')).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });
});
