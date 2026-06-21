import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { EstatusMaterialesPagina } from './EstatusMaterialesPagina';

const useEstatusMock = vi.fn();
const useConsultaOrdenesMock = vi.fn();
const imprimirMock = vi.fn();

vi.mock('@/api/mrp', () => ({
  useEstatusMateriales: (id: unknown) => useEstatusMock(id) as unknown,
  imprimirEstatusMateriales: (id: number) => imprimirMock(id) as unknown,
}));
vi.mock('@/api/ordenes-consulta', () => ({
  useConsultaOrdenes: () => useConsultaOrdenesMock() as unknown,
}));

/** Estatus de prueba: botón recibido-parcial, felpa pendiente, flete no-identificado. */
function estatusDePrueba() {
  return {
    idOrden: 50,
    folioOrden: 7,
    tieneSnapshot: true,
    filas: [
      {
        tipo: 'avio',
        idTela: null,
        idAvio: 3,
        material: 'BOT-01 — Botón',
        unidad: 'pza',
        requerido: 180,
        enOc: 180,
        recibido: 90,
        estatus: 'recibido-parcial',
      },
      {
        tipo: 'tela',
        idTela: 4,
        idAvio: null,
        material: 'Felpa',
        unidad: 'm',
        requerido: 45,
        enOc: 0,
        recibido: 0,
        estatus: 'pendiente',
      },
      {
        tipo: 'no-identificado',
        idTela: null,
        idAvio: null,
        material: 'Flete',
        unidad: null,
        requerido: 0,
        enOc: 1,
        recibido: 0,
        estatus: 'en-oc',
      },
    ],
  };
}

describe('EstatusMaterialesPagina (F4-E4, R7)', () => {
  beforeEach(() => {
    useEstatusMock.mockReset();
    useConsultaOrdenesMock.mockReset();
    imprimirMock.mockReset();

    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    useEstatusMock.mockReturnValue({
      data: estatusDePrueba(),
      isPending: false,
      isError: false,
    });
  });

  it('al elegir una orden cruza requerido/en-oc/recibido y pinta el semáforo', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EstatusMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });

    await usuario.click(screen.getByTestId('est-orden-opcion'));
    expect(useEstatusMock).toHaveBeenCalledWith(50);

    // Filas en móvil + escritorio: cada material aparece dos veces (tarjeta + tabla).
    expect(screen.getAllByText('BOT-01 — Botón').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Recibido parcial').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Pendiente').length).toBeGreaterThanOrEqual(1);
    // La línea libre sale como "No identificado".
    expect(screen.getAllByText('No identificado').length).toBeGreaterThanOrEqual(1);
  });

  it('avisa cuando la orden aún no se ha explosionado (sin snapshot)', async () => {
    useEstatusMock.mockReturnValue({
      data: { ...estatusDePrueba(), tieneSnapshot: false, filas: [] },
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<EstatusMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('est-orden-opcion'));
    expect(screen.getByTestId('est-sin-snapshot')).toBeInTheDocument();
  });

  it('imprime el estatus de la orden elegida', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EstatusMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('est-orden-opcion'));
    await usuario.click(screen.getByTestId('est-imprimir'));
    expect(imprimirMock).toHaveBeenCalledWith(50);
  });
});
