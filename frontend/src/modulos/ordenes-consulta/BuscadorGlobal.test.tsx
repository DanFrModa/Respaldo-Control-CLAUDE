import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as ReactRouter from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrdenesBuscar } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { BuscadorGlobal } from './BuscadorGlobal';

const navegar = vi.fn();
vi.mock('react-router-dom', async () => {
  const real = await vi.importActual<typeof ReactRouter>('react-router-dom');
  return { ...real, useNavigate: () => navegar };
});

type EstadoConsulta = {
  data: OrdenesBuscar | undefined;
  isFetching: boolean;
};
const useBuscarOrdenes = vi.fn<(q: string) => EstadoConsulta>();
let ultimaQ: string | undefined;
vi.mock('@/api/ordenes-consulta', () => ({
  useBuscarOrdenes: (q: string) => {
    ultimaQ = q;
    return useBuscarOrdenes(q);
  },
}));

function hits(): OrdenesBuscar {
  return {
    datos: [
      { id: 11, folio: 101, codigoModelo: 'A-100', cliente: 'Liverpool' },
      { id: 22, folio: 102, codigoModelo: 'B-200', cliente: 'Sears' },
    ],
  };
}

describe('<BuscadorGlobal>', () => {
  beforeEach(() => {
    useBuscarOrdenes.mockReset();
    navegar.mockReset();
    ultimaQ = undefined;
    useBuscarOrdenes.mockReturnValue({ data: undefined, isFetching: false });
  });

  it('no se renderiza sin permiso ordenes.ver', () => {
    renderConProveedores(<BuscadorGlobal />, { sesion: estadoSesionDePrueba([]) });
    expect(screen.queryByTestId('buscador-global')).not.toBeInTheDocument();
  });

  it('busca con debounce y muestra los hits', async () => {
    const usuario = userEvent.setup();
    useBuscarOrdenes.mockReturnValue({ data: hits(), isFetching: false });
    renderConProveedores(<BuscadorGlobal />, { sesion: estadoSesionDePrueba(['ordenes.ver']) });

    await usuario.type(screen.getByTestId('buscador-global'), '10');
    await vi.waitFor(() => expect(ultimaQ).toBe('10'));
    expect(screen.getAllByTestId('buscador-hit')).toHaveLength(2);
  });

  it('al elegir un hit navega al detalle de esa orden', async () => {
    const usuario = userEvent.setup();
    useBuscarOrdenes.mockReturnValue({ data: hits(), isFetching: false });
    renderConProveedores(<BuscadorGlobal />, { sesion: estadoSesionDePrueba(['ordenes.ver']) });

    await usuario.type(screen.getByTestId('buscador-global'), '10');
    await vi.waitFor(() => expect(screen.getByTestId('buscador-resultados')).toBeInTheDocument());

    const panel = screen.getByTestId('buscador-resultados');
    const primerHit = within(panel).getAllByTestId('buscador-hit')[0];
    expect(primerHit).toBeDefined();
    await usuario.click(primerHit as HTMLElement);
    expect(navegar).toHaveBeenCalledWith('/produccion/ordenes', { state: { idOrden: 11 } });
  });

  it('sin coincidencias muestra el mensaje vacío', async () => {
    const usuario = userEvent.setup();
    useBuscarOrdenes.mockReturnValue({ data: { datos: [] }, isFetching: false });
    renderConProveedores(<BuscadorGlobal />, { sesion: estadoSesionDePrueba(['ordenes.ver']) });

    await usuario.type(screen.getByTestId('buscador-global'), 'zzz');
    await vi.waitFor(() => expect(screen.getByText('Sin coincidencias.')).toBeInTheDocument());
  });
});
