import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditoriaResumen, AuditoriasPagina, ResumenAuditorias } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ConsultaAuditoriasPagina } from './ConsultaAuditoriasPagina';

const imprimir = vi.fn();

vi.mock('@/api/calidad', () => ({
  useAuditorias: () => auditoriasResult,
  useResumenAuditorias: () => resumenResult,
  imprimirAuditoria: (id: number) => {
    imprimir(id);
  },
  // Hooks usados por los diálogos (siempre montados, con `abierto=false`).
  useAuditoria: () => ({ data: undefined, isPending: false, isError: false, error: null }),
  useModificarAuditoria: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarAuditoria: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [{ id: 5, nombre: 'Maquila SA' }] } }),
}));

function fila(numAuditoria: number, extra: Partial<AuditoriaResumen> = {}): AuditoriaResumen {
  return {
    id: numAuditoria,
    numAuditoria,
    folioOrden: 100 + numAuditoria,
    codigoModelo: 'A-100',
    idMaquilero: 5,
    maquilero: 'Maquila SA',
    fechaAuditoria: '2026-06-30',
    tipoAuditoria: 'final',
    resultado: 'aprobado',
    tamanoMuestra: 13,
    totalFallas: 0,
    nivelAqlPrincipal: null,
    cancelada: false,
    ...extra,
  };
}

let auditoriasResult: {
  data: AuditoriasPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: { message: string } | null;
  refetch: () => void;
};

let resumenResult: { data: ResumenAuditorias | undefined };

function pagina(datos: AuditoriaResumen[]): AuditoriasPagina {
  return { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 };
}

function render(
  sesion = estadoSesionDePrueba(['calidad.ver', 'calidad.modificar-auditorias']),
): void {
  renderConProveedores(
    <Routes>
      <Route path="/calidad/auditorias" element={<ConsultaAuditoriasPagina />} />
    </Routes>,
    { sesion, rutaInicial: '/calidad/auditorias' },
  );
}

beforeEach(() => {
  imprimir.mockReset();
  auditoriasResult = {
    data: pagina([fila(2), fila(1, { resultado: 'reprobado', totalFallas: 4 })]),
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
  resumenResult = { data: { defectoPrincipal: null } };
});

describe('ConsultaAuditoriasPagina', () => {
  it('lista las auditorías con su folio', () => {
    render();
    // Tabla-first: cada renglón muestra el nº de auditoría como "#N" (el cajón está cerrado al inicio).
    expect(screen.getAllByTestId('fila-consulta-auditoria')).toHaveLength(2);
    expect(screen.getByText('#2')).toBeDefined();
    expect(screen.getByText('#1')).toBeDefined();
  });

  it('al hacer clic en un renglón abre el cajón con el título de la auditoría', async () => {
    const user = userEvent.setup();
    render();
    // El cajón está cerrado hasta que se elige un renglón (patrón tabla-first + cajón por ID). El
    // título del cajón se busca DENTRO del diálogo (role=dialog): la tarjeta móvil también muestra
    // "Auditoría #N" en el DOM de jsdom (que ignora `lg:hidden`), así que no se puede buscar suelto.
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getAllByTestId('fila-consulta-auditoria')[0] as HTMLElement);
    expect(within(screen.getByRole('dialog')).getByText('Auditoría #2')).toBeDefined();
  });

  it('KPIs con datos: la card "Defecto principal" pinta clave/descripción y la columna AQL su nivel', () => {
    // Fixture POBLADO (antes solo se cubría el estado vacío defectoPrincipal:null / AQL null).
    auditoriasResult = {
      ...auditoriasResult,
      data: pagina([fila(3, { resultado: 'reprobado', totalFallas: 7, nivelAqlPrincipal: 2.5 })]),
    };
    resumenResult = {
      data: {
        defectoPrincipal: {
          idDefecto: 9,
          clave: 'COS-01',
          descripcion: 'Costura abierta',
          totalFallas: 7,
        },
      },
    };
    render();

    // La card del KPI muestra la clave como valor y descripción · total como pie.
    const card = screen.getByTestId('kpi-defecto-principal');
    expect(within(card).getByText('COS-01')).toBeDefined();
    expect(within(card).getByText('Costura abierta · 7 fallas')).toBeDefined();

    // La columna AQL del renglón pinta el nivel del defecto principal de ESA auditoría.
    const renglon = screen.getByTestId('fila-consulta-auditoria');
    expect(within(renglon).getByText('2.5')).toBeDefined();
  });

  it('estado de carga: el armazón (título) se muestra mientras carga', () => {
    auditoriasResult = { ...auditoriasResult, data: undefined, isPending: true };
    render();
    // R9 fidelidad: el título es el del proto `vCalidad`.
    expect(screen.getByRole('heading', { name: 'Control de calidad · AQL' })).toBeDefined();
  });

  it('estado vacío', () => {
    auditoriasResult = { ...auditoriasResult, data: pagina([]) };
    render();
    expect(screen.getByText(/No hay auditorías/i)).toBeDefined();
  });

  it('imprime el PDF de la auditoría seleccionada', async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getAllByTestId('fila-consulta-auditoria')[0] as HTMLElement);
    await user.click(screen.getByTestId('imprimir-consulta-auditoria'));
    expect(imprimir).toHaveBeenCalledWith(2);
  });

  it('con calidad.modificar-auditorias muestra Modificar y Cancelar', async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getAllByTestId('fila-consulta-auditoria')[0] as HTMLElement);
    expect(screen.getByTestId('modificar-consulta-auditoria')).toBeDefined();
    expect(screen.getByTestId('cancelar-consulta-auditoria')).toBeDefined();
  });

  it('sin calidad.modificar-auditorias oculta Modificar y Cancelar pero deja Imprimir', async () => {
    const user = userEvent.setup();
    render(estadoSesionDePrueba(['calidad.ver']));
    await user.click(screen.getAllByTestId('fila-consulta-auditoria')[0] as HTMLElement);
    expect(screen.queryByTestId('modificar-consulta-auditoria')).toBeNull();
    expect(screen.queryByTestId('cancelar-consulta-auditoria')).toBeNull();
    expect(screen.getByTestId('imprimir-consulta-auditoria')).toBeDefined();
  });
});
