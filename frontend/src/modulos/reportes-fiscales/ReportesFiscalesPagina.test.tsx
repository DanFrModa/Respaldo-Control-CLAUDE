import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClavePermiso, ReporteFiscal, SaludFiscal } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ReportesFiscalesPagina } from './ReportesFiscalesPagina';

/** Estado mutable de los hooks + spies de export, hoisted para el factory de vi.mock. */
const mocks = vi.hoisted(() => {
  const reporte: { valor: unknown } = { valor: null };
  const salud: { valor: unknown } = { valor: null };
  return { reporte, salud, exportarExcel: vi.fn(), imprimir: vi.fn() };
});

vi.mock('@/api/reportes-fiscales', () => ({
  useReporteFiscal: () => mocks.reporte.valor,
  useSaludFiscal: () => mocks.salud.valor,
  exportarReporteFiscalExcel: mocks.exportarExcel,
  imprimirReporteFiscal: mocks.imprimir,
}));

const reporteMock: ReporteFiscal = {
  desde: null,
  hasta: null,
  filas: [
    {
      id: 1,
      folio: 1001,
      fecha: '2026-07-01',
      tipoTercero: 'proveedor',
      idTercero: 7,
      tercero: 'Telas del Norte',
      rfcTercero: 'TNO900101AAA',
      origen: 'factura_proveedor',
      uuidCfdi: 'UUID-CFDI-1',
      tieneXml: true,
      monto: 1000,
      esCargo: true,
      cancelado: false,
      esInverso: false,
    },
  ],
  total: 1,
  pagina: 1,
  porPagina: 50,
  totalPaginas: 1,
  totales: { cargos: 1000, abonos: 300, neto: 700, movimientos: 1 },
};

const saludMock: SaludFiscal = {
  desde: null,
  hasta: null,
  totalFiscales: 5,
  conCfdi: 4,
  sinCfdi: 1,
  conXml: 3,
  sinXml: 2,
  pctConciliado: 80,
  saldos: [
    {
      tipoTercero: 'proveedor',
      idTercero: 7,
      tercero: 'Telas del Norte',
      rfc: 'TNO900101AAA',
      saldoFiscal: 700,
      movimientos: 2,
    },
  ],
};

const PERM: ClavePermiso[] = ['terceros.fiscal', 'consultas.ver-importes'];

describe('ReportesFiscalesPagina (F9-E5)', () => {
  beforeEach(() => {
    mocks.reporte.valor = { data: reporteMock, isPending: false, isError: false, error: null };
    mocks.salud.valor = { data: saludMock, isPending: false, isError: false, error: null };
    mocks.exportarExcel.mockClear();
    mocks.imprimir.mockClear();
  });

  it('pinta los KPIs de salud fiscal', () => {
    renderConProveedores(<ReportesFiscalesPagina />, { sesion: estadoSesionDePrueba(PERM) });
    expect(screen.getByTestId('kpi-fiscales')).toHaveTextContent('5');
    expect(screen.getByTestId('kpi-conciliado')).toHaveTextContent('80');
    expect(screen.getByTestId('kpi-pendientes')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-sin-xml')).toHaveTextContent('2');
  });

  it('lista los movimientos fiscales con su CFDI y los totales', () => {
    renderConProveedores(<ReportesFiscalesPagina />, { sesion: estadoSesionDePrueba(PERM) });
    const fila = screen.getByTestId('rf-fila');
    expect(fila).toHaveTextContent('Telas del Norte');
    expect(fila).toHaveTextContent('TNO900101AAA');
    expect(fila).toHaveTextContent('UUID-CFDI-1');
    expect(fila).toHaveTextContent('$1,000.00');

    const totales = screen.getByTestId('rf-totales');
    expect(totales).toHaveTextContent('$700.00'); // neto
  });

  it('muestra los saldos fiscales por tercero', () => {
    renderConProveedores(<ReportesFiscalesPagina />, { sesion: estadoSesionDePrueba(PERM) });
    const saldos = screen.getByTestId('rf-saldos');
    expect(saldos).toHaveTextContent('Telas del Norte');
    expect(saldos).toHaveTextContent('$700.00');
  });

  it('los botones de export disparan la descarga Excel/PDF', () => {
    renderConProveedores(<ReportesFiscalesPagina />, { sesion: estadoSesionDePrueba(PERM) });
    fireEvent.click(screen.getByTestId('reporte-fiscal-excel'));
    expect(mocks.exportarExcel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('reporte-fiscal-pdf'));
    expect(mocks.imprimir).toHaveBeenCalledTimes(1);
  });

  it('estado vacío cuando no hay movimientos fiscales', () => {
    mocks.reporte.valor = {
      data: {
        ...reporteMock,
        filas: [],
        total: 0,
        totales: { cargos: 0, abonos: 0, neto: 0, movimientos: 0 },
      },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<ReportesFiscalesPagina />, { sesion: estadoSesionDePrueba(PERM) });
    expect(
      screen.getByText('No hay movimientos fiscales para los filtros elegidos.'),
    ).toBeInTheDocument();
  });
});
