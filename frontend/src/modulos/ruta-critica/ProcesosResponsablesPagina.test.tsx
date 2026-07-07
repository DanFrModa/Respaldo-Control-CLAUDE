import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProcesoRc, RangoDificultadRc } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ProcesosResponsablesPagina } from './ProcesosResponsablesPagina';

/**
 * Tests de <ProcesosResponsablesPagina> (R4): el catálogo se pinta en orden de secuencia (id),
 * el "Detona →" se DERIVA de los antecesores (no se guarda), quitar/agregar antecesor manda el
 * SET completo al backend (que es quien rechaza ciclos), y la tabla de dificultad lista/edita
 * los rangos solo con permiso de administración.
 */

const useProcesosRc = vi.fn();
const fijarDependenciasMutate = vi.fn();
const useRangosDificultadRc = vi.fn();
const useDuracionesTelaRc = vi.fn();
const crearRangoMutate = vi.fn();

vi.mock('@/api/ruta-critica', () => ({
  useProcesosRc: (query: unknown) => useProcesosRc(query) as unknown,
  useFijarDependenciasProcesoRc: () => ({ mutate: fijarDependenciasMutate, isPending: false }),
  // Hooks que usan los diálogos reutilizados (DialogoProcesoRc / EditorRolesProceso).
  useCrearProcesoRc: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarProcesoRc: () => ({ mutate: vi.fn(), isPending: false }),
  useFijarRolesProcesoRc: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/api/roles', () => ({
  useRoles: () => ({ data: [], isPending: false }),
}));

vi.mock('@/api/ruta-critica-plantillas', () => ({
  useRangosDificultadRc: () => useRangosDificultadRc() as unknown,
  useDuracionesTelaRc: () => useDuracionesTelaRc() as unknown,
  useCrearRangoDificultadRc: () => ({ mutate: crearRangoMutate, isPending: false }),
  useActualizarRangoDificultadRc: () => ({ mutate: vi.fn(), isPending: false }),
  useDesactivarRangoDificultadRc: () => ({ mutate: vi.fn(), isPending: false }),
}));

function proceso(id: number, extra: Partial<ProcesoRc> = {}): ProcesoRc {
  return {
    id,
    codigo: `proc-${String(id)}`,
    nombre: `Proceso ${String(id)}`,
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    activo: true,
    roles: [],
    antecesores: [],
    checklist: [],
    creadoEn: '2026-07-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-07-01T00:00:00.000Z',
    modificadoPorId: null,
    ...extra,
  };
}

function rango(id: number, extra: Partial<RangoDificultadRc> = {}): RangoDificultadRc {
  return {
    id,
    opsDesde: 1,
    opsHasta: 8,
    nombre: 'Muy sencillo',
    diasCostura: 6,
    activo: true,
    creadoEn: '2026-07-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-07-01T00:00:00.000Z',
    modificadoPorId: null,
    ...extra,
  };
}

function consultaProcesos(datos: ProcesoRc[]): unknown {
  return {
    data: { datos, total: datos.length, pagina: 1, porPagina: 100, totalPaginas: 1 },
    isPending: false,
    isError: false,
    error: null,
  };
}

beforeEach(() => {
  useProcesosRc.mockReset();
  fijarDependenciasMutate.mockReset();
  crearRangoMutate.mockReset();
  useRangosDificultadRc.mockReturnValue({ data: [rango(1)], isPending: false });
  useDuracionesTelaRc.mockReturnValue({
    data: [
      {
        id: 1,
        nombre: 'Local',
        dias: 5,
        factorTela: 1,
        activo: true,
        creadoEn: '2026-07-01T00:00:00.000Z',
        creadoPorId: null,
        modificadoEn: '2026-07-01T00:00:00.000Z',
        modificadoPorId: null,
      },
    ],
    isPending: false,
  });
});

