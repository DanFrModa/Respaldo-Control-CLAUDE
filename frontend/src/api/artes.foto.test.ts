import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Foto del ARTE del modelo: quién dice CUÁL foto se quita (V1-E3d — antes vivía en
 * `bordados.foto.test.ts`, cuando el arte era catálogo; el endpoint cambió de
 * `/api/bordados/{id}/foto` a `/api/modelos/{id}/artes/{idArte}/foto`, la trampa NO).
 *
 * El endpoint acepta un `idArchivo` OPCIONAL que acota el borrado a una foto concreta. Eso parte el
 * camino en dos y cada mitad tiene su trampa:
 *
 *  - El botón "quitar foto" NO manda `idArchivo` (quita la vigente, sea cual sea). Como el hook se
 *    monta en TanStack Query y ÉSTE llama al `mutationFn` con DOS argumentos (`variables` y un
 *    contexto `{ client, meta, mutationKey }`), pasarle la referencia pelada a una función de más
 *    parámetros le metía el contexto en `idArchivo`: la querystring salía con un objeto anidado y
 *    la llamada reventaba ANTES de emitir el DELETE — el usuario veía un error de librería y la
 *    foto nunca se quitaba. **Ese defecto llegó a producción una vez** (commit `d938e92`), y por
 *    eso la prueba monta el HOOK y no la función suelta: pasando por Query es donde existe.
 *  - La limpieza de una subida fallida SÍ debe mandar `idArchivo`; si no, borraría "la foto que
 *    haya" y se llevaría la que otro usuario acabara de subir al mismo arte (pérdida silenciosa).
 *
 * Las dos mitades se prueban juntas para que arreglar una no rompa la otra.
 */

/** Respuesta cruda de `openapi-fetch` (solo lo que usa la capa de datos). */
type RespuestaApi = { data?: unknown; error?: unknown; response?: { ok: boolean } };
/** Opciones con las que la capa de datos llama al cliente tipado. */
type OpcionesApi = { params?: { path?: Record<string, unknown>; query?: Record<string, unknown> } };

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

const { useQuitarFotoArte, useSubirFotoArte } = await import('./artes');

/** Monta un hook con su proveedor y devuelve su `mutateAsync` ya listo para disparar. */
function montar<V>(
  usarHook: () => { mutateAsync: (v: V) => Promise<void> },
): (v: V) => Promise<void> {
  const cliente = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const { result } = renderHook(usarHook, {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: cliente }, children),
  });
  return (variables: V) => result.current.mutateAsync(variables);
}

/** Los `params` con los que se llamó al DELETE en la posición dada. */
function paramsDelDelete(indice: number): NonNullable<OpcionesApi['params']> {
  const opciones = del.mock.calls[indice]?.[1] as OpcionesApi | undefined;
  return opciones?.params ?? {};
}

const PNG = new File(['x'], 'arte.png', { type: 'image/png' });

describe('foto del arte del modelo', () => {
  beforeEach(() => {
    post.mockReset();
    del.mockReset();
    del.mockResolvedValue({ response: { ok: true }, error: undefined });
  });

  it('el botón "quitar foto" emite el DELETE SIN querystring', async () => {
    const quitar = montar<{ idModelo: number; idArte: number }>(useQuitarFotoArte);

    await quitar({ idModelo: 3, idArte: 7 });

    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0]?.[0]).toBe('/api/modelos/{id}/artes/{idArte}/foto');
    // Sin `idArchivo`: ni el valor, ni la llave, ni el contexto que Query pasa como 2º argumento.
    expect(paramsDelDelete(0)).toEqual({ path: { id: 3, idArte: 7 }, query: {} });
  });

  it('la limpieza de una subida fallida SÍ acota el borrado a SU archivo', async () => {
    post.mockResolvedValue({
      data: {
        idArchivo: 'arch_de_esta_subida',
        nombreOriginal: 'arte.png',
        urlSubida: 'https://r2.fake/put',
        expiraEnSegundos: 900,
      },
      error: undefined,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 403 } as Response)),
    );
    const subir = montar<{ idModelo: number; idArte: number; archivo: File }>(useSubirFotoArte);

    await expect(subir({ idModelo: 3, idArte: 7, archivo: PNG })).rejects.toThrow();

    expect(del).toHaveBeenCalledTimes(1);
    expect(paramsDelDelete(0)).toEqual({
      path: { id: 3, idArte: 7 },
      query: { idArchivo: 'arch_de_esta_subida' },
    });
  });
});
