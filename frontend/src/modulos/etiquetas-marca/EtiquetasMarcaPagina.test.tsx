import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EtiquetaMarca, EtiquetasMarcaPagina as TipoPagina } from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { EtiquetasMarcaPagina } from './EtiquetasMarcaPagina';

// Se controla la capa de datos: las pruebas no tocan la red.
type EstadoConsulta = {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
const useEtiquetasMarca = vi.fn<() => EstadoConsulta>();
const crearMutate = vi.fn();
const desactivarMutate = vi.fn();
const reactivarMutate = vi.fn();
vi.mock('@/api/etiquetas-marca', () => ({
  useEtiquetasMarca: () => useEtiquetasMarca(),
  useCrearEtiquetaMarca: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarEtiquetaMarca: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarEtiquetaMarca: () => ({ mutate: desactivarMutate, isPending: false }),
  useReactivarEtiquetaMarca: () => ({ mutate: reactivarMutate, isPending: false }),
}));

/** Etiqueta de ejemplo. */
function etiqueta(id: number, nombre: string, regalias = 0, activo = true): EtiquetaMarca {
  return {
    id,
    nombre,
    regalias,
    activo,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

/** Respuesta paginada de ejemplo con las etiquetas dadas. */
function pagina(datos: EtiquetaMarca[]): TipoPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

/** Estado de consulta "con datos" (forma minima que usa el componente). */
function consultaConDatos(datos: EtiquetaMarca[]): EstadoConsulta {
  return {
    data: pagina(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('<EtiquetasMarcaPagina>', () => {
  beforeEach(() => {
    useEtiquetasMarca.mockReset();
    crearMutate.mockReset();
    desactivarMutate.mockReset();
    reactivarMutate.mockReset();
  });

  it('lista las etiquetas y muestra las regalías como porcentaje', () => {
    useEtiquetasMarca.mockReturnValue(
      consultaConDatos([etiqueta(1, 'Marca Norte', 8), etiqueta(2, 'Marca Sur', 12.5)]),
    );
    renderConProveedores(<EtiquetasMarcaPagina />, {
      sesion: estadoSesionDePrueba(['etiquetas-marca.ver', 'etiquetas-marca.administrar']),
    });

    // Hay dos renglones; el primero queda auto-seleccionado y su detalle muestra el
    // porcentaje de regalías. El % aparece en la lista y en el detalle (getAllByText).
    expect(screen.getAllByTestId('fila-etiqueta-marca')).toHaveLength(2);
    expect(screen.getAllByText('Marca Norte').length).toBeGreaterThan(0);
    expect(screen.getByText('Marca Sur')).toBeInTheDocument();
    const detalle = screen.getByTestId('detalle-etiqueta-marca');
    expect(within(detalle).getByText('8%')).toBeInTheDocument();
  });

  it('muestra el estado vacio cuando no hay resultados', () => {
    useEtiquetasMarca.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<EtiquetasMarcaPagina />, {
      sesion: estadoSesionDePrueba(['etiquetas-marca.ver', 'etiquetas-marca.administrar']),
    });

    expect(screen.getByText('No hay etiquetas que coincidan con la búsqueda.')).toBeInTheDocument();
  });

  it('muestra el mensaje de error y un boton de reintento cuando la consulta falla', () => {
    useEtiquetasMarca.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
      refetch: vi.fn(),
    });
    renderConProveedores(<EtiquetasMarcaPagina />, {
      sesion: estadoSesionDePrueba(['etiquetas-marca.ver', 'etiquetas-marca.administrar']),
    });

    expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    useEtiquetasMarca.mockReturnValue(consultaConDatos([etiqueta(1, 'Marca Norte', 8)]));
    renderConProveedores(<EtiquetasMarcaPagina />, {
      sesion: estadoSesionDePrueba(['etiquetas-marca.ver']),
    });

    expect(screen.queryByTestId('nuevo-etiqueta-marca')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-etiqueta-marca')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-etiqueta-marca')).not.toBeInTheDocument();
  });

  it('pide confirmacion antes de desactivar y llama a la mutacion al confirmar', async () => {
    const usuario = userEvent.setup();
    useEtiquetasMarca.mockReturnValue(consultaConDatos([etiqueta(7, 'Marca Vieja', 5)]));
    renderConProveedores(<EtiquetasMarcaPagina />, {
      sesion: estadoSesionDePrueba(['etiquetas-marca.ver', 'etiquetas-marca.administrar']),
    });

    // El registro queda auto-seleccionado: "Desactivar" es un boton directo del detalle.
    await usuario.click(screen.getByTestId('desactivar-etiqueta-marca'));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Desactivar etiqueta de marca')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('confirmar-accion'));
    expect(desactivarMutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it('una etiqueta inactiva ofrece Activar y reactiva directo (sin confirmación)', async () => {
    const usuario = userEvent.setup();
    useEtiquetasMarca.mockReturnValue(consultaConDatos([etiqueta(9, 'Marca Apagada', 5, false)]));
    renderConProveedores(<EtiquetasMarcaPagina />, {
      sesion: estadoSesionDePrueba(['etiquetas-marca.ver', 'etiquetas-marca.administrar']),
    });

    const detalle = screen.getByTestId('detalle-etiqueta-marca');
    expect(within(detalle).getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByTestId('activar-etiqueta-marca')).toBeInTheDocument();
    expect(screen.queryByTestId('desactivar-etiqueta-marca')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('activar-etiqueta-marca'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reactivarMutate).toHaveBeenCalledWith(9, expect.anything());
  });

  it('el formulario rechaza regalías fuera de 0–100 y no llama a crear', async () => {
    const usuario = userEvent.setup();
    useEtiquetasMarca.mockReturnValue(consultaConDatos([]));
    renderConProveedores(<EtiquetasMarcaPagina />, {
      sesion: estadoSesionDePrueba(['etiquetas-marca.ver', 'etiquetas-marca.administrar']),
    });

    await usuario.click(screen.getByTestId('nuevo-etiqueta-marca'));
    const dialogo = await screen.findByRole('dialog');
    await usuario.type(within(dialogo).getByLabelText('Nombre'), 'Marca X');
    await usuario.type(within(dialogo).getByLabelText('Regalías (%)'), '150');
    await usuario.click(screen.getByTestId('guardar-etiqueta-marca'));

    // La validacion de captura corta el envio: aparece el error y crear NO se llama.
    expect(
      await within(dialogo).findByText('Las regalías no pueden ser mayores a 100%'),
    ).toBeInTheDocument();
    expect(crearMutate).not.toHaveBeenCalled();
  });
});
