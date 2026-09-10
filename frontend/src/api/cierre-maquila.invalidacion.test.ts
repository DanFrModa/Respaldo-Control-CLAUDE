import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Qué cachés invalida CERRAR (y DESHACER) la orden con un maquilero — V1, fila 0.109.
 *
 * 🔴 `CLAVE_WIP` es la que faltaba, y su ausencia se veía a simple vista: el panel de avance —el
 * único sitio donde vive el botón— lee `porMaquilero`, `faltantesSaldables`, el precio y el importe
 * de `useWipOrden`, o sea de `CLAVE_WIP`. Invalidando sólo cierres/recibos/etapas, después de cerrar
 * la pantalla seguía ofreciendo «Cerrar la orden» con las mismas piezas, el maquilero seguía en el
 * selector de recibo, y el segundo clic cosechaba un 409 «no hay nada que cerrar». Igual al deshacer,
 * en el sentido contrario: las piezas vuelven al pendiente y el botón tiene que reaparecer.
 *
 * Es la MISMA lista que invalida `refrescarTodo` (`AvanceProduccion.tsx`) tras capturar un movimiento.
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

const { useCerrarOrdenMaquila, useDeshacerCierreMaquila, CLAVE_CIERRES_MAQUILA } =
  await import('./cierre-maquila');
const { CLAVE_WIP } = await import('./wip');
const { CLAVE_RECIBOS } = await import('./recibos');
const { CLAVE_ETAPAS } = await import('./etapas');
const { CLAVE_ORDENES_CENTRO } = await import('./ordenes-centro');

const CIERRE = { id: 3, idOrden: 1, maquilero: 'Maquila Uno', piezasFaltantes: 5 };

describe('invalidación de cachés al cerrar / deshacer el cierre con un maquilero', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('CERRAR invalida cierres, recibos, etapas, WIP y el centro de órdenes', async () => {
    post.mockResolvedValue({ data: CIERRE });
    const cliente = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidar = vi.spyOn(cliente, 'invalidateQueries');

    const { result } = renderHook(() => useCerrarOrdenMaquila(), {
      wrapper: ({ children }) => createElement(QueryClientProvider, { client: cliente }, children),
    });
    result.current.mutate({
      idOrden: 1,
      cuerpo: {
        idMaquilero: 2,
        idTipoProceso: 5,
        fecha: '2026-09-04',
        desenlace: 'cobrado',
      },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_CIERRES_MAQUILA });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_RECIBOS });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_ETAPAS });
    // 🔴 La que faltaba: de aquí salen el botón, el selector de maquileros y los tres números.
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_WIP });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_ORDENES_CENTRO });
  });

  it('DESHACER invalida exactamente lo mismo (las piezas vuelven al pendiente)', async () => {
    post.mockResolvedValue({ data: { ...CIERRE, deshecho: true } });
    const cliente = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidar = vi.spyOn(cliente, 'invalidateQueries');

    const { result } = renderHook(() => useDeshacerCierreMaquila(), {
      wrapper: ({ children }) => createElement(QueryClientProvider, { client: cliente }, children),
    });
    result.current.mutate({ id: 3, cuerpo: { motivo: 'Aparecieron' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_CIERRES_MAQUILA });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_RECIBOS });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_ETAPAS });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_WIP });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVE_ORDENES_CENTRO });
  });
});