describe('<ProcesosResponsablesPagina>', () => {
  it('pinta la secuencia con responsables (chips), condicionales y auto/manual', () => {
    useProcesosRc.mockReturnValue(
      consultaProcesos([
        proceso(1, {
          nombre: 'Corte',
          tipoEvento: 'corte',
          roles: [{ idRol: 9, nombre: 'Produccion' }],
        }),
        proceso(2, {
          nombre: 'Envío a procesos',
          condicionAplicabilidad: 'soloSiLlevaAplicacion',
          antecesores: [{ idProceso: 1, codigo: 'proc-1', nombre: 'Corte' }],
        }),
      ]),
    );
    renderConProveedores(<ProcesosResponsablesPagina />, {
      sesion: estadoSesionDePrueba(['rc.catalogo-ver']),
    });

    const filas = screen.getAllByTestId('pyr-proceso');
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveTextContent('Corte');
    expect(filas[0]).toHaveTextContent('Produccion');
    expect(filas[0]).toHaveTextContent('⟳ Auto');
    expect(filas[1]).toHaveTextContent('condicional');
    expect(filas[1]).toHaveTextContent('✋ Manual');
    // Solo lectura: sin rc.catalogo-administrar no hay acciones de edición.
    expect(screen.queryByTestId('pyr-nuevo-proceso')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pyr-editar')).not.toBeInTheDocument();
  });

  it('expande un renglón: "Espera a" con chips y "Detona →" DERIVADO de la vista inversa', async () => {
    const usuario = userEvent.setup();
    useProcesosRc.mockReturnValue(
      consultaProcesos([
        proceso(1, { nombre: 'Corte' }),
        proceso(2, {
          nombre: 'Envío a maquila',
          antecesores: [{ idProceso: 1, codigo: 'proc-1', nombre: 'Corte' }],
        }),
      ]),
    );
    renderConProveedores(<ProcesosResponsablesPagina />, {
      sesion: estadoSesionDePrueba(['rc.catalogo-ver', 'rc.catalogo-administrar']),
    });

    // Expande "Corte" (primer renglón): no espera a nadie y DETONA el envío.
    await usuario.click(screen.getAllByTestId('pyr-expandir')[0] as HTMLElement);
    const deps = screen.getByTestId('pyr-dependencias');
    expect(deps).toHaveTextContent('— es el inicio —');
    expect(deps).toHaveTextContent('Envío a maquila');
  });

  it('quitar un antecesor manda el SET restante al backend (que valida ciclos)', async () => {
    const usuario = userEvent.setup();
    useProcesosRc.mockReturnValue(
      consultaProcesos([
        proceso(1, { nombre: 'Corte' }),
        proceso(2, { nombre: 'Surtido' }),
        proceso(3, {
          nombre: 'Envío a maquila',
          antecesores: [
            { idProceso: 1, codigo: 'proc-1', nombre: 'Corte' },
            { idProceso: 2, codigo: 'proc-2', nombre: 'Surtido' },
          ],
        }),
      ]),
    );
    renderConProveedores(<ProcesosResponsablesPagina />, {
      sesion: estadoSesionDePrueba(['rc.catalogo-ver', 'rc.catalogo-administrar']),
    });

    await usuario.click(screen.getAllByTestId('pyr-expandir')[2] as HTMLElement);
    const chips = screen.getAllByTestId('pyr-quitar-antecesor');
    await usuario.click(chips[0] as HTMLElement); // quita "Corte"
    expect(fijarDependenciasMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3, cuerpo: { idsAntecesores: [2] } }),
      expect.anything(),
    );
  });

  it('la tabla de dificultad lista rangos (∞ para el abierto) y el alta manda el cuerpo correcto', async () => {
    const usuario = userEvent.setup();
    useProcesosRc.mockReturnValue(consultaProcesos([proceso(1)]));
    useRangosDificultadRc.mockReturnValue({
      data: [
        rango(1),
        rango(2, { opsDesde: 33, opsHasta: null, nombre: 'Muy complejo', diasCostura: 20 }),
      ],
      isPending: false,
    });
    renderConProveedores(<ProcesosResponsablesPagina />, {
      sesion: estadoSesionDePrueba(['rc.catalogo-ver', 'rc.catalogo-administrar']),
    });

    const card = screen.getByTestId('pyr-card-dificultad');
    const filas = within(card).getAllByTestId('pyr-rango');
    expect(filas).toHaveLength(2);
    expect(filas[1]).toHaveTextContent('33 – ∞');

    await usuario.click(screen.getByTestId('pyr-agregar-rango'));
    await usuario.type(screen.getByTestId('rango-ops-desde'), '9');
    await usuario.type(screen.getByTestId('rango-nombre'), 'Sencillo');
    await usuario.type(screen.getByTestId('rango-dias'), '8');
    await usuario.click(screen.getByTestId('rango-guardar'));
    expect(crearRangoMutate).toHaveBeenCalledWith(
      { opsDesde: 9, opsHasta: null, nombre: 'Sencillo', diasCostura: 8 },
      expect.anything(),
    );
  });

  it('la card de duración por catálogo re-viste las DuracionPorTipoTela con enlace a Reglas', () => {
    useProcesosRc.mockReturnValue(consultaProcesos([proceso(1)]));
    renderConProveedores(<ProcesosResponsablesPagina />, {
      sesion: estadoSesionDePrueba(['rc.catalogo-ver']),
    });
    const card = screen.getByTestId('pyr-card-catalogo');
    expect(card).toHaveTextContent('Local');
    expect(card).toHaveTextContent('5 d');
    expect(screen.getByTestId('pyr-editar-catalogo')).toHaveAttribute(
      'href',
      '/ruta-critica/reglas-duracion',
    );
  });
});
