import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { SelectorOrden } from './SelectorOrden';

/**
 * REGRESIÓN QUE NO DEBE VOLVER (26-jul-2026): este selector es la puerta de entrada de SIETE
 * pantallas de operación (corte, envío a maquila, recibo, entrega a cliente, salida de tela, nota
 * de salida de tela y alta de auditoría). Filtraba `estado: 'completa'`; cuando ese estado pasó a
 * ser AUTOMÁTICO (hoy: tallas + receta liberada, y arte si aplica), las órdenes a las que les
 * faltaba cualquiera de esos requisitos —muy comunes en lo migrado de Access, que llegó sin
 * receta— DESAPARECÍAN de los siete buscadores y la orden no se podía operar. Aquí se fija que el
 * filtro sea "todas menos canceladas" y que una orden `capturada` SÍ se pueda elegir.
 */

const useOrdenesMock = vi.fn<(query: Record<string, unknown>) => Record<string, unknown>>();
vi.mock('@/api/ordenes', () => ({
  useOrdenes: (query: Record<string, unknown>) => useOrdenesMock(query),
}));

/** Orden INCOMPLETA (`capturada`: le falta algún requisito) — el caso que se rompía. */
const ordenCapturada = {
  id: 9,
  folio: 5424,
  estado: 'capturada',
  codigoModelo: 'A-100',
  cliente: 'Liverpool',
  totalPiezas: 120,
} as unknown as Orden;

function paginaCon(ordenes: Orden[]): Record<string, unknown> {
  return {
    data: { datos: ordenes, total: ordenes.length, pagina: 1, porPagina: 8, totalPaginas: 1 },
    isPending: false,
    isError: false,
    error: null,
  };
}

describe('<SelectorOrden>', () => {
  beforeEach(() => {
    useOrdenesMock.mockReset();
    useOrdenesMock.mockReturnValue(paginaCon([ordenCapturada]));
  });

  it('NO filtra por estado "completa": pide todas las órdenes menos las canceladas', () => {
    renderConProveedores(<SelectorOrden idSeleccionada={undefined} alSeleccionar={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });

    const query = useOrdenesMock.mock.calls[0]?.[0];
    expect(query).toMatchObject({ incluirCanceladas: 'false' });
    expect(query).not.toHaveProperty('estado');
  });

  it('deja SELECCIONAR una orden en estado "capturada" (sin receta de avíos)', async () => {
    const usuario = userEvent.setup();
    const alSeleccionar = vi.fn();
    renderConProveedores(
      <SelectorOrden idSeleccionada={undefined} alSeleccionar={alSeleccionar} />,
      { sesion: estadoSesionDePrueba([]) },
    );

    await usuario.click(screen.getByTestId('selector-orden-busqueda'));
    expect(screen.getByTestId('selector-orden-opcion')).toHaveTextContent('Orden #5424');
    await usuario.click(screen.getByTestId('selector-orden-opcion'));

    expect(alSeleccionar).toHaveBeenCalledTimes(1);
    expect(alSeleccionar.mock.calls[0]?.[0]).toMatchObject({ id: 9, estado: 'capturada' });
  });

  it('cuando no hay resultados NO habla de "órdenes completas"', async () => {
    const usuario = userEvent.setup();
    useOrdenesMock.mockReturnValue(paginaCon([]));
    renderConProveedores(<SelectorOrden idSeleccionada={undefined} alSeleccionar={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });

    await usuario.click(screen.getByTestId('selector-orden-busqueda'));
    expect(screen.getByText('No hay órdenes que coincidan.')).toBeInTheDocument();
  });
});
