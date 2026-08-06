import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tela, TelaCategoria, TelasPagina as TipoPagina } from '@/api/telas';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TelasPagina } from './TelasPagina';

// Se controla la capa de datos: las pruebas no tocan la red. `useTelas` captura la query
// con la que se le llama, para verificar el filtro por categoria.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useTelas = vi.fn<(query: unknown) => EstadoConsulta>();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
let ultimaQuery: Record<string, unknown> | undefined;

/** Categorias de ejemplo para el filtro. */
const CATEGORIAS: TelaCategoria[] = [
  {
    id: 7,
    nombre: 'Felpa',
    activo: true,
    creadoEn: '',
    creadoPorId: null,
    modificadoEn: '',
    modificadoPorId: null,
  },
];

vi.mock('@/api/telas', () => ({
  useTelas: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    return useTelas(query);
  },
  useCrearTela: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarTela: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarTela: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarTela: () => ({ mutate: reactivarMutate, isPending: false }),
  useTelasCategorias: () => ({
    data: { datos: CATEGORIAS, total: 1, pagina: 1, porPagina: 100, totalPaginas: 1 },
    isPending: false,
    isError: false,
    error: null,
  }),
}));

// El diálogo se aisla (tiene su propio test): evita arrastrar el form completo.
vi.mock('./DialogoTela', () => ({ DialogoTela: () => null }));

// El editor de precios por proveedor se aisla (tiene su propio test): evita arrastrar sus hooks.
vi.mock('./EditorProveedoresTela', () => ({
  EditorProveedoresTela: () => <div data-testid="editor-proveedores-tela-mock" />,
}));

/** Tela de ejemplo. */
function tela(id: number, nombre: string, sobre: Partial<Tela> = {}): Tela {
  return {
    id,
    nombre,
    descripcion: null,
    idCategoria: 7,
    categoria: 'Felpa',
    idComposicion: null,
    composicion: null,
    idProveedor: null,
    proveedor: null,
    proveedorCorto: null,
    nombreProveedor: null,
    nombreCuerpo: null,
    nombreComplemento: null,
    unidadMedida: 'KG',
    tipoComponente: 'CUERPO',
    favorito: false,
    precioSugerido: null,
    peso: null,
    ancho: null,
    paraProduccion: true,
    colores: [],
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    ...sobre,
  };
}

