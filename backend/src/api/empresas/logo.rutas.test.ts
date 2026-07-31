import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SesionUsuario } from '../../comun/permisos.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { registrarNoCacheDocumentos } from '../cache-documentos.js';

/**
 * Ruta `GET /api/empresas/logo` — la IMAGEN de la marca que pinta toda la app (branding post-F9).
 *
 * Se prueba SIN base de datos: se monta el plugin real de rutas sobre un Fastify pelado con los
 * decoradores de auth simulados y el dominio mockeado. Lo que importa aquí es el CONTRATO HTTP,
 * que es donde estaba el riesgo:
 *  • que responda SIN sesión (si no, el login nunca vería el logo nuevo — la excepción que había
 *    que cerrar);
 *  • que con sesión use la EMPRESA ACTIVA (A9), no una empresa fija;
 *  • que el `ETag` sirva de verdad (304 con `If-None-Match`, incluidos los ETag débiles);
 *  • que la caché sea coherente con la URL: inmutable si viene versionada (`?v=`), corta si no.
 */

/** Lo que devuelve el resolutor del logo (`comun/logo-empresa.ts`). */
interface LogoDePrueba {
  bytes: Buffer;
  tipoMime: string;
  dataUrl: string;
  origen: string;
  idArchivo: string | null;
}

const imagenLogoEmpresa = vi.fn<(sesion: SesionUsuario | null) => Promise<LogoDePrueba>>();
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

vi.mock('../../dominio/admin/empresas.js', () => ({
  imagenLogoEmpresa: (sesion: SesionUsuario | null) => imagenLogoEmpresa(sesion),
  // El resto del módulo no se ejercita aquí, pero el plugin lo importa.
  actualizarConfiguracion: vi.fn(),
  actualizarEmpresa: vi.fn(),
  confirmarLogo: vi.fn(),
  crearEmpresa: vi.fn(),
  desactivarEmpresa: vi.fn(),
  listarEmpresas: vi.fn(),
  logoEmpresa: vi.fn(),
  obtenerConfiguracion: vi.fn(),
  obtenerEmpresa: vi.fn(),
  quitarLogo: vi.fn(),
  reactivarEmpresa: vi.fn(),
  solicitarSubidaLogo: vi.fn(),
}));

const { rutasEmpresas } = await import('./empresas.rutas.js');

/** Monta el plugin real con los decoradores de auth simulados. `sesion` = quién pide. */
async function appCon(sesion: SesionUsuario | null): Promise<FastifyInstance> {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('obtenerSesion', () => Promise.resolve(sesion));
  // Los guards no se ejercitan aquí (la ruta del logo no los usa); basta con que existan.
  app.decorate('conPermiso', () => () => Promise.resolve(undefined));
  app.decorate('conAlgunPermiso', () => () => Promise.resolve(undefined));
  // El MISMO hook anti-caché de documentos que monta `construirApp`: el logo es un ASSET y NO debe
  // perder su caché larga por él (las aserciones de `cache-control` de abajo lo vigilan).
  registrarNoCacheDocumentos(app);
  await app.register(rutasEmpresas, { prefix: '/api' });
  await app.ready();
  return app;
}

/** Logo resuelto de ejemplo (el de la empresa, o el empaquetado si `idArchivo` es null). */
function logo(idArchivo: string | null): LogoDePrueba {
  return { bytes: PNG, tipoMime: 'image/png', dataUrl: 'data:…', origen: 'empresa', idArchivo };
}

