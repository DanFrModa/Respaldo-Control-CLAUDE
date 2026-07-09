import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EdrLineas, EdrPorMes } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ConciliacionPagina } from './ConciliacionPagina';

const mock: { porMes: unknown; lineas: unknown } = { porMes: null, lineas: null };
const mutacion = { mutate: vi.fn(), isPending: false };

vi.mock('@/api/edr', () => ({
  useEdrPorMes: () => mock.porMes,
  useEdrLineas: () => mock.lineas,
  useAjustarLinea: () => mutacion,
  useEliminarLinea: () => mutacion,
  useAgregarLineaManual: () => mutacion,
}));
vi.mock('@/api/empresas', () => ({ useEmpresas: () => ({ data: [] }) }));
vi.mock('@/api/clientes', () => ({ useClientes: () => ({ data: { datos: [] } }) }));

describe('ConciliacionPagina', () => {
  it('lista las líneas con su origen y marca las que no tienen costo', () => {
    const porMes: EdrPorMes = {
      existe: true,
      anio: 2026,
      mes: 6,
      edr: {
        encabezado: {
          id: 7,
          anio: 2026,
          mes: 6,
          gastos: 0,
          intereses: 0,
          bonificaciones: 0,
          otros: 0,
          descOtros: null,
          observaciones: null,
          creadoEn: '2026-06-01T00:00:00.000Z',
          modificadoEn: '2026-06-01T00:00:00.000Z',
        },
        ventas: 0,
        costo: 0,
        utilidadBruta: 0,
        gastos: 0,
        intereses: 0,
        bonificaciones: 0,
        otros: 0,
        resultado: 0,
        totalPiezas: 0,
        totalLineas: 0,
        lineasSinCosto: 0,
        cortesEmpresa: [],
        cortesCliente: [],
      },
    };
    const lineas: EdrLineas = {
      idEdr: 7,
      anio: 2026,
      mes: 6,
      lineas: [
        {
          id: 1,
          idEdr: 7,
          idOrden: 10,
          folioOrden: 55,
          idEmpresa: 1,
          empresa: 'FR Moda',
          idCliente: 3,
          cliente: 'Tienda X',
          idModelo: 4,
          modelo: 'MOD-1',
          descripcion: null,
          cantVendida: 20,
          precioVenta: 100,
          importe: 2000,
          costoUnitActual: 20,
          costoActual: 400,
          sinCosto: false,
          costoHistorico: null,
          origen: 'automatica',
        },
        {
          id: 2,
          idEdr: 7,
          idOrden: 11,
          folioOrden: 56,
          idEmpresa: 1,
          empresa: 'FR Moda',
          idCliente: 3,
          cliente: 'Tienda X',
          idModelo: null,
          modelo: null,
          descripcion: null,
          cantVendida: 5,
          precioVenta: 50,
          importe: 250,
          costoUnitActual: null,
          costoActual: 0,
          sinCosto: true,
          costoHistorico: null,
          origen: 'ajustada',
        },
      ],
      totalPiezas: 25,
      totalVentas: 2250,
      totalCosto: 400,
    };
    mock.porMes = { data: porMes, isPending: false, isError: false, error: null };
    mock.lineas = { data: lineas, isPending: false, isError: false, error: null };

    renderConProveedores(<ConciliacionPagina />, {
      sesion: estadoSesionDePrueba(['edr.ver', 'edr.capturar']),
      rutaInicial: '/edr/conciliacion?anio=2026&mes=6',
    });
    expect(screen.getByTestId('con-fila-1')).toHaveTextContent('#55');
    expect(screen.getByTestId('con-fila-1')).toHaveTextContent('Automática');
    expect(screen.getByTestId('con-fila-2')).toHaveTextContent('sin costo');
    expect(screen.getByTestId('con-fila-2')).toHaveTextContent('Ajustada');
  });

  it('muestra el aviso cuando el mes no se ha generado', () => {
    mock.porMes = {
      data: { existe: false, anio: 2026, mes: 9, edr: null },
      isPending: false,
      isError: false,
      error: null,
    };
    mock.lineas = { data: undefined, isPending: false, isError: false, error: null };
    renderConProveedores(<ConciliacionPagina />, {
      sesion: estadoSesionDePrueba(['edr.ver']),
      rutaInicial: '/edr/conciliacion?anio=2026&mes=9',
    });
    expect(screen.getByTestId('con-no-generado')).toBeInTheDocument();
  });
});
