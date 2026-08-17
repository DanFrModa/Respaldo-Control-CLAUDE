import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorDeApi } from '@/api/errores';
import type { OrdenesConsultaPagina, OrdenLigera } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ConsultaOrdenesPagina } from './ConsultaOrdenesPagina';

// Capa de datos controlada: las pruebas no tocan la red.
type EstadoConsulta = {
  data: OrdenesConsultaPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useConsultaOrdenes = vi.fn<(query: unknown) => EstadoConsulta>();
let ultimaQuery: Record<string, unknown> | undefined;
const imprimirOrden = vi.fn<(id: number) => void>();
const imprimirLoteOrdenes = vi.fn<(ids: number[]) => Promise<void>>(() => Promise.resolve());

vi.mock('@/api/ordenes-consulta', () => ({
  useConsultaOrdenes: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return useConsultaOrdenes(query);
  },
  imprimirOrden: (id: number) => imprimirOrden(id),
  imprimirLoteOrdenes: (ids: number[]) => imprimirLoteOrdenes(ids),
}));
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [] }, isPending: false }),
}));

function ordenLigera(id: number, folio: number, extra: Partial<OrdenLigera> = {}): OrdenLigera {
  return {
    id,
    folio,
    estado: 'completa',
    fecha: '2026-06-15',
    fechaEntrega: '2026-06-30',
    idModelo: 10,
    codigoModelo: 'A-100',
    descripcionModelo: 'Playera',
    idCliente: 3,
    cliente: 'Liverpool',
    idMaquilero: null,
    maquilero: null,
    totalPiezas: 420,
    ...extra,
  };
}

function pagina(datos: OrdenLigera[]): OrdenesConsultaPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 20, totalPaginas: 1 };
}

