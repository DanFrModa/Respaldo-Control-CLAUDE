import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConteoCiclico } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ConteoCiclicoPagina } from './ConteoCiclicoPagina';

type Consulta = {
  data: ConteoCiclico | undefined;
  isPending: boolean;
  isError: boolean;
  error: { message: string } | null;
};

const useConteoCiclico = vi.fn<() => Consulta>();
const mutate = vi.fn<(arg: unknown, opciones?: unknown) => void>();

vi.mock('@/api/inventario-ciclico', () => ({
  useConteoCiclico: () => useConteoCiclico(),
  useCapturarConteo: () => ({ mutate, isPending: false }),
}));

function conteo(extra: Partial<ConteoCiclico> = {}): ConteoCiclico {
  return {
    id: 5,
    folio: 12,
    idAlmacen: 1,
    almacen: 'Primeras',
    fecha: '2026-07-03',
    estado: 'abierto',
    renglones: [
      {
        idDet: 41,
        idModelo: 2,
        modelo: 'A-100',
        idColor: 3,
        color: 'Rojo',
        idTalla: 4,
        etiquetaTalla: 'CH',
        ordenTalla: 1,
        idOrden: null,
        folioOrden: null,
        cantReal: null,
        contado: false,
      },
    ],
    ...extra,
  };
}

function render(estado: Consulta, permisos = ['indicadores.ciclicos-conteo'] as const) {
  useConteoCiclico.mockReturnValue(estado);
  return renderConProveedores(
    <Routes>
      <Route path="/indicadores/ciclicos/:id/conteo" element={<ConteoCiclicoPagina />} />
    </Routes>,
    { sesion: estadoSesionDePrueba([...permisos]), rutaInicial: '/indicadores/ciclicos/5/conteo' },
  );
}

describe('<ConteoCiclicoPagina>', () => {
  beforeEach(() => {
    useConteoCiclico.mockReset();
    mutate.mockReset();
  });

  it('muestra el artículo y su campo de conteo, SIN teórico (conteo ciego)', () => {
    render({ data: conteo(), isPending: false, isError: false, error: null });

    expect(screen.getByTestId('cc-fila-41')).toHaveTextContent('A-100');
    expect(screen.getByTestId('cc-fila-41')).toHaveTextContent('Rojo');
    expect(screen.getByTestId('cc-cant-41')).toBeInTheDocument();
    // Conteo ciego: no aparece ninguna etiqueta de "teórico".
    expect(screen.queryByText(/teórico/i)).not.toBeInTheDocument();
  });

  it('captura la cantidad física y llama a capturar con el payload', async () => {
    const usuario = userEvent.setup();
    render({ data: conteo(), isPending: false, isError: false, error: null });

    await usuario.type(screen.getByTestId('cc-cant-41'), '12');
    await usuario.click(screen.getByTestId('cc-guardar'));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      id: 5,
      cuerpo: { renglones: [{ idDet: 41, cantReal: 12 }] },
    });
  });

  it('avisa cuando el inventario ya está cerrado', () => {
    render({ data: conteo({ estado: 'cerrado' }), isPending: false, isError: false, error: null });
    expect(screen.getByText(/no admite más conteo/i)).toBeInTheDocument();
  });
});
