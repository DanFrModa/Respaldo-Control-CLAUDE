import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Qué cachés mueve el COTEJO (fila 0.117).
 *
 * 🔴 `CLAVE_CORRIDAS` es la que faltaba, y la razón se ve a simple vista: la pantalla que enseña
 * `bloqueosEjecucion` —y que apaga el botón de pagar mientras haya una factura en rojo— es la
 * CORRIDA SEMANAL, y su caché NO cuelga de `['cxp']` sino de `['pagos','corridas']`. Invalidando
 * sólo CxP, ligar o atender la factura arreglaba el veredicto y la corrida seguía enseñando el
 * bloqueo, con el botón apagado, hasta que alguien recargara la página.
 */

/** Respuesta cruda de `openapi-fetch` (sólo lo que usa la capa de datos). */
type RespuestaApi = { data?: unknown; error?: unknown };

const put = vi.fn<(ruta: string, opciones: unknown) => Promise<RespuestaApi>>();
const post = vi.fn<(ruta: string, opciones: unknown) => Promise<RespuestaApi>>();

vi.mock('./cliente', () => ({
  api: {
    PUT: (ruta: string, opciones: unknown): Promise<RespuestaApi> => put(ruta, opciones),
    POST: (ruta: string, opciones: unknown): Promise<RespuestaApi> => post(ruta, opciones),
    GET: vi.fn(),
    PATCH: vi.fn(),
    DELETE: vi.fn(),
  },
}));

const { useAplicarCotejo, useAtenderCotejo } = await import('./cotejo');
const { CLAVE_CXP } = await import('./cxp');
const { CLAVE_CORRIDAS } = await import('./pagos');

const BANDEJA = { facturas: [], enRojo: 0, toleranciaPesos: 1 };

describe('invalidación de cachés del cotejo de facturas', () => {
  beforeEach(() => {
    put.mockReset();
    post.mockReset();
  });

  it('⭐ LIGAR documentos invalida CxP y la corrida semanal', async () => {
    put.mockResolvedValue({ data: BANDEJA });
    const cliente = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidar = vi.spyOn(cliente, 'invalidateQueries');

    const { result } = renderHook(() => useAplicarCotejo(), {
      wrapper: ({ children }) => createElement(QueryClientProvider, { client: cliente }, children),
    });
    result.current.mutate({
      idMovimiento: 91,
      cuerpo: { aplicaciones: [{ idRenglon: 501, importe: 11_600 }] },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_CXP });
    // 🔴 La que faltaba: de aquí salen el aviso de bloqueo y el botón de pagar.
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_CORRIDAS });
  });

  it('⭐ ATENDER el descuadre invalida exactamente lo mismo (deja de frenar el pago)', async () => {
    post.mockResolvedValue({ data: BANDEJA });
    const cliente = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidar = vi.spyOn(cliente, 'invalidateQueries');

    const { result } = renderHook(() => useAtenderCotejo(), {
      wrapper: ({ children }) => createElement(QueryClientProvider, { client: cliente }, children),
    });
    result.current.mutate({ idMovimiento: 91, cuerpo: { nota: 'Trae un flete de más' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_CXP });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_CORRIDAS });
  });
});
