import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModeloFicha } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { EditorBom } from './EditorBom';

/**
 * Pruebas de componente del `<EditorBom>` (F1-E4). Cubre las dos secciones de SET COMPLETO
 * (telas/avíos: capturar y guardar la receta) y que la pestaña **Arte** delegue en `SeccionArte`
 * —desde V1-E3d (§Post-F9.35) el arte es un HIJO del modelo con CRUD por renglón, no un set que
 * se guarda con "Guardar receta"—. Lo específico del arte se prueba en `SeccionArte.test.tsx`.
 * La capa de datos va simulada (sin red).
 */
const guardarTelasMutate = vi.fn();

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/api/modelos', () => ({
  useReemplazarTelasBom: () => ({ mutate: guardarTelasMutate, isPending: false }),
  useReemplazarAviosBom: () => ({ mutate: vi.fn(), isPending: false }),
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

// Catálogos para los selectores de "agregar" (telas/avíos).
vi.mock('@/api/telas', () => ({ useTelas: () => ({ data: { datos: [] }, isPending: false }) }));
vi.mock('@/api/avios', () => ({ useAvios: () => ({ data: { datos: [] }, isPending: false }) }));

// El ARTE tiene su propia capa de datos (V1-E3d): aquí solo hace falta que no toque la red.
vi.mock('@/api/artes', () => ({
  useEliminarArte: () => ({ mutate: vi.fn(), isPending: false }),
  useMarcarArtePrincipal: () => ({ mutate: vi.fn(), isPending: false }),
  useCrearArte: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarArte: () => ({ mutate: vi.fn(), isPending: false }),
  useCopiarArte: () => ({ mutate: vi.fn(), isPending: false }),
  useGaleriaArte: () => ({ data: { datos: [] }, isPending: false, isError: false }),
  useFotoArte: () => ({ data: null, isPending: false, isError: false }),
  useSubirFotoArte: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarFotoArte: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] }, isPending: false }),
}));

/** Ficha mínima con una tela en la receta y el arte que se le pase. */
function fichaBase(artes: ModeloFicha['artes'] = []): ModeloFicha {
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
    llevaArte: true,
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
    telas: [
      {
        idTela: 9,
        nombre: 'Jersey',
        consumoPorPrenda: 1,
        paraPreCosto: true,
        paraProduccion: true,
        paraCosto: true,
      },
    ],
    avios: [],
    artes,
  };
}

describe('<EditorBom> — secciones de la receta', () => {
  beforeEach(() => {
    guardarTelasMutate.mockReset();
  });

  it('guarda TELAS como set completo con lo capturado', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EditorBom ficha={fichaBase()} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.clear(screen.getByTestId('consumo-bom-9'));
    await usuario.type(screen.getByTestId('consumo-bom-9'), '3');
    await usuario.click(screen.getByTestId('guardar-bom-telas'));

    expect(guardarTelasMutate).toHaveBeenCalledTimes(1);
    const args = guardarTelasMutate.mock.calls[0]?.[0] as {
      id: number;
      telas: { idTela: number; consumoPorPrenda: number }[];
    };
    expect(args.id).toBe(1);
    expect(args.telas[0]).toMatchObject({ idTela: 9, consumoPorPrenda: 3 });
  });

  it('la pestaña Arte muestra la sección de ARTE del modelo (ya no es un set que se guarda)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <EditorBom
        ficha={fichaBase([
          {
            id: 5,
            idModelo: 1,
            nombre: 'Logo',
            descripcion: null,
            puntadas: null,
            precio: 30,
            tipo: 'BORDADO',
            idProveedor: null,
            proveedor: null,
            idArchivoFoto: null,
            orden: 0,
            creadoEn: '2026-01-01T00:00:00.000Z',
            creadoPorId: null,
            modificadoEn: '2026-01-01T00:00:00.000Z',
            modificadoPorId: null,
          },
        ])}
        puedeAdministrar
      />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    await usuario.click(screen.getByTestId('tab-bom-artes'));

    expect(screen.getByTestId('seccion-bom-artes')).toBeInTheDocument();
    expect(screen.getByTestId('renglon-arte-5')).toBeInTheDocument();
    // El arte NO se guarda con "Guardar receta": tiene sus propias acciones.
    expect(screen.queryByTestId('guardar-bom-artes')).not.toBeInTheDocument();
    expect(screen.getByTestId('agregar-arte')).toBeInTheDocument();
  });
});
