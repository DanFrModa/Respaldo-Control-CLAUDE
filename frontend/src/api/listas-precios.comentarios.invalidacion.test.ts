import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ⭐ Fila 0.238 (hallazgo del reviewer) — quitar un renglón o borrar la lista se lleva EN CASCADA
 * sus comentarios de la negociación en el servidor. Sin invalidar la cache de comentarios, la
 * pantalla seguía enseñando los del renglón quitado.
 *
 * Se mide de punta a punta, no contra una clave copiada: se MONTA `useComentariosLista(3)` (un
 * observador real), se dispara la mutación y se comprueba que los comentarios se VUELVEN A PEDIR.
 * Si la mutación invalidara otra clave —o ninguna—, el GET no se repetiría.
 */

type RespuestaApi = { data?: unknown; error?: unknown };

const get = vi.fn<(ruta: string, opciones: unknown) => Promise<RespuestaApi>>();
const del = vi.fn<(ruta: string, opciones: unknown) => Promise<RespuestaApi>>();

vi.mock('./cliente', () => ({
  api: {
    GET: (ruta: string, opciones: unknown): Promise<RespuestaApi> => get(ruta, opciones),
    DELETE: (ruta: string, opciones: unknown): Promise<RespuestaApi> => del(ruta, opciones),
    POST: vi.fn(),
    PATCH: vi.fn(),
  },
}));

const { useEliminarLista, useQuitarLineaLista } = await import('./listas-precios');
const { useComentariosLista } = await import('./negociacion');

const RUTA_COMENTARIOS = '/api/listas-precios/{id}/comentarios';

function pedidasDeComentarios(): number {
  return get.mock.calls.filter(([ruta]) => ruta === RUTA_COMENTARIOS).length;
}

function montar<T>(hook: () => T) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderHook(hook, {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: cliente }, children),
  });
}

describe('⭐ 0.238 — lo que borra en cascada refresca los comentarios de la lista', () => {
  beforeEach(() => {
    get.mockReset();
    del.mockReset();
    get.mockResolvedValue({ data: { datos: [] } });
  });

  it('quitar un renglón vuelve a pedir los comentarios de SU lista', async () => {
    del.mockResolvedValue({ data: { id: 3, lineas: [] } });
    const { result } = montar(() => ({
      comentarios: useComentariosLista(3),
      quitar: useQuitarLineaLista(),
    }));
    await waitFor(() => expect(result.current.comentarios.isSuccess).toBe(true));
    expect(pedidasDeComentarios()).toBe(1);

    result.current.quitar.mutate(91);
    await waitFor(() => expect(result.current.quitar.isSuccess).toBe(true));

    await waitFor(() => expect(pedidasDeComentarios()).toBe(2));
  });

  it('borrar la lista vuelve a pedir (invalida) sus comentarios', async () => {
    del.mockResolvedValue({ data: undefined, error: undefined });
    const { result } = montar(() => ({
      comentarios: useComentariosLista(3),
      borrar: useEliminarLista(),
    }));
    await waitFor(() => expect(result.current.comentarios.isSuccess).toBe(true));
    expect(pedidasDeComentarios()).toBe(1);

    result.current.borrar.mutate(3);
    await waitFor(() => expect(result.current.borrar.isSuccess).toBe(true));

    await waitFor(() => expect(pedidasDeComentarios()).toBe(2));
  });
});
