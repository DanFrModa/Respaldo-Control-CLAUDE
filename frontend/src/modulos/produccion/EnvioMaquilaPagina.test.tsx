import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden, PendientesOrden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { EnvioMaquilaPagina } from './EnvioMaquilaPagina';

// ── Mocks ────────────────────────────────────────────────────────────────────
const crearMutate = vi.fn();
// Captura la query con la que se pidió `useProveedores` para verificar el filtro por rol.
let queryProveedores: Record<string, unknown> | undefined;

vi.mock('@/api/etapas', () => ({
  useCrearEnvio: () => ({ mutate: crearMutate, isPending: false }),
  usePendientesOrden: () => ({ data: pendientes, refetch: vi.fn() }),
  useEtapasOrden: () => ({
    data: { idOrden: 1, folioOrden: 100, etapas: [] },
    isPending: false,
    isError: false,
    error: null,
  }),
  useCancelarCorte: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarEnvio: () => ({ mutate: vi.fn(), isPending: false }),
  urlImpresoEnvio: (id: number) => `/api/produccion/envios/${id}/impreso`,
  urlFichaEstampado: (id: number) => `/api/produccion/envios/${id}/ficha-estampado`,
}));

vi.mock('@/api/ordenes', () => ({
  useOrden: () => ({ data: orden, isPending: false, isError: false, error: null }),
  useOrdenes: () => ({
    data: { datos: [orden], total: 1, pagina: 1, porPagina: 8, totalPaginas: 1 },
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/api/tipos-proceso', () => ({
  useTiposProceso: () => ({
    data: {
      datos: [
        {
          id: 5,
          codigo: 'costura',
          nombre: 'Costura',
          generaEntradaPt: true,
          activo: true,
          creadoEn: '',
          creadoPorId: null,
          modificadoEn: '',
          modificadoPorId: null,
        },
        {
          id: 6,
          codigo: 'estampado',
          nombre: 'Estampado',
          generaEntradaPt: false,
          activo: true,
          creadoEn: '',
          creadoPorId: null,
          modificadoEn: '',
          modificadoPorId: null,
        },
      ],
    },
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/api/proveedores', () => ({
  useProveedores: (query: Record<string, unknown>) => {
    queryProveedores = query;
    // Devuelve un maquilero distinto según el rol pedido, para comprobar el filtrado.
    if (query.rol === 11) {
      return { data: { datos: [{ id: 20, nombre: 'Maquila Costura SA' }] } };
    }
    if (query.rol === 12) {
      return { data: { datos: [{ id: 30, nombre: 'Estampados SA' }] } };
    }
    return { data: { datos: [] } };
  },
  useRolesProveedor: () => ({
    data: [
      { id: 11, codigo: 'maquila-costura', nombre: 'Maquila (costura)' },
      { id: 12, codigo: 'estampado', nombre: 'Estampado' },
    ],
  }),
}));

// ── Datos ────────────────────────────────────────────────────────────────────
const orden: Orden = {
  id: 1,
  folio: 100,
  idEmpresa: 1,
  estado: 'completa',
  idPedidoLinea: 1,
  idModelo: 1,
  codigoModelo: 'A-100',
  descripcionModelo: 'Playera',
  idCliente: 1,
  cliente: 'Liverpool',
  idMaquilero: null,
  maquilero: null,
  idEtiquetaMarca: null,
  etiquetaMarca: null,
  idTela: null,
  tela: null,
  fecha: null,
  fechaEntrega: null,
  observaciones: null,
  composicion: null,
  compForzada: false,
  obsMaquila: null,
  noCostear: false,
  fechaCompletada: '2026-06-18T00:00:00.000Z',
  motivoCancelada: null,
  tallasV1: null,
  maquilaOrd: null,
  aplicacionOrd: null,
  pagada: null,
  enRiesgo: null,
  siRC: null,
  rcViva: null,
  lineas: [
    {
      id: 1,
      idColor: 3,
      color: 'Rojo',
      tallas: [{ idTalla: 4, etiquetaTalla: 'CH', cantidad: 10 }],
      totalPiezas: 10,
    },
  ],
  totalPiezas: 10,
  referencias: [],
  comentarios: [],
  creadoEn: '2026-06-18T00:00:00.000Z',
  creadoPorId: null,
  modificadoEn: '2026-06-18T00:00:00.000Z',
  modificadoPorId: null,
};

// Cortado por enviar a costura (proceso 5): Rojo CH 5 disponible.
const pendientes: PendientesOrden = {
  idOrden: 1,
  folioOrden: 100,
  porCortar: [],
  totalPorCortar: 0,
  cortadoTotal: 5,
  cortadoPorEnviar: [
    {
      idTipoProceso: 5,
      tipoProceso: 'Costura',
      codigoProceso: 'costura',
      celdas: [{ idColor: 3, color: 'Rojo', idTalla: 4, etiquetaTalla: 'CH', cantidad: 5 }],
      totalPendiente: 5,
    },
  ],
};

const sesion = () =>
  estadoSesionDePrueba(['produccion.envio', 'produccion.wip-ver', 'produccion.cancelar']);

async function elegirOrden(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  await usuario.click(screen.getByTestId('envio-selector-orden-opcion'));
}

describe('EnvioMaquilaPagina (F3-E2)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    queryProveedores = undefined;
  });

  it('filtra el maquilero por el ROL que mapea al proceso (costura → maquila-costura)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EnvioMaquilaPagina />, { sesion: sesion() });
    await elegirOrden(usuario);

    await usuario.selectOptions(screen.getByTestId('envio-proceso'), '5'); // Costura
    // El selector de proveedores se pidió con el rol "maquila-costura" (id 11).
    expect(queryProveedores?.rol).toBe(11);
    expect(screen.getByRole('option', { name: 'Maquila Costura SA' })).toBeInTheDocument();
  });

  it('no deja exceder lo cortado: avisa y deshabilita guardar (sobre-envío estricto, g)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EnvioMaquilaPagina />, { sesion: sesion() });
    await elegirOrden(usuario);

    await usuario.selectOptions(screen.getByTestId('envio-proceso'), '5');
    await usuario.selectOptions(screen.getByTestId('envio-maquilero'), '20');

    // Captura CH = 8 (cortado disponible 5) → aviso de exceso + guardar deshabilitado.
    const celda = screen.getByTestId('envio-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '8');

    expect(screen.getByTestId('envio-aviso-exceso')).toBeInTheDocument();
    expect(screen.getByTestId('envio-guardar')).toBeDisabled();

    // Dentro de lo cortado (5) ya habilita y envía.
    await usuario.clear(celda);
    await usuario.type(celda, '5');
    expect(screen.queryByTestId('envio-aviso-exceso')).not.toBeInTheDocument();
    expect(screen.getByTestId('envio-guardar')).toBeEnabled();
  });
});