describe('GET /api/empresas/logo', () => {
  let app: FastifyInstance | null = null;

  beforeEach(() => {
    imagenLogoEmpresa.mockReset();
    imagenLogoEmpresa.mockResolvedValue(logo('arch1'));
  });

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('responde la imagen SIN sesión (la necesita el login) y le pasa `null` al dominio', async () => {
    app = await appCon(null);

    const res = await app.inject({ method: 'GET', url: '/api/empresas/logo' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(Buffer.from(res.rawPayload).equals(PNG)).toBe(true);
    expect(imagenLogoEmpresa).toHaveBeenCalledWith(null);
  });

  it('con sesión resuelve el logo de la EMPRESA ACTIVA (A9)', async () => {
    const sesion = sesionDePrueba({ permisos: [], idEmpresaActiva: 7 });
    app = await appCon(sesion);

    await app.inject({ method: 'GET', url: '/api/empresas/logo' });

    expect(imagenLogoEmpresa.mock.calls[0]?.[0]).toMatchObject({ idEmpresaActiva: 7 });
  });

  it('la URL VERSIONADA se cachea como inmutable CUANDO se sirvió esa misma versión', async () => {
    app = await appCon(null);

    const res = await app.inject({ method: 'GET', url: '/api/empresas/logo?v=arch1' });

    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(res.headers.etag).toBe('"arch1"');
  });

  it('si se pidió una versión pero se sirvió el EMPAQUETADO, la caché es corta (no inmutable)', async () => {
    // El resolutor nunca falla: ante R2 caído, archivo corrupto o la ventana de caché negativa,
    // responde el empaquetado aunque la URL pida `arch1`. Marcarlo `immutable` clavaría el logo
    // equivocado un año, sin revalidar y sin que la URL cambie: no se recuperaría ni recargando.
    imagenLogoEmpresa.mockResolvedValue({ ...logo(null), origen: 'empaquetado' });
    app = await appCon(null);

    const res = await app.inject({ method: 'GET', url: '/api/empresas/logo?v=arch1' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=60');
    expect(res.headers['cache-control']).not.toContain('immutable');
    // El ETag delata lo que de verdad se sirvió, así que la revalidación traerá el logo bueno.
    expect(res.headers.etag).toBe('"empaquetado"');
  });

  it('si se pidió una versión VIEJA se sirve la vigente con caché corta (la URL miente)', async () => {
    app = await appCon(null); // el dominio responde `arch1`

    const res = await app.inject({ method: 'GET', url: '/api/empresas/logo?v=arch_viejo' });

    expect(res.headers['cache-control']).toBe('private, max-age=60');
    expect(res.headers.etag).toBe('"arch1"');
  });

  it('la URL sin versión se cachea poco (el login no sabe el id del archivo)', async () => {
    app = await appCon(null);

    const res = await app.inject({ method: 'GET', url: '/api/empresas/logo' });

    expect(res.headers['cache-control']).toBe('private, max-age=60');
  });

  it('declara `Vary: Cookie`: la imagen depende de la sesión (empresa activa vs predeterminada)', async () => {
    app = await appCon(null);

    const res = await app.inject({ method: 'GET', url: '/api/empresas/logo' });

    // Sin esto, tras un logout o un cambio de empresa el navegador reutilizaría hasta 60 s la
    // entrada cacheada del usuario anterior.
    expect(res.headers.vary).toBe('Cookie');
  });

  it('con `If-None-Match` igual responde 304 y NO reenvía la imagen', async () => {
    app = await appCon(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/empresas/logo',
      headers: { 'if-none-match': '"arch1"' },
    });

    expect(res.statusCode).toBe(304);
    expect(res.rawPayload.length).toBe(0);
  });

  it('acepta el ETag DÉBIL (`W/"…"`) que devuelven los navegadores', async () => {
    app = await appCon(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/empresas/logo',
      headers: { 'if-none-match': 'W/"arch1"' },
    });

    expect(res.statusCode).toBe(304);
  });

  it('con `If-None-Match` de OTRO logo reenvía la imagen (200)', async () => {
    app = await appCon(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/empresas/logo',
      headers: { 'if-none-match': '"arch-viejo"' },
    });

    expect(res.statusCode).toBe(200);
    expect(Buffer.from(res.rawPayload).equals(PNG)).toBe(true);
  });

  it('sin logo propio responde el empaquetado, con su ETag propio', async () => {
    imagenLogoEmpresa.mockResolvedValue({ ...logo(null), origen: 'empaquetado' });
    app = await appCon(null);

    const res = await app.inject({ method: 'GET', url: '/api/empresas/logo' });

    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe('"empaquetado"');
  });
});
