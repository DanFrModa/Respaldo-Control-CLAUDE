import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AjusteCiclico, ExactitudCiclico } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ExactitudCiclicoPagina } from './ExactitudCiclicoPagina';

type Consulta = {
  data: ExactitudCiclico | undefined;
  isPending: boolean;
  isError: boolean;
  error: { message: string } | null;
};

const useExactitudCiclico = vi.fn<() => Consulta>();
const mutate =
  vi.fn<
    (
      arg: { id: number; confirmarMovimiento?: boolean },
      opciones?: { onSuccess?: (r: AjusteCiclico) => void; onError?: (e: Error) => void },
    ) => void
  >();

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
    dimension: 'PT',
    fecha: '2026-07-03',
    estado: 'contado',
    observaciones: null,
    canceladoEn: null,
    motivoCancelacion: null,
    renglones: [
      {
        idDet: 41,
        titulo: 'A-100',
        subtitulo: 'Rojo · CH · Sin orden',
        unidad: null,
        cantTeorica: 10,
        cantReal: 12,
        exactitud: 2,
        nombreComplemento: null,
        cantTeoricaComplemento: null,
        cantRealComplemento: null,
        exactitudComplemento: null,
        ajustes: [],
      },
    ],
    totales: { total: 1, contados: 1, exactos: 0, diferencias: 1, teorico: 10, real: 12 },
    ...extra,
  };
}

/** Respuesta del servidor cuando el almacén SE MOVIÓ: 200, sin aplicar, con el aviso. */
function respuestaConAviso(): AjusteCiclico {
  return {
    aplicado: false,
    aviso: {
      articulos: [
        {
          idDet: 41,
          titulo: 'A-100',
          subtitulo: 'Rojo · CH · Sin orden',
          componente: 'cuerpo',
          cantTeorica: 10,
          existenciaActual: 30,
          cantReal: 12,
          ajuste: 2,
          existenciaResultante: 32,
        },
      ],
    },
    exactitud: exactitud(),
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

  it('permite generar el ajuste cuando está CONTADO (con confirmación, SIN confirmar movimiento)', async () => {
    const usuario = userEvent.setup();
    render({ data: exactitud(), isPending: false, isError: false, error: null });

    await usuario.click(screen.getByTestId('ex-generar-ajuste'));
    await usuario.click(screen.getByTestId('ex-confirmar-ajuste'));

    expect(mutate).toHaveBeenCalledTimes(1);
    // El PRIMER intento va SIN confirmar: es el que puede volver con el aviso de la decisión 6.
    expect(mutate.mock.calls[0]?.[0]).toEqual({ id: 5, confirmarMovimiento: false });
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

  it('dice que la hoja está VACÍA cuando no tiene renglones (no "faltan por contar")', () => {
    render({
      data: exactitud({
        estado: 'abierto',
        renglones: [],
        totales: { total: 0, contados: 0, exactos: 0, diferencias: 0, teorico: 0, real: 0 },
      }),
      isPending: false,
      isError: false,
      error: null,
    });
    expect(screen.getByText(/la hoja está vacía/i)).toBeInTheDocument();
  });

  it('⭐ DECISIÓN 6: si el almacén se movió, muestra el AVISO y NO da el ajuste por aplicado', async () => {
    const usuario = userEvent.setup();
    // El servidor responde 200 con `aplicado: false` — la pantalla NO debe cantar victoria.
    mutate.mockImplementation((_arg, opciones) => opciones?.onSuccess?.(respuestaConAviso()));
    render({ data: exactitud(), isPending: false, isError: false, error: null });

    await usuario.click(screen.getByTestId('ex-generar-ajuste'));
    await usuario.click(screen.getByTestId('ex-confirmar-ajuste'));

    const aviso = screen.getByTestId('ex-aviso-movimiento');
    expect(aviso).toHaveTextContent(/el almacén se movió/i);
    expect(aviso).toHaveTextContent('30'); // lo que hay AHORA
    expect(aviso).toHaveTextContent('32'); // en cuánto quedará si se aplica
    expect(screen.getByTestId('ex-aviso-aplicar')).toBeInTheDocument();
  });

  it('⭐ DECISIÓN 6: «Aplicar de todos modos» reintenta CON confirmarMovimiento', async () => {
    const usuario = userEvent.setup();
    mutate.mockImplementation((_arg, opciones) => opciones?.onSuccess?.(respuestaConAviso()));
    render({ data: exactitud(), isPending: false, isError: false, error: null });

    await usuario.click(screen.getByTestId('ex-generar-ajuste'));
    await usuario.click(screen.getByTestId('ex-confirmar-ajuste'));
    await usuario.click(screen.getByTestId('ex-aviso-aplicar'));

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[1]?.[0]).toEqual({ id: 5, confirmarMovimiento: true });
  });

  it('una tela con complemento enseña las DOS cantidades y las DOS exactitudes', () => {
    render({
      data: exactitud({
        dimension: 'TELA',
        renglones: [
          {
            idDet: 77,
            titulo: 'Felpa',
            subtitulo: 'Marino',
            unidad: 'kg',
            cantTeorica: 100,
            cantReal: 95.5,
            exactitud: -4.5,
            nombreComplemento: 'Cardigan',
            cantTeoricaComplemento: 20,
            cantRealComplemento: 23,
            exactitudComplemento: 3,
            ajustes: [
              { id: 9, folio: 300, direccion: 'entrada' },
              { id: 10, folio: 301, direccion: 'salida' },
            ],
          },
        ],
      }),
      isPending: false,
      isError: false,
      error: null,
    });
    const fila = screen.getByTestId('ex-fila-77');
    expect(fila).toHaveTextContent('Cardigan');
    expect(fila).toHaveTextContent('95.5');
    expect(fila).toHaveTextContent('23');
    expect(fila).toHaveTextContent('-4.5');
    expect(fila).toHaveTextContent('+3');
    // Los DOS movimientos del ajuste (entrada por lo que faltó, salida por lo que sobró).
    expect(fila).toHaveTextContent('#300');
    expect(fila).toHaveTextContent('#301');
  });
});
