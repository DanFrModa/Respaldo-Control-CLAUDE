import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModeloFicha } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { EditorBom } from './EditorBom';

/**
 * Pruebas de componente del `<EditorBom>` (F1-E4): se centra en la REGLA de captura del
 * precio del bordado (decisión cerrada #2: precio REQUERIDO en la UI, pre-llenado desde el
 * catálogo, nullable solo en BD para el ETL). La capa de datos va simulada (sin red).
 */
const guardarBordadosMutate = vi.fn();
const guardarTelasMutate = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: (m: string): void => {
      toastError(m);
    },
  },
}));

vi.mock('@/api/modelos', () => ({
  useReemplazarTelasBom: () => ({ mutate: guardarTelasMutate, isPending: false }),
  useReemplazarAviosBom: () => ({ mutate: vi.fn(), isPending: false }),
  useReemplazarBordadosBom: () => ({ mutate: guardarBordadosMutate, isPending: false }),
  useCopiarBom: () => ({ mutate: vi.fn(), isPending: false }),
  // useModelos lo usa el CopiarBomDialogo montado (cerrado).
  useModelos: () => ({
    data: { datos: [], total: 0, pagina: 1, porPagina: 20, totalPaginas: 1 },
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Catálogos para los selectores de "agregar".
vi.mock('@/api/telas', () => ({ useTelas: () => ({ data: { datos: [] }, isPending: false }) }));
vi.mock('@/api/avios', () => ({ useAvios: () => ({ data: { datos: [] }, isPending: false }) }));
vi.mock('@/api/bordados', () => ({
  useBordados: () => ({
    data: { datos: [{ id: 5, nombre: 'Logo', tipo: 'BORDADO', precio: 30 }] },
    isPending: false,
  }),
}));

/** Ficha con un bordado ya en la receta (con precio) para sembrar la captura. */
function fichaConBordado(precio: number | null): ModeloFicha {
  return {
    id: 1,
    codigo: '501',
    descripcion: null,
    maquilaBase: null,
    idTemporada: null,
    temporada: null,
    idCurvaTalla: null,
    curvaTalla: null,
    idGenero: null,
    genero: null,
    cantidadFotos: 0,
    urlFotoPrincipal: null,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    telas: [],
    avios: [],
    bordados: [{ idBordado: 5, nombre: 'Logo', tipo: 'BORDADO', precio }],
  };
}

describe('<EditorBom> — precio del bordado requerido (decisión #2)', () => {
  beforeEach(() => {
    guardarBordadosMutate.mockReset();
    guardarTelasMutate.mockReset();
    toastError.mockReset();
  });

  it('no deja guardar un bordado con precio vacío: avisa y marca el campo, sin mutar', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EditorBom ficha={fichaConBordado(30)} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    // Ir a la pestaña Bordados y vaciar el precio del renglón.
    await usuario.click(screen.getByTestId('tab-bom-bordados'));
    const precio = screen.getByTestId('precio-bordado-bom-5');
    await usuario.clear(precio);

    // Intentar guardar: no muta, avisa y marca el campo inválido.
    await usuario.click(screen.getByTestId('guardar-bom-bordados'));
    expect(guardarBordadosMutate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Captura el precio de cada bordado de la receta.');
    expect(screen.getByTestId('error-precio-bordado-5')).toBeInTheDocument();
    expect(precio).toHaveAttribute('aria-invalid', 'true');
  });

  it('con precio capturado, guarda enviando el precio (number) del bordado', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EditorBom ficha={fichaConBordado(null)} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.click(screen.getByTestId('tab-bom-bordados'));
    await usuario.type(screen.getByTestId('precio-bordado-bom-5'), '45');
    await usuario.click(screen.getByTestId('guardar-bom-bordados'));

    expect(guardarBordadosMutate).toHaveBeenCalledTimes(1);
    const args = guardarBordadosMutate.mock.calls[0]?.[0] as {
      id: number;
      bordados: { idBordado: number; precio: number }[];
    };
    expect(args.id).toBe(1);
    expect(args.bordados).toEqual([{ idBordado: 5, precio: 45 }]);
  });

  it('al pre-llenar desde el catálogo, agregar un bordado trae su precio del catálogo', async () => {
    const usuario = userEvent.setup();
    // Ficha sin bordados: se agrega uno desde el catálogo (precio 30 pre-llenado).
    const ficha = fichaConBordado(30);
    ficha.bordados = [];
    renderConProveedores(<EditorBom ficha={ficha} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.click(screen.getByTestId('tab-bom-bordados'));
    await usuario.selectOptions(screen.getByTestId('agregar-bordado-bom'), '5');
    const renglon = within(screen.getByTestId('seccion-bom-bordados')).getByTestId(
      'precio-bordado-bom-5',
    );
    // El precio se pre-llenó con el del catálogo (30), editable.
    expect(renglon).toHaveValue(30);
  });
});
