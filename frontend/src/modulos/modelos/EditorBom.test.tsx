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
const marcarPrincipalMutate = vi.fn();
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
  useMarcarArtePrincipal: () => ({ mutate: marcarPrincipalMutate, isPending: false }),
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
    composicion: null,
    maquilaBase: null,
    idTemporada: null,
    temporada: null,
    idCurvaTalla: null,
    curvaTalla: null,
    idGenero: null,
    genero: null,
    idTipoProducto: null,
    tipoProducto: null,
    numOperaciones: null,
    corteBase: null,
    idMaquileroCotizado: null,
    maquileroCotizado: null,
    secuenciaEstampado: 'antes',
    cantidadFotos: 0,
    urlFotoPrincipal: null,
    telaPrincipal: null,
    stockPt: null,
    costoActual: null,
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
    expect(toastError).toHaveBeenCalledWith('Captura el precio de cada arte de la receta.');
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

/**
 * ARTE PRINCIPAL del modelo (Daniel, 25-jul-2026): es el PRIMER renglón del BOM (el API lo
 * devuelve ordenado). Lleva estrella + rótulo "Principal"; los demás, la acción para tomar su
 * lugar (endpoint propio, no pasa por "Guardar receta").
 */
describe('<EditorBom> — arte principal', () => {
  beforeEach(() => {
    marcarPrincipalMutate.mockReset();
    guardarBordadosMutate.mockReset();
  });

  /** Ficha con DOS artes en la receta, en el orden en que los devuelve el API. */
  function fichaConDosArtes(): ModeloFicha {
    const ficha = fichaConBordado(30);
    ficha.bordados = [
      { idBordado: 5, nombre: 'Logo', tipo: 'BORDADO', precio: 30 },
      { idBordado: 6, nombre: 'Estampa', tipo: 'ESTAMPADO', precio: 12 },
    ];
    return ficha;
  }

  it('rotula el PRIMER arte como principal y solo ofrece la acción en los demás', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EditorBom ficha={fichaConDosArtes()} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.click(screen.getByTestId('tab-bom-bordados'));

    expect(screen.getByTestId('arte-principal-5')).toHaveTextContent('Principal');
    expect(screen.queryByTestId('arte-principal-6')).not.toBeInTheDocument();
    expect(screen.getByTestId('renglon-bom-bordado-5')).toHaveAttribute('data-principal', 'si');
    expect(screen.queryByTestId('marcar-principal-bordado-5')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('marcar-principal-bordado-6'));
    expect(marcarPrincipalMutate).toHaveBeenCalledTimes(1);
    expect(marcarPrincipalMutate.mock.calls[0]?.[0]).toEqual({ id: 1, idBordado: 6 });
    // Marcar principal NO guarda la receta (son operaciones distintas).
    expect(guardarBordadosMutate).not.toHaveBeenCalled();
  });

  it('un arte recién agregado (aún sin guardar) no se puede marcar como principal', async () => {
    const usuario = userEvent.setup();
    const ficha = fichaConDosArtes();
    // Deja solo el primero guardado; el 5 del catálogo se agregará sin guardar.
    ficha.bordados = [{ idBordado: 6, nombre: 'Estampa', tipo: 'ESTAMPADO', precio: 12 }];
    renderConProveedores(<EditorBom ficha={ficha} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.click(screen.getByTestId('tab-bom-bordados'));
    await usuario.selectOptions(screen.getByTestId('agregar-bordado-bom'), '5');

    // El nuevo entra AL FINAL (no desbanca al principal) y todavía no ofrece la acción.
    expect(screen.getByTestId('renglon-bom-bordado-5')).toHaveAttribute('data-principal', 'no');
    expect(screen.queryByTestId('marcar-principal-bordado-5')).not.toBeInTheDocument();
    expect(screen.getByTestId('arte-principal-6')).toBeInTheDocument();
  });

  // REGRESIÓN: marcar principal recarga la ficha y el editor vuelve a sembrar las TRES pestañas
  // desde el servidor. Si se permitiera con captura pendiente, el usuario perdería lo tecleado
  // creyendo que todo salió bien (el toast dice "éxito"). Se bloquea y se le avisa.
  it('con captura SIN GUARDAR deshabilita "Marcar como principal" y avisa', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EditorBom ficha={fichaConDosArtes()} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.click(screen.getByTestId('tab-bom-bordados'));
    // Con la captura limpia la acción está disponible…
    expect(screen.getByTestId('marcar-principal-bordado-6')).toBeEnabled();
    expect(screen.queryByTestId('aviso-principal-sin-guardar')).not.toBeInTheDocument();

    // …y en cuanto se toca un precio, se bloquea con su aviso.
    await usuario.type(screen.getByTestId('precio-bordado-bom-6'), '5');
    expect(screen.getByTestId('marcar-principal-bordado-6')).toBeDisabled();
    expect(screen.getByTestId('aviso-principal-sin-guardar')).toHaveTextContent(
      'Guarda la receta primero',
    );

    await usuario.click(screen.getByTestId('marcar-principal-bordado-6'));
    expect(marcarPrincipalMutate).not.toHaveBeenCalled();
  });

  it('también se bloquea si la captura pendiente está en OTRA pestaña (telas/avíos)', async () => {
    const usuario = userEvent.setup();
    const ficha = fichaConDosArtes();
    ficha.telas = [
      {
        idTela: 9,
        nombre: 'Jersey',
        consumoPorPrenda: 1,
        paraPreCosto: true,
        paraProduccion: true,
        paraCosto: true,
      },
    ];
    renderConProveedores(<EditorBom ficha={ficha} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    // Se edita el consumo en TELAS (sin guardar) y se cambia a la pestaña de Arte.
    await usuario.clear(screen.getByTestId('consumo-bom-9'));
    await usuario.type(screen.getByTestId('consumo-bom-9'), '3');
    await usuario.click(screen.getByTestId('tab-bom-bordados'));

    expect(screen.getByTestId('marcar-principal-bordado-6')).toBeDisabled();
    expect(screen.getByTestId('aviso-principal-sin-guardar')).toBeInTheDocument();
  });

  it('en solo lectura se ve el rótulo pero no la acción', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EditorBom ficha={fichaConDosArtes()} puedeAdministrar={false} />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
    });

    await usuario.click(screen.getByTestId('tab-bom-bordados'));
    expect(screen.getByTestId('arte-principal-5')).toBeInTheDocument();
    expect(screen.queryByTestId('marcar-principal-bordado-6')).not.toBeInTheDocument();
  });
});
