import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CxpEstadoCuenta } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { EstadoCuentaProveedorPagina } from './EstadoCuentaProveedorPagina';

/** Estado mutable del hook mockeado. */
const estado: { valor: unknown } = { valor: null };

vi.mock('@/api/cxp', () => ({
  useEstadoCuentaProveedor: () => estado.valor,
  useRegistrarMovimientoCxp: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarMovimientoCxp: () => ({ mutate: vi.fn(), isPending: false }),
  imprimirEstadoCuentaCxp: vi.fn(),
}));

// El selector de proveedor consulta el catálogo; en el test no toca la red.
vi.mock('@/api/proveedores', () => ({
  // CxP NO acota por rol: una cuenta por pagar puede ser de cualquier tercero.
  useProveedoresPorRol: () => ({
    data: { datos: [] },
    isPending: false,
    isError: false,
    isFetching: false,
  }),
}));

const cuenta: CxpEstadoCuenta = {
  tipoTercero: 'proveedor',
  idTercero: 7,
  tercero: 'Hilaturas del Norte',
  vista: 'operativa',
  segmento: 'todos',
  desde: null,
  hasta: null,
  saldo: {
    tipoTercero: 'proveedor',
    idTercero: 7,
    tercero: 'Hilaturas del Norte',
    saldo: 700,
    saldoFiscal: 0,
    saldoSinFactura: 0,
    saldoMovimientos: 700,
    saldoEsMa: 0,
    incluyeEsMa: true,
  },
  movimientos: [
    {
      fuente: 'motor',
      id: 11,
      idEmpresa: 1,
      folio: 1,
      tipoTercero: 'proveedor',
      idTercero: 7,
      tercero: 'Hilaturas del Norte',
      fecha: '2026-07-01',
      origen: 'entrada_sin_factura',
      monto: 1000,
      fechaVencimiento: '2026-07-16',
      esFiscal: false,
      uuidCfdi: null,
      rfcTercero: null,
      idArchivoCfdi: null,
      refTipo: null,
      refId: null,
      observaciones: 'material recibido',
      cancelado: false,
      esInverso: false,
      creadoEn: '2026-07-01T00:00:00.000Z',
      creadoPorId: null,
    },
  ],
  total: 1,
  pagina: 1,
  porPagina: 20,
  totalPaginas: 1,
};

const conProveedor = { pathname: '/cxp/estado-cuenta', state: { idProveedor: 7 } };

describe('EstadoCuentaProveedorPagina (F9-E2)', () => {
  beforeEach(() => {
    estado.valor = { data: cuenta, isPending: false, isError: false, error: null };
  });

  it('sin proveedor elegido invita a seleccionarlo', () => {
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver']),
    });
    expect(screen.getByText(/Elige un proveedor/i)).toBeInTheDocument();
  });

  it('muestra el saldo y los movimientos del proveedor', () => {
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'consultas.ver-importes']),
      rutaInicial: conProveedor,
    });
    expect(screen.getByTestId('cxp-edc-saldo')).toHaveTextContent('$700.00');
    const fila = screen.getByTestId('cxp-edc-fila');
    expect(fila).toHaveTextContent('Entrada sin factura');
    expect(fila).toHaveTextContent('$1,000.00');
  });

  it('el botón de capturar solo aparece con `cxp.administrar`', () => {
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver']),
      rutaInicial: conProveedor,
    });
    expect(screen.queryByTestId('cxp-edc-capturar')).not.toBeInTheDocument();
  });

  it('con `cxp.administrar` aparecen capturar y cancelar', () => {
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'cxp.administrar', 'consultas.ver-importes']),
      rutaInicial: conProveedor,
    });
    expect(screen.getByTestId('cxp-edc-capturar')).toBeInTheDocument();
    expect(screen.getByTestId('cxp-edc-cancelar')).toBeInTheDocument();
  });
});
