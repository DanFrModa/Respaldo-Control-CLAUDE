import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExactitudCiclico } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ExactitudCiclicoPagina } from './ExactitudCiclicoPagina';

type Consulta = {
  data: ExactitudCiclico | undefined;
  isPending: boolean;
  isError: boolean;
  error: { message: string } | null;
};

const useExactitudCiclico = vi.fn<() => Consulta>();
const mutate = vi.fn<(arg: unknown, opciones?: unknown) => void>();

vi.mock('@/api/inventario-ciclico', () => ({
  useExactitudCiclico: () => useExactitudCiclico(),
  useGenerarAjusteCiclico: () => ({ mutate, isPending: false }),
}));

function exactitud(extra: Partial<ExactitudCiclico> = {}): ExactitudCiclico {
  return {
    id: 5,
    folio: 12,
    idEmpresa: 1,
    idAlmacen: 1,
    almacen: 'Primeras',
    fecha: '2026-07-03',
    estado: 'contado',
    observaciones: null,
    canceladoEn: null,
    motivoCancelacion: null,
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
        cantTeorica: 10,
        cantReal: 12,
        exactitud: 2,
        idMovimientoAjuste: null,
        folioMovimientoAjuste: null,
      },
    ],
    totales: { total: 1, contados: 1, exactos: 0, diferencias: 1, teorico: 10, real: 12 },
    ...extra,
  };
}

function render(estado: Consulta, permisos = ['indicadores.ciclicos-consulta'] as const) {
  useExactitudCiclico.mockReturnValue(estado);
  return renderConProveedores(
    <Routes>
      <Route path="/indicadores/ciclicos/:id/exactitud" element={<ExactitudCiclicoPagina />} />
    </Routes>,
    {
      sesion: estadoSesionDePrueba([...permisos]),
      rutaInicial: '/indicadores/ciclicos/5/exactitud',
    },
  );
}

describe('<ExactitudCiclicoPagina>', () => {
  beforeEach(() => {
    useExactitudCiclico.mockReset();
    mutate.mockReset();
  });

  it('muestra el teórico, el real y la exactitud del renglón', () => {
    render({ data: exactitud(), isPending: false, isError: false, error: null });
    const fila = screen.getByTestId('ex-fila-41');
    expect(fila).toHaveTextContent('10'); // teórico
    expect(fila).toHaveTextContent('12'); // real
    expect(fila).toHaveTextContent('+2'); // exactitud
  });

  it('permite generar el ajuste cuando está CONTADO (con confirmación)', async () => {
    const usuario = userEvent.setup();
    render({ data: exactitud(), isPending: false, isError: false, error: null });

    await usuario.click(screen.getByTestId('ex-generar-ajuste'));
    await usuario.click(screen.getByTestId('ex-confirmar-ajuste'));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toBe(5);
  });

  it('NO ofrece generar ajuste si aún está abierto', () => {
    render({
      data: exactitud({ estado: 'abierto' }),
      isPending: false,
      isError: false,
      error: null,
    });
    expect(screen.queryByTestId('ex-generar-ajuste')).not.toBeInTheDocument();
    expect(screen.getByText(/faltan renglones por contar/i)).toBeInTheDocument();
  });
});