function conDatos(datos: OrdenLigera[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<ConsultaOrdenesPagina>', () => {
  beforeEach(() => {
    useConsultaOrdenes.mockReset();
    imprimirOrden.mockReset();
    imprimirLoteOrdenes.mockReset();
    ultimaQuery = undefined;
  });

  it('lista las órdenes ligeras que devuelve el API', () => {
    useConsultaOrdenes.mockReturnValue(conDatos([ordenLigera(1, 101), ordenLigera(2, 102)]));
    renderConProveedores(<ConsultaOrdenesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });
    expect(screen.getAllByTestId('fila-consulta')).toHaveLength(2);
    // La tabla y las tarjetas móviles coexisten en el DOM (jsdom ignora `lg:hidden`): el folio se
    // busca dentro de la tabla de escritorio para no chocar con el duplicado de la tarjeta.
    expect(
      within(screen.getByTestId('consulta-ordenes-tabla')).getByText('102'),
    ).toBeInTheDocument();
  });

  it('la búsqueda se refleja en la query del API (con debounce)', async () => {
    const usuario = userEvent.setup();
    useConsultaOrdenes.mockReturnValue(conDatos([ordenLigera(1, 101)]));
    renderConProveedores(<ConsultaOrdenesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });
    expect(ultimaQuery?.busqueda).toBeUndefined();
    await usuario.type(screen.getByTestId('buscar-consulta'), '101');
    await vi.waitFor(() => expect(ultimaQuery?.busqueda).toBe('101'));
  });

  it('el filtro de estado se refleja en la query', async () => {
    const usuario = userEvent.setup();
    useConsultaOrdenes.mockReturnValue(conDatos([ordenLigera(1, 101)]));
    renderConProveedores(<ConsultaOrdenesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });
    await usuario.selectOptions(screen.getByTestId('filtro-estado'), 'capturada');
    await vi.waitFor(() => expect(ultimaQuery?.estado).toBe('capturada'));
  });

  it('selecciona filas e imprime el lote con sus ids', async () => {
    const usuario = userEvent.setup();
    useConsultaOrdenes.mockReturnValue(conDatos([ordenLigera(1, 101), ordenLigera(2, 102)]));
    renderConProveedores(<ConsultaOrdenesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });

    // El botón de lote arranca deshabilitado (sin selección).
    expect(screen.getByTestId('imprimir-lote')).toBeDisabled();

    // Selecciono las dos filas con "seleccionar todas".
    await usuario.click(screen.getByTestId('seleccionar-todas'));
    expect(screen.getByTestId('imprimir-lote')).toBeEnabled();

    await usuario.click(screen.getByTestId('imprimir-lote'));
    expect(imprimirLoteOrdenes).toHaveBeenCalledWith([1, 2]);
  });

  it('imprime una orden individual', async () => {
    const usuario = userEvent.setup();
    useConsultaOrdenes.mockReturnValue(conDatos([ordenLigera(7, 107)]));
    renderConProveedores(<ConsultaOrdenesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });
    await usuario.click(screen.getByTestId('imprimir-individual'));
    expect(imprimirOrden).toHaveBeenCalledWith(7);
  });

  it('cada fila enlaza al detalle de captura de su orden', () => {
    useConsultaOrdenes.mockReturnValue(conDatos([ordenLigera(5, 105)]));
    renderConProveedores(<ConsultaOrdenesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });
    const enlace = screen.getByTestId('enlace-detalle');
    expect(enlace).toHaveAttribute('href', '/produccion/ordenes');
  });

  it('los saltos a proceso/OC/notas/costos son stubs deshabilitados', () => {
    useConsultaOrdenes.mockReturnValue(conDatos([ordenLigera(1, 101)]));
    renderConProveedores(<ConsultaOrdenesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });
    expect(screen.getByTestId('stub-documentos')).toBeDisabled();
  });

  it('muestra el error y un botón de reintento cuando falla', () => {
    useConsultaOrdenes.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<ConsultaOrdenesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });
    expect(screen.getByText('No se pudo cargar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('arranca con los filtros del deep-link del tablero (año/cliente)', () => {
    useConsultaOrdenes.mockReturnValue(conDatos([ordenLigera(1, 101)]));
    renderConProveedores(<ConsultaOrdenesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
      rutaInicial: { pathname: '/produccion/consulta', state: { anio: 2025, idCliente: 3 } },
    });
    const select = within(screen.getByTestId('consulta-ordenes')).getByTestId('filtro-anio');
    expect(select).toHaveValue('2025');
  });

  it('⭐ el deep-link MUESTRA el nombre del cliente por el que filtra (no miente con «Todos»)', () => {
    // `useClientes` está mockeado con lista VACÍA a propósito: reproduce el caso real de la
    // búsqueda server-side, donde el combobox sólo conoce 10 de ~117 clientes y el que viene del
    // tablero casi nunca está entre ellos. Sin `nombreInicial` el campo se quedaba en el
    // placeholder «Todos los clientes» MIENTRAS la consulta sí iba filtrada por ese cliente: la
    // pantalla mentía sobre su propio filtro.
    useConsultaOrdenes.mockReturnValue(conDatos([ordenLigera(1, 101)]));
    renderConProveedores(<ConsultaOrdenesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
      rutaInicial: {
        pathname: '/produccion/consulta',
        state: { anio: 2025, idCliente: 3, nombreCliente: 'Zapatería Zaragoza' },
      },
    });
    expect(screen.getByTestId('filtro-cliente-busqueda')).toHaveValue('Zapatería Zaragoza');
    // Y el filtro de verdad viaja al backend (la pantalla no sólo lo aparenta).
    expect(ultimaQuery?.idCliente).toBe(3);
  });

  it('sin nombre en el deep-link no inventa uno (llegada legítima sin cliente)', () => {
    useConsultaOrdenes.mockReturnValue(conDatos([ordenLigera(1, 101)]));
    renderConProveedores(<ConsultaOrdenesPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
      rutaInicial: { pathname: '/produccion/consulta', state: { anio: 2025, idCliente: null } },
    });
    expect(screen.getByTestId('filtro-cliente-busqueda')).toHaveValue('');
    expect(ultimaQuery?.idCliente).toBeUndefined();
  });
});
