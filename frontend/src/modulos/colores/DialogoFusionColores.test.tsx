import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Color, ColoresPagina as TipoPagina } from '@/api/tipos';
import type { ErrorDeApi } from '@/api/errores';
import { renderConProveedores } from '@/pruebas/utilidades';

import { DialogoFusionColores } from './DialogoFusionColores';

// Se controla la capa de datos: las pruebas no tocan la red.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  error: ErrorDeApi | null;
};
const useColores = vi.fn<() => EstadoConsulta>();
const fusionarMutate = vi.fn();
const fusionarIsPending = { value: false };
vi.mock('@/api/colores', () => ({
  useColores: () => useColores(),
  useFusionarColores: () => ({ mutate: fusionarMutate, isPending: fusionarIsPending.value }),
}));

/** Color de ejemplo. */
function color(id: number, nombre: string): Color {
  return {
    id,
    nombre,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

/** Estado de consulta "con datos". */
function consultaConDatos(datos: Color[]): EstadoConsulta {
  return {
    data: { datos, total: datos.length, pagina: 1, porPagina: 100, totalPaginas: 1 },
    isPending: false,
    isError: false,
    error: null,
  };
}

describe('<DialogoFusionColores>', () => {
  beforeEach(() => {
    useColores.mockReset();
    fusionarMutate.mockReset();
    fusionarIsPending.value = false;
  });

  it('exige elegir destino y al menos un duplicado antes de habilitar Fusionar', async () => {
    const usuario = userEvent.setup();
    useColores.mockReturnValue(
      consultaConDatos([color(1, 'Negro'), color(2, 'Negro A'), color(3, 'Negro B')]),
    );
    renderConProveedores(<DialogoFusionColores abierto alCambiarAbierto={vi.fn()} />);

    // Sin destino: el botón Fusionar está deshabilitado.
    const boton = screen.getByTestId('confirmar-fusion');
    expect(boton).toBeDisabled();

    // Elige destino → aparecen los candidatos (sin el destino) pero aún sin marcar ninguno.
    await usuario.selectOptions(screen.getByTestId('fusion-destino'), '1');
    expect(boton).toBeDisabled();
    expect(screen.queryByTestId('fusion-origen-opcion-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('fusion-origen-opcion-2')).toBeInTheDocument();

    // Marca un duplicado → se habilita y muestra el impacto.
    await usuario.click(screen.getByTestId('fusion-origen-opcion-2'));
    expect(boton).toBeEnabled();
    expect(screen.getByTestId('fusion-impacto')).toHaveTextContent('Negro');
  });

  it('llama a la mutación con destino + orígenes marcados', async () => {
    const usuario = userEvent.setup();
    useColores.mockReturnValue(
      consultaConDatos([color(1, 'Negro'), color(2, 'Negro A'), color(3, 'Negro B')]),
    );
    renderConProveedores(<DialogoFusionColores abierto alCambiarAbierto={vi.fn()} />);

    await usuario.selectOptions(screen.getByTestId('fusion-destino'), '1');
    await usuario.click(screen.getByTestId('fusion-origen-opcion-2'));
    await usuario.click(screen.getByTestId('fusion-origen-opcion-3'));
    await usuario.click(screen.getByTestId('confirmar-fusion'));

    expect(fusionarMutate).toHaveBeenCalledTimes(1);
    expect(fusionarMutate.mock.calls[0]?.[0]).toEqual({ idDestino: 1, origenes: [2, 3] });
  });

  it('al cambiar el destino lo quita de los duplicados marcados', async () => {
    const usuario = userEvent.setup();
    useColores.mockReturnValue(consultaConDatos([color(1, 'Negro'), color(2, 'Negro A')]));
    renderConProveedores(<DialogoFusionColores abierto alCambiarAbierto={vi.fn()} />);

    // Destino = 1, marca el 2 como duplicado.
    await usuario.selectOptions(screen.getByTestId('fusion-destino'), '1');
    await usuario.click(screen.getByTestId('fusion-origen-opcion-2'));
    expect(screen.getByTestId('confirmar-fusion')).toBeEnabled();

    // Cambia el destino al 2: deja de ser candidato y la selección queda vacía.
    await usuario.selectOptions(screen.getByTestId('fusion-destino'), '2');
    expect(screen.queryByTestId('fusion-origen-opcion-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('fusion-origen-opcion-1')).not.toBeChecked();
    expect(screen.getByTestId('confirmar-fusion')).toBeDisabled();
  });

  it('filtra los candidatos por nombre', async () => {
    const usuario = userEvent.setup();
    useColores.mockReturnValue(
      consultaConDatos([color(1, 'Negro'), color(2, 'Negro Azulado'), color(3, 'Rojo')]),
    );
    renderConProveedores(<DialogoFusionColores abierto alCambiarAbierto={vi.fn()} />);

    await usuario.selectOptions(screen.getByTestId('fusion-destino'), '1');
    const lista = screen.getByTestId('fusion-origenes');
    expect(within(lista).getAllByRole('checkbox')).toHaveLength(2);

    await usuario.type(screen.getByTestId('fusion-filtro'), 'rojo');
    await waitFor(() =>
      expect(within(screen.getByTestId('fusion-origenes')).getAllByRole('checkbox')).toHaveLength(
        1,
      ),
    );
    expect(screen.getByTestId('fusion-origen-opcion-3')).toBeInTheDocument();
  });

  it('avisa cuando no hay suficientes colores para fusionar', () => {
    useColores.mockReturnValue(consultaConDatos([color(1, 'Negro')]));
    renderConProveedores(<DialogoFusionColores abierto alCambiarAbierto={vi.fn()} />);

    expect(
      screen.getByText('Necesitas al menos dos colores activos para poder fusionar.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('confirmar-fusion')).toBeDisabled();
  });
});
