import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Qué caches invalida una mutación de PRECOSTO (regresión del candado del botón «Generar lista de
 * precios»).
 *
 * Congelar una versión es JUSTO lo que convierte un desarrollo en candidato de una lista, y la
 * consulta de candidatos vive bajo `CLAVE_LISTAS`. Esa consulta ya no se monta sólo dentro del
 * diálogo de crear lista (que refetcheaba al montarse): la página del proyecto la usa para decidir
 * si el botón va habilitado, y esa página NO se desmonta al congelar. Sin invalidar `CLAVE_LISTAS`
 * —y con `refetchOnWindowFocus: false` en la app— el usuario congelaba obedeciendo al mensaje del
 * botón, veía el badge pasar a "Cotizado" y el botón seguía gris pidiéndole que congelara: un
 * candado que sólo se abría saliendo del proyecto y volviendo a entrar.
 */

/** Respuesta cruda de `openapi-fetch` (sólo lo que usa la capa de datos). */
type RespuestaApi = { data?: unknown; error?: unknown };

const post = vi.fn<(ruta: string, opciones: unknown) => Promise<RespuestaApi>>();

vi.mock('./cliente', () => ({
  api: {
    POST: (ruta: string, opciones: unknown): Promise<RespuestaApi> => post(ruta, opciones),
    GET: vi.fn(),
    PATCH: vi.fn(),
    DELETE: vi.fn(),
  },
}));

const { useCongelarPrecosto, CLAVE_PRECOSTOS } = await import('./precostos');
const { CLAVE_LISTAS } = await import('./listas-precios');
const { CLAVE_PROYECTOS } = await import('./proyectos');

describe('invalidación de caches al mutar un precosto', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('congelar invalida precostos, proyectos Y LISTAS (donde vive la consulta de candidatos)', async () => {
    post.mockResolvedValue({ data: { id: 11, version: 1, estado: 'congelado' } });
    const cliente = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidar = vi.spyOn(cliente, 'invalidateQueries');

    const { result } = renderHook(() => useCongelarPrecosto(), {
      wrapper: ({ children }) => createElement(QueryClientProvider, { client: cliente }, children),
    });
    result.current.mutate(11);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_PRECOSTOS });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_PROYECTOS });
    // La que faltaba: sin ella el botón «Generar lista de precios» se quedaba trabado.
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_LISTAS });
  });
});
