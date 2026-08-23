import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Subida del LOGO de la empresa desde el navegador (branding post-F9).
 *
 * Va en TRES pasos y el tercero es el que importa: hasta que se CONFIRMA, el backend no toca el
 * logo vigente. Si el cliente se olvidara de confirmar, la subida "funcionaría" en pantalla y el
 * sistema seguiría con el logo viejo para siempre — un fallo silencioso. Por eso se prueba la
 * secuencia completa y que un PUT fallido NO llegue a confirmar.
 */

/** Respuesta cruda de `openapi-fetch` (solo lo que usa la capa de datos). */
type RespuestaApi = { data?: unknown; error?: unknown; response?: { ok: boolean } };

const post = vi.fn<(ruta: string, opciones: unknown) => Promise<RespuestaApi>>();
const del = vi.fn<(ruta: string, opciones: unknown) => Promise<RespuestaApi>>();

vi.mock('./cliente', () => ({
  api: {
    POST: (ruta: string, opciones: unknown): Promise<RespuestaApi> => post(ruta, opciones),
    DELETE: (ruta: string, opciones: unknown): Promise<RespuestaApi> => del(ruta, opciones),
    GET: vi.fn(),
    PATCH: vi.fn(),
  },
}));

const { useSubirLogoEmpresa } = await import('./empresas');

/** Monta el hook con su proveedor y dispara la subida, propagando el error si lo hay. */
async function subir(archivo: File): Promise<void> {
  const cliente = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const { result } = renderHook(() => useSubirLogoEmpresa(), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: cliente }, children),
  });
  await result.current.mutateAsync({ idEmpresa: 3, archivo });
}

const PNG = new File(['x'], 'logo.png', { type: 'image/png' });

describe('subida del logo de la empresa', () => {
  beforeEach(() => {
    post.mockReset();
    del.mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true } as Response)),
    );
    post.mockImplementation((ruta: string) =>
      ruta.endsWith('/confirmar')
        ? Promise.resolve({ response: { ok: true }, data: null, error: undefined })
        : Promise.resolve({
            data: {
              idArchivo: 'arch_nuevo',
              urlSubida: 'https://r2.fake/put',
              nombreOriginal: 'logo.png',
              expiraEnSegundos: 900,
            },
            error: undefined,
          }),
    );
  });

  it('pide la URL, sube a R2 y CONFIRMA (sin confirmar, el logo nunca cambiaría)', async () => {
    await subir(PNG);

    expect(post.mock.calls.map((llamada) => llamada[0])).toEqual([
      '/api/empresas/{id}/logo',
      '/api/empresas/{id}/logo/confirmar',
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    // Confirma exactamente el archivo que preparó el backend.
    expect((post.mock.calls[1]?.[1] as { body: { idArchivo: string } }).body.idArchivo).toBe(
      'arch_nuevo',
    );
  });

  it('si el PUT a R2 falla NO confirma: el logo anterior sigue vigente', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false } as Response)),
    );

    await expect(subir(PNG)).rejects.toThrow();

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0]).toBe('/api/empresas/{id}/logo');
  });

  it('si la red se cae a mitad del PUT tampoco confirma', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('sin red'))),
    );

    await expect(subir(PNG)).rejects.toThrow();

    expect(post).toHaveBeenCalledTimes(1);
  });
});
