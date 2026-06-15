import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Curva,
  CurvasPagina as TipoCurvasPagina,
  Talla,
  TallasPagina as TipoTallasPagina,
} from '@/api/tipos';
import { ErrorDeApi } from '@/api/errores';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TallasCurvasPagina } from './TallasCurvasPagina';

// Se controla la capa de datos: las pruebas no tocan la red.
type EstadoConsultaTallas = {
  data: TipoTallasPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
type EstadoConsultaCurvas = {
  data: TipoCurvasPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};

const useTallas = vi.fn<() => EstadoConsultaTallas>();
const useCurvas = vi.fn<() => EstadoConsultaCurvas>();
const desactivarTallaMutate = vi.fn();
const reactivarTallaMutate = vi.fn();
const desactivarCurvaMutate = vi.fn();
const reactivarCurvaMutate = vi.fn();

vi.mock('@/api/tallas', () => ({
  useTallas: () => useTallas(),
  useCurvas: () => useCurvas(),
  useTallasActivas: () => ({
    data: { datos: [], total: 0, pagina: 1, porPagina: 100, totalPaginas: 1 },
    isPending: false,
    isError: false,
    error: null,
  }),
  useCrearTalla: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarTalla: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarTalla: () => ({ mutate: desactivarTallaMutate, isPending: false }),
  useReactivarTalla: () => ({ mutate: reactivarTallaMutate, isPending: false }),
  useCrearCurva: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarCurva: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarCurva: () => ({ mutate: desactivarCurvaMutate, isPending: false }),
  useReactivarCurva: () => ({ mutate: reactivarCurvaMutate, isPending: false }),
}));

/** Talla de ejemplo. */
function talla(id: number, etiqueta: string, activo = true, orden = 0): Talla {
  return {
    id,
    etiqueta,
    orden,
    activo,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

/** Curva de ejemplo (con sus items ordenados). */
function curva(id: number, nombre: string, items: Curva['items'], activo = true): Curva {
  return {
    id,
    nombre,
    activo,
    items,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

function paginaTallas(datos: Talla[]): TipoTallasPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

function paginaCurvas(datos: Curva[]): TipoCurvasPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

function consultaTallas(datos: Talla[]): EstadoConsultaTallas {
  return {
    data: paginaTallas(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

function consultaCurvas(datos: Curva[]): EstadoConsultaCurvas {
  return {
    data: paginaCurvas(datos),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

const TODO = ['tallas.ver', 'tallas.administrar'] as const;

describe('<TallasCurvasPagina>', () => {
  beforeEach(() => {
    useTallas.mockReset();
    useCurvas.mockReset();
    desactivarTallaMutate.mockReset();
    reactivarTallaMutate.mockReset();
    desactivarCurvaMutate.mockReset();
    reactivarCurvaMutate.mockReset();
    // Por defecto ambas listas vacías (cada test sobreescribe lo suyo).
    useTallas.mockReturnValue(consultaTallas([]));
    useCurvas.mockReturnValue(consultaCurvas([]));
  });

  describe('pestaña Tallas', () => {
    it('lista las tallas que devuelve el API', () => {
      useTallas.mockReturnValue(consultaTallas([talla(1, 'CH'), talla(2, 'M')]));
      renderConProveedores(<TallasCurvasPagina />, { sesion: estadoSesionDePrueba([...TODO]) });

      expect(screen.getAllByTestId('fila-talla')).toHaveLength(2);
      expect(screen.getAllByText('CH').length).toBeGreaterThan(0);
      expect(screen.getByText('M')).toBeInTheDocument();
    });

    it('muestra el estado vacío cuando no hay tallas', () => {
      renderConProveedores(<TallasCurvasPagina />, { sesion: estadoSesionDePrueba([...TODO]) });
      expect(screen.getByText('No hay tallas que coincidan con la búsqueda.')).toBeInTheDocument();
    });

    it('muestra el error y un botón de reintento cuando la consulta falla', () => {
      useTallas.mockReturnValue({
        data: undefined,
        isPending: false,
        isError: true,
        isFetching: false,
        error: new ErrorDeApi({ codigo: 'SERVIDOR', mensaje: 'No se pudo cargar la lista.' }),
        refetch: vi.fn(),
      });
      renderConProveedores(<TallasCurvasPagina />, { sesion: estadoSesionDePrueba([...TODO]) });

      expect(screen.getByText('No se pudo cargar la lista.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    });

    it('oculta las acciones de escritura para quien solo puede ver', () => {
      useTallas.mockReturnValue(consultaTallas([talla(1, 'CH')]));
      renderConProveedores(<TallasCurvasPagina />, {
        sesion: estadoSesionDePrueba(['tallas.ver']),
      });

      expect(screen.queryByTestId('nuevo-talla')).not.toBeInTheDocument();
      expect(screen.queryByTestId('editar-talla')).not.toBeInTheDocument();
      expect(screen.queryByTestId('desactivar-talla')).not.toBeInTheDocument();
    });

    it('pide confirmación antes de desactivar y llama a la mutación al confirmar', async () => {
      const usuario = userEvent.setup();
      useTallas.mockReturnValue(consultaTallas([talla(7, 'XG')]));
      renderConProveedores(<TallasCurvasPagina />, { sesion: estadoSesionDePrueba([...TODO]) });

      await usuario.click(screen.getByTestId('desactivar-talla'));
      const dialogo = await screen.findByRole('dialog');
      expect(within(dialogo).getByText('Desactivar talla')).toBeInTheDocument();

      await usuario.click(screen.getByTestId('confirmar-accion'));
      expect(desactivarTallaMutate).toHaveBeenCalledWith(7, expect.anything());
    });

    it('una talla inactiva ofrece Activar y reactiva directo (sin confirmación)', async () => {
      const usuario = userEvent.setup();
      useTallas.mockReturnValue(consultaTallas([talla(9, 'Apagada', false)]));
      renderConProveedores(<TallasCurvasPagina />, { sesion: estadoSesionDePrueba([...TODO]) });

      expect(screen.getByTestId('activar-talla')).toBeInTheDocument();
      expect(screen.queryByTestId('desactivar-talla')).not.toBeInTheDocument();

      await usuario.click(screen.getByTestId('activar-talla'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(reactivarTallaMutate).toHaveBeenCalledWith(9, expect.anything());
    });
  });

  describe('pestaña Curvas', () => {
    it('al cambiar de pestaña muestra las curvas con sus tallas en orden', async () => {
      const usuario = userEvent.setup();
      useCurvas.mockReturnValue(
        consultaCurvas([
          curva(1, 'Dama básica', [
            { idTalla: 10, etiqueta: 'CH', posicion: 0 },
            { idTalla: 11, etiqueta: 'M', posicion: 1 },
            { idTalla: 12, etiqueta: 'G', posicion: 2 },
          ]),
        ]),
      );
      renderConProveedores(<TallasCurvasPagina />, { sesion: estadoSesionDePrueba([...TODO]) });

      await usuario.click(screen.getByTestId('pestana-curvas'));

      expect(screen.getAllByText('Dama básica').length).toBeGreaterThan(0);
      // El detalle pinta las tallas en orden.
      const tallasDetalle = screen.getByTestId('detalle-curva-tallas');
      const etiquetas = within(tallasDetalle)
        .getAllByText(/^(CH|M|G)$/)
        .map((n) => n.textContent);
      expect(etiquetas).toEqual(['CH', 'M', 'G']);
    });

    it('pide confirmación antes de desactivar una curva', async () => {
      const usuario = userEvent.setup();
      useCurvas.mockReturnValue(
        consultaCurvas([curva(5, 'Caballero', [{ idTalla: 1, etiqueta: 'M', posicion: 0 }])]),
      );
      renderConProveedores(<TallasCurvasPagina />, { sesion: estadoSesionDePrueba([...TODO]) });

      await usuario.click(screen.getByTestId('pestana-curvas'));
      await usuario.click(screen.getByTestId('desactivar-curva'));

      const dialogo = await screen.findByRole('dialog');
      expect(within(dialogo).getByText('Desactivar curva')).toBeInTheDocument();
      await usuario.click(screen.getByTestId('confirmar-accion'));
      expect(desactivarCurvaMutate).toHaveBeenCalledWith(5, expect.anything());
    });
  });
});