/** Respuesta paginada de ejemplo. */
function pagina(datos: Tela[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

/** Estado de consulta "con datos". */
function consultaConDatos(datos: Tela[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<TelasPagina>', () => {
  beforeEach(() => {
    useTelas.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
    ultimaQuery = undefined;
  });

  it('lista las telas que devuelve el API (tabla densa)', () => {
    useTelas.mockReturnValue(consultaConDatos([tela(1, 'Felpa A'), tela(2, 'Jersey B')]));
    renderConProveedores(<TelasPagina />, {
      sesion: estadoSesionDePrueba(['telas.ver', 'telas.administrar']),
    });

    // Un renglón por tela (colapsados por defecto, R9: filas expandibles). La tabla y las tarjetas
    // móviles coexisten en el DOM (jsdom ignora `lg:hidden`): se acota a la tabla de escritorio.
    expect(screen.getAllByTestId('fila-tela')).toHaveLength(2);
    expect(screen.getAllByText('Felpa A').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('tela-tabla')).getByText('Jersey B')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay resultados', () => {
    useTelas.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });
    expect(screen.getByText('No hay telas que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el error y un botón de reintento cuando la consulta falla', () => {
    useTelas.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });
    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useTelas.mockReturnValue(consultaConDatos([tela(1, 'Felpa A')]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });

    // "Nueva tela" no aparece; editar/desactivar solo viven en el renglón expandido y son admin.
    expect(screen.queryByTestId('nuevo-tela')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('fila-tela'));
    expect(screen.queryByTestId('editar-tela')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-tela')).not.toBeInTheDocument();
  });

  it('el filtro por categoría se refleja en la consulta del API (como id numérico)', async () => {
    const usuario = userEvent.setup();
    useTelas.mockReturnValue(consultaConDatos([tela(1, 'Felpa A')]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });

    expect(ultimaQuery?.idCategoria).toBeUndefined();
    await usuario.selectOptions(screen.getByTestId('filtro-categoria-tela'), '7');
    expect(ultimaQuery?.idCategoria).toBe(7);
  });

  it('muestra los colores de la tela con su precio al expandir el renglón', () => {
    const conColores = tela(3, 'Felpa C', {
      colores: [
        {
          id: 1,
          nombre: 'Negro',
          precio: 95,
          precioComplemento: null,
          pantone: null,
          idColor: null,
        },
        {
          id: 2,
          nombre: 'Blanco',
          precio: null,
          precioComplemento: null,
          pantone: null,
          idColor: null,
        },
      ],
    });
    useTelas.mockReturnValue(consultaConDatos([conColores]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });

    fireEvent.click(screen.getByTestId('fila-tela'));
    const detalle = screen.getByTestId('tela-colores-detalle');
    expect(within(detalle).getByText('Negro')).toBeInTheDocument();
    expect(within(detalle).getByText('Blanco')).toBeInTheDocument();
    // El precio capturado se muestra; el color sin precio dice "Sin precio".
    expect(within(detalle).getByText('Sin precio')).toBeInTheDocument();
  });

  it('el renglón lee la identidad "nombre · proveedor · nombre del proveedor" (§Post-F9.11)', () => {
    const conDueno = tela(11, 'Felpa 280', {
      proveedor: 'Alsatex',
      nombreProveedor: 'Felpa Suiza',
      composicion: '50% Algodón, 50% Poliéster',
    });
    useTelas.mockReturnValue(consultaConDatos([conDueno]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });

    const fila = within(screen.getByTestId('tela-tabla')).getByTestId('fila-tela');
    expect(within(fila).getByTestId('identidad-tela')).toHaveTextContent(
      'Felpa 280 · Alsatex · Felpa Suiza',
    );
    // La composición acompaña a la unidad en la línea secundaria.
    expect(within(fila).getByText(/50% Algodón, 50% Poliéster/)).toBeInTheDocument();
  });

  it('una MIGRADA sin proveedor muestra solo su nombre (sin puntos vacíos)', () => {
    useTelas.mockReturnValue(consultaConDatos([tela(12, 'FelpaAlsa100')]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });
    const fila = within(screen.getByTestId('tela-tabla')).getByTestId('fila-tela');
    expect(within(fila).getByTestId('identidad-tela')).toHaveTextContent(/^FelpaAlsa100$/);
  });

  it('el detalle muestra el pantone y el precio del COMPLEMENTO solo si la tela lo lleva', () => {
    const conComplemento = tela(13, 'Felpa C', {
      nombreCuerpo: 'Felpa',
      nombreComplemento: 'Cardigan',
      colores: [
        {
          id: 1,
          nombre: 'Negro',
          precio: 95,
          precioComplemento: 60,
          pantone: '19-4005 TCX',
          idColor: null,
        },
      ],
    });
    useTelas.mockReturnValue(consultaConDatos([conComplemento]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });

    fireEvent.click(screen.getByTestId('fila-tela'));
    const detalle = screen.getByTestId('tela-colores-detalle');
    expect(within(detalle).getByTestId('pantone-detalle')).toHaveTextContent('PANTONE 19-4005 TCX');
    // El precio del complemento sale CON SU NOMBRE ("Precio Cardigan"), no genérico.
    expect(within(detalle).getByTestId('precio-complemento-detalle')).toHaveTextContent(
      /^Precio Cardigan:/,
    );
    // Y el resumen del detalle dice "Felpa + Cardigan".
    expect(screen.getByTestId('tela-detalle-complemento')).toHaveTextContent('Felpa + Cardigan');
  });

  it('una tela SIN complemento no muestra el renglón de precio del complemento', () => {
    const sinComplemento = tela(14, 'Lisa', {
      colores: [
        {
          id: 1,
          nombre: 'Negro',
          precio: 95,
          precioComplemento: null,
          pantone: null,
          idColor: null,
        },
      ],
    });
    useTelas.mockReturnValue(consultaConDatos([sinComplemento]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });
    fireEvent.click(screen.getByTestId('fila-tela'));
    expect(screen.queryByTestId('precio-complemento-detalle')).not.toBeInTheDocument();
  });

  // A1.1: peso (gr/m²) y ancho (m) salen en el detalle SOLO si hay valores; el tipo de
  // componente y "¿Para producción?" salieron de la UI (puntos 4 y 5).
  it('el detalle muestra peso y ancho con su unidad solo si hay valores (A1.1)', () => {
    useTelas.mockReturnValue(consultaConDatos([tela(15, 'Con ficha', { peso: 280, ancho: 1.8 })]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });
    fireEvent.click(screen.getByTestId('fila-tela'));
    expect(screen.getByTestId('tela-detalle-peso')).toHaveTextContent('280 gr/m²');
    expect(screen.getByTestId('tela-detalle-ancho')).toHaveTextContent('1.8 m');
    // Lo retirado de la UI (A1.1 puntos 4-5) ya no se pinta en el detalle.
    expect(screen.queryByText('¿Para producción?')).not.toBeInTheDocument();
    expect(screen.queryByText('Tipo de componente')).not.toBeInTheDocument();
  });

  it('sin peso ni ancho capturados, el detalle no pinta esos datos (A1.1)', () => {
    useTelas.mockReturnValue(consultaConDatos([tela(16, 'Sin ficha')]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });
    fireEvent.click(screen.getByTestId('fila-tela'));
    expect(screen.queryByTestId('tela-detalle-peso')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tela-detalle-ancho')).not.toBeInTheDocument();
  });

  it('una tela sin colores muestra el aviso correspondiente al expandir el renglón', () => {
    useTelas.mockReturnValue(consultaConDatos([tela(4, 'Sin colores', { colores: [] })]));
    renderConProveedores(<TelasPagina />, { sesion: estadoSesionDePrueba(['telas.ver']) });
    fireEvent.click(screen.getByTestId('fila-tela'));
    expect(screen.getByTestId('tela-sin-colores')).toBeInTheDocument();
  });

  it('pide confirmación antes de desactivar y llama a la mutación al confirmar', async () => {
    const usuario = userEvent.setup();
    useTelas.mockReturnValue(consultaConDatos([tela(7, 'Vieja')]));
    renderConProveedores(<TelasPagina />, {
      sesion: estadoSesionDePrueba(['telas.ver', 'telas.administrar']),
    });

    // El detalle (con las acciones) se abre al expandir el renglón (tabla-first, R9).
    await usuario.click(screen.getByTestId('fila-tela'));
    await usuario.click(screen.getByTestId('desactivar-tela'));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar tela')).toBeInTheDocument();
    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('una tela inactiva ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useTelas.mockReturnValue(consultaConDatos([tela(9, 'Apagada', { activo: false })]));
    renderConProveedores(<TelasPagina />, {
      sesion: estadoSesionDePrueba(['telas.ver', 'telas.administrar']),
    });

    // El estado "Inactivo" se ve en el propio renglón; las acciones, al expandir. Se acota a la
    // tabla de escritorio (la tarjeta móvil repite el badge en el DOM de jsdom).
    expect(within(screen.getByTestId('tela-tabla')).getByText('Inactivo')).toBeInTheDocument();
    await usuario.click(screen.getByTestId('fila-tela'));
    expect(screen.getByTestId('activar-tela')).toBeInTheDocument();
    await usuario.click(screen.getByTestId('activar-tela'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });
});
