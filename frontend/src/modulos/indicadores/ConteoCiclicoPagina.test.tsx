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
const agregar = vi.fn<(arg: unknown, opciones?: unknown) => void>();

vi.mock('@/api/inventario-ciclico', () => ({
  useConteoCiclico: () => useConteoCiclico(),
  useCapturarConteo: () => ({ mutate, isPending: false }),
  useAgregarRenglonCiclico: () => ({ mutate: agregar, isPending: false }),
}));

// Los catálogos del diálogo «Agregar artículo» y los combobox no son el objeto de esta prueba:
// se sustituyen por lo mínimo para que la pantalla monte.
vi.mock('@/api/colores', () => ({
  useColores: () => ({ data: { datos: [{ id: 3, nombre: 'Rojo' }] } }),
}));
vi.mock('@/api/tallas', () => ({
  useTallasActivas: () => ({ data: { datos: [{ id: 4, etiqueta: 'CH' }] } }),
}));
vi.mock('@/api/telas', () => ({ useTela: () => ({ data: undefined }) }));
vi.mock('@/modulos/inventarios/SelectorModelo', () => ({
  SelectorModelo: ({
    alSeleccionar,
  }: {
    alSeleccionar: (m: { id: number; codigo: string }) => void;
  }) => (
    <button type="button" onClick={() => alSeleccionar({ id: 2, codigo: 'A-100' })}>
      elegir modelo
    </button>
  ),
}));
vi.mock('@/modulos/inventarios/SelectorTela', () => ({ SelectorTela: () => <div /> }));
vi.mock('@/modulos/inventarios/SelectorAvio', () => ({
  SelectorAvio: ({
    alSeleccionar,
  }: {
    alSeleccionar: (a: { id: number; clave: string }) => void;
  }) => (
    <button type="button" onClick={() => alSeleccionar({ id: 8, clave: 'BOT-01' })}>
      elegir avío
    </button>
  ),
}));

/** Hoja de PRODUCTO TERMINADO: conteo CIEGO — el servidor no manda `cantTeorica`. */
function conteoPt(extra: Partial<ConteoCiclico> = {}): ConteoCiclico {
  return {
    id: 5,
    folio: 12,
    idAlmacen: 1,
    almacen: 'Primeras',
    dimension: 'PT',
    fecha: '2026-07-03',
    estado: 'abierto',
    renglones: [
      {
        idDet: 41,
        titulo: 'A-100',
        subtitulo: 'Rojo · CH · Sin orden',
        unidad: null,
        cantReal: null,
        nombreComplemento: null,
        cantRealComplemento: null,
        contado: false,
      },
    ],
    ...extra,
  };
}

/** Hoja de TELAS: el saldo del sistema SÍ viaja, y la tela lleva complemento (D5). */
function conteoTela(extra: Partial<ConteoCiclico> = {}): ConteoCiclico {
  return {
    id: 7,
    folio: 20,
    idAlmacen: 4,
    almacen: 'Telas',
    dimension: 'TELA',
    fecha: '2026-07-03',
    estado: 'abierto',
    renglones: [
      {
        idDet: 77,
        titulo: 'Felpa',
        subtitulo: 'Marino',
        unidad: 'kg',
        cantTeorica: 100,
        cantReal: null,
        nombreComplemento: 'Cardigan',
        cantTeoricaComplemento: 20,
        cantRealComplemento: null,
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
    agregar.mockReset();
  });

  it('PT: muestra el artículo y su campo de conteo, SIN saldo del sistema (conteo ciego)', () => {
    render({ data: conteoPt(), isPending: false, isError: false, error: null });

    expect(screen.getByTestId('cc-fila-41')).toHaveTextContent('A-100');
    expect(screen.getByTestId('cc-fila-41')).toHaveTextContent('Rojo');
    expect(screen.getByTestId('cc-cant-41')).toBeInTheDocument();
    // Conteo ciego: ni la columna «Sistema» ni ninguna etiqueta de "teórico".
    expect(screen.queryByTestId('cc-saldo-41')).not.toBeInTheDocument();
    expect(screen.queryByText(/teórico/i)).not.toBeInTheDocument();
  });

  it('PT: captura la cantidad física y llama a capturar con el payload', async () => {
    const usuario = userEvent.setup();
    render({ data: conteoPt(), isPending: false, isError: false, error: null });

    await usuario.type(screen.getByTestId('cc-cant-41'), '12');
    await usuario.click(screen.getByTestId('cc-guardar'));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      id: 5,
      cuerpo: { renglones: [{ idDet: 41, cantReal: 12 }] },
    });
  });

  it('avisa cuando el inventario ya está cerrado', () => {
    render({
      data: conteoPt({ estado: 'cerrado' }),
      isPending: false,
      isError: false,
      error: null,
    });
    expect(screen.getByText(/no admite más conteo/i)).toBeInTheDocument();
  });

  it('⭐ TELAS: enseña el SALDO DEL SISTEMA y anticipa la diferencia al teclear', async () => {
    const usuario = userEvent.setup();
    render({ data: conteoTela(), isPending: false, isError: false, error: null });

    const saldo = screen.getByTestId('cc-saldo-77');
    expect(saldo).toHaveTextContent('100 kg');
    await usuario.type(screen.getByTestId('cc-cant-77'), '95');
    expect(saldo).toHaveTextContent('-5');
  });

  it('⭐ TELAS con complemento (D5): captura los DOS números en el mismo renglón', async () => {
    const usuario = userEvent.setup();
    render({ data: conteoTela(), isPending: false, isError: false, error: null });

    await usuario.type(screen.getByTestId('cc-cant-77'), '95.5');
    await usuario.type(screen.getByTestId('cc-comp-77'), '23');
    await usuario.click(screen.getByTestId('cc-guardar'));

    expect(mutate.mock.calls[0]?.[0]).toEqual({
      id: 5,
      cuerpo: { renglones: [{ idDet: 77, cantReal: 95.5, cantRealComplemento: 23 }] },
    });
  });

  it('una hoja VACÍA invita a agregar artículos en vez de quedarse muda', () => {
    render({ data: conteoTela({ renglones: [] }), isPending: false, isError: false, error: null });
    expect(screen.getByText(/la hoja está vacía/i)).toBeInTheDocument();
    expect(screen.getByTestId('cc-agregar')).toBeInTheDocument();
  });

  it('⭐ agrega un artículo que el sistema cree que no tiene (avíos)', async () => {
    const usuario = userEvent.setup();
    render({
      data: conteoTela({ dimension: 'AVIO', renglones: [] }),
      isPending: false,
      isError: false,
      error: null,
    });

    await usuario.click(screen.getByTestId('cc-agregar'));
    await usuario.click(screen.getByText('elegir avío'));
    await usuario.click(screen.getByTestId('cc-ag-guardar'));

    expect(agregar).toHaveBeenCalledTimes(1);
    expect(agregar.mock.calls[0]?.[0]).toEqual({ id: 5, cuerpo: { idAvio: 8 } });
  });
});
