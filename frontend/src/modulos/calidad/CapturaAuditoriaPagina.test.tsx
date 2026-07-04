import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auditoria } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CapturaAuditoriaPagina } from './CapturaAuditoriaPagina';

const mutateCapturar = vi.fn();

// Mock de la capa de datos (sin red).
vi.mock('@/api/calidad', () => ({
  useAuditoria: () => auditoriaResult,
  useCapturarResultado: () => ({ mutate: mutateCapturar, isPending: false }),
  useReclasificar: () => ({ mutate: vi.fn(), isPending: false }),
  useDefectos: () => ({
    data: { datos: [], total: 0, pagina: 1, totalPaginas: 0, porPagina: 100 },
  }),
}));
vi.mock('@/api/ordenes', () => ({
  useOrden: () => ({ data: undefined }),
}));

function crearAuditoria(): Auditoria {
  return {
    id: 7,
    numAuditoria: 12,
    idEmpresa: 1,
    idOrden: 3,
    folioOrden: 100,
    codigoModelo: 'A-100',
    idMaquilero: 5,
    maquilero: 'Maquila SA',
    fechaElaboracion: '2026-06-26',
    fechaAuditoria: '2026-06-26',
    elaboroPorId: 'u1',
    auditorPorId: 'u1',
    tamanoMuestra: 13,
    muestraManual: false,
    resultado: 'no_calificado',
    resultadoManual: true,
    tipoAuditoria: 'final',
    observaciones: null,
    cancelada: false,
    totalFallas: 0,
    defectos: [
      {
        idDefecto: 1,
        clave: 'F-1',
        descripcion: 'Costura abierta',
        nivelAQL: 1,
        favorito: true,
        activo: true,
        numFallas: 0,
      },
    ],
    sugerencia: {
      resoluble: true,
      idPlan: 1,
      nombrePlan: 'ISO 2859',
      tamanoLote: 30,
      tamanoMuestra: 13,
      niveles: [{ nivelAQL: 1, totalFallas: 0, aceptar: 0, rechazar: 1, sugerencia: 'aprobar' }],
      sugerenciaGlobal: 'aprobar',
      mensaje: null,
    },
    creadoEn: '2026-06-26T00:00:00Z',
    creadoPorId: 'u1',
    modificadoEn: '2026-06-26T00:00:00Z',
    modificadoPorId: 'u1',
  };
}

let auditoriaResult: {
  data: Auditoria | undefined;
  isPending: boolean;
  isError: boolean;
  error: { message: string } | null;
};

const sesionCaptura = estadoSesionDePrueba(['calidad.ver', 'calidad.actualizar-auditorias']);

function renderCaptura(sesion = sesionCaptura): void {
  renderConProveedores(
    <Routes>
      <Route path="/calidad/auditorias/:id" element={<CapturaAuditoriaPagina />} />
    </Routes>,
    { sesion, rutaInicial: '/calidad/auditorias/7' },
  );
}

beforeEach(() => {
  mutateCapturar.mockReset();
  auditoriaResult = { data: crearAuditoria(), isPending: false, isError: false, error: null };
});

describe('CapturaAuditoriaPagina', () => {
  it('muestra el folio, el grid de defectos y la sugerencia AQL', () => {
    renderCaptura();
    expect(screen.getByText(/Auditoría #12/)).toBeDefined();
    expect(screen.getByTestId('auditoria-grid')).toBeDefined();
    expect(screen.getByText('F-1')).toBeDefined();
    expect(screen.getByTestId('auditoria-sugerencia')).toBeDefined();
    expect(screen.getByTestId('auditoria-resultado')).toBeDefined();
  });

  it('estado de carga y error', () => {
    auditoriaResult = { data: undefined, isPending: true, isError: false, error: null };
    renderCaptura();
    expect(screen.getByText(/Cargando auditoría/i)).toBeDefined();
  });

  it('guarda con el resultado MANUAL elegido y las fallas capturadas', async () => {
    const user = userEvent.setup();
    renderCaptura();

    // Captura 3 fallas del defecto nivel 1.
    const inputFallas = screen.getByTestId('auditoria-fallas-1');
    await user.clear(inputFallas);
    await user.type(inputFallas, '3');

    // Elige reprobar a mano y guarda.
    await user.selectOptions(screen.getByTestId('auditoria-resultado'), 'reprobado');
    await user.click(screen.getByTestId('auditoria-guardar'));

    expect(mutateCapturar).toHaveBeenCalledTimes(1);
    const args = mutateCapturar.mock.calls[0]?.[0] as {
      id: number;
      cuerpo: { resultado: string; defectos: { idDefecto: number; numFallas: number }[] };
    };
    expect(args.id).toBe(7);
    expect(args.cuerpo.resultado).toBe('reprobado');
    expect(args.cuerpo.defectos).toEqual([{ idDefecto: 1, numFallas: 3 }]);
  });

  it('sin permiso de actualizar no muestra agregar-defecto ni la reclasificación', () => {
    renderCaptura(estadoSesionDePrueba(['calidad.ver']));
    expect(screen.queryByTestId('auditoria-agregar-defecto')).toBeNull();
    expect(screen.queryByTestId('reclasif-sentido')).toBeNull();
  });
});
