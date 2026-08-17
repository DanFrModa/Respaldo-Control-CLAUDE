import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fotos del ARTE del modelo: quién dice CUÁL foto se quita (V1-E3d, actualizado en V1-E3f cuando
 * las fotos pasaron a PLURAL, §Post-F9.52 punto 5).
 *
 * La trampa que esta prueba cuida sigue viva y es de TanStack Query, no del endpoint: el hook se
 * monta en Query y ÉSTE llama al `mutationFn` con DOS argumentos (`variables` y un contexto
 * `{ client, meta, mutationKey }`), así que pasarle la referencia pelada a una función de más
 * parámetros le mete el contexto en el parámetro de más — la llamada reventaba ANTES de emitir el
 * DELETE y el usuario veía un error de librería con la foto sin quitarse. **Ese defecto llegó a
 * producción una vez** (commit `d938e92`); por eso la prueba monta el HOOK y no la función suelta.
 *
 * Y la segunda mitad: la limpieza de una subida fallida debe borrar EXACTAMENTE el renglón que su
 * propio POST creó. Con la foto única eso exigía un `idArchivo` acotado en la querystring; con las
 * fotos plurales el `idFoto` que devuelve el POST identifica el renglón por construcción, así que
 * la pérdida silenciosa (llevarse la foto buena de otro usuario) ya no es expresable.
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

  it('el botón "quitar foto" emite el DELETE de ESA foto (sin el contexto de Query colado)', async () => {
    const quitar = montar<{ idModelo: number; idArte: number; idFoto: number }>(useQuitarFotoArte);

    await quitar({ idModelo: 3, idArte: 7, idFoto: 42 });

    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0]?.[0]).toBe('/api/modelos/{id}/artes/{idArte}/fotos/{idFoto}');
    // Los tres ids en la ruta y NADA más: ni querystring, ni el contexto que Query pasa como 2º
    // argumento (que es justo lo que se colaba antes).
    expect(paramsDelDelete(0)).toEqual({ path: { id: 3, idArte: 7, idFoto: 42 } });
  });

  it('la limpieza de una subida fallida borra EXACTAMENTE el renglón que su POST creó', async () => {
    post.mockResolvedValue({
      data: {
        idFoto: 99,
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
    expect(del.mock.calls[0]?.[0]).toBe('/api/modelos/{id}/artes/{idArte}/fotos/{idFoto}');
    // El `idFoto` de ESTA subida, no "la foto que haya": la de otro usuario no se puede tocar.
    expect(paramsDelDelete(0)).toEqual({ path: { id: 3, idArte: 7, idFoto: 99 } });
  });
});
