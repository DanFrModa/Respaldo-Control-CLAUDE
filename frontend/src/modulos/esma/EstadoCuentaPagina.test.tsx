import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EsMaEstadoCuenta, EsMaSaldo } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { EstadoCuentaPagina } from './EstadoCuentaPagina';

/** Estado mutable de los hooks mockeados (objeto estable para el factory de vi.mock). */
const mock: { estado: unknown } = { estado: null };
const revisarMutate = vi.fn();
const corregirMutate = vi.fn();

const saldo: EsMaSaldo = {
  idMaquilero: 5,
  maquilero: 'Maquila SA',
  conFactura: null,
  totalCargos: 1000,
  totalAbonos: 0,
  totalPagos: 200,
  totalDescuentos: 0,
  saldo: 800,
  pendienteRevision: {
    abonos: 0,
    pagos: 0,
    descuentos: 0,
    cargos: 0,
    neto: 0,
    partidas: 0,
    cargosPartidas: 0,
    cargosSinPrecio: 0,
  },
};

const estadoConMovimientos: EsMaEstadoCuenta = {
  idMaquilero: 5,
  maquilero: 'Maquila SA',
  desde: null,
  hasta: null,
  conFactura: null,
  saldo,
  movimientos: [
    {
      concepto: 'abono',
      id: 1,
      fecha: '2026-06-30',
      referencia: 'Anticipo',
      monto: 500,
      estadoRevision: 'capturado',
      pendienteRevision: true,
      corregible: false,
      observacionesGuardadas: null,
      importeGuardado: 500,
      importeCorregible: false,
    },
  ],
  // V1-E8k (§Post-F9.136): el maquilero entregó 2 prendas incompletas. Van FUERA de `movimientos`
  // y del saldo — el fixture las trae para que la tarjeta informativa se ejercite de verdad.
  incompletas: {
    filas: [
      {
        idRecibo: 77,
        folioRecibo: 77,
        fecha: '2026-06-28',
        idOrden: 9,
        folioOrden: 100,
        codigoModelo: 'A-100',
        descripcionModelo: 'Playera',
        tipoProceso: 'Costura',
        piezas: 2,
      },
    ],
    totalPiezas: 2,
  },
};

vi.mock('@/api/esma', () => ({
  useEstadoCuenta: () => mock.estado,
  useRevisarMovimiento: () => ({ mutate: revisarMutate, isPending: false }),
  // Fila 0.145: corregir un movimiento sin factura.
  useCorregirMovimientoEsMa: () => ({ mutate: corregirMutate, isPending: false }),
  useSaldoMaquilero: () => ({ data: saldo, isPending: false, isError: false, error: null }),
  useMaquilerosEsMa: () => ({
    data: { filas: [{ id: 5, nombre: 'Maquila SA', corto: null }] },
    isPending: false,
    isError: false,
  }),
  imprimirEstadoCuenta: vi.fn(),
  descargarExcelEstadoCuenta: vi.fn(),
}));
vi.mock('@/api/wip', () => ({
  useExistenciaMaquilero: () => ({
    data: { filas: [], totalEnPoder: 0 },
    isPending: false,
    isError: false,
  }),
}));

describe('EstadoCuentaPagina (F6-E5)', () => {
  beforeEach(() => {
    revisarMutate.mockReset();
    mock.estado = { data: estadoConMovimientos, isPending: false, isError: false, error: null };
  });

  it('pide elegir un maquilero cuando no hay ninguno seleccionado', () => {
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
    });
    expect(
      screen.getByText(/Elige un maquilero para ver su estado de cuenta/i),
    ).toBeInTheDocument();
  });

  it('muestra los movimientos y su marca de pendiente al llegar con un maquilero (router state)', () => {
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'esma.revisar', 'consultas.ver-importes']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    const fila = screen.getByTestId('edc-fila');
    expect(fila).toHaveTextContent('Abono');
    expect(fila).toHaveTextContent('Anticipo');
    // Con esma.revisar y partida pendiente, aparece el botón de autorizar (vista móvil).
    expect(screen.getByTestId('edc-autorizar')).toBeInTheDocument();
  });

  it('V1-E8k · muestra las PRENDAS INCOMPLETAS entregadas, con su total, fuera de los movimientos', () => {
    // Es literalmente lo que Daniel pidió: *"sólo quisiera ver reflejado en algún lado que sí las
    // entrego, para revisar los temas de pago"*. Sin esta aserción, borrar la tarjeta entera dejaba
    // las 7 pruebas del archivo en verde.
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    const tarjeta = screen.getByTestId('edc-incompletas');
    expect(tarjeta).toHaveTextContent('Prendas incompletas entregadas');
    // El renglón trae la orden y el modelo, y el total dice las piezas.
    const fila = screen.getByTestId('edc-incompletas-fila');
    expect(fila).toHaveTextContent('#100');
    expect(fila).toHaveTextContent('A-100');
    expect(screen.getByTestId('edc-incompletas-total')).toHaveTextContent(
      'Total de prendas incompletas: 2',
    );
    // Y NO se colaron entre los movimientos (no son dinero): la tabla sigue con su único abono.
    expect(screen.getAllByTestId('edc-fila')).toHaveLength(1);
  });

  it('V1-E8k · sin incompletas, la tarjeta no se dibuja', () => {
    mock.estado = {
      data: { ...estadoConMovimientos, incompletas: { filas: [], totalPiezas: 0 } },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    expect(screen.queryByTestId('edc-incompletas')).not.toBeInTheDocument();
  });

  it('sin esma.revisar no ofrece autorizar la partida pendiente', () => {
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    expect(screen.getByTestId('edc-fila')).toBeInTheDocument();
    expect(screen.queryByTestId('edc-autorizar')).not.toBeInTheDocument();
  });

  /**
   * ⭐ FILA 0.128 — el botón «Autorizar» dejó de colgar de `esma.modificar`. Daniel
   * (§Post-F9.192(1)): *«es un permiso para meter lo recibido y otro para validarlo»*. La prueba
   * de arriba («sin esma.revisar…») no basta: pasaba también ANTES del cambio, porque esa sesión
   * tampoco traía `esma.modificar`. Lo que caza la regresión es el caso con el permiso de
   * CAPTURAR puesto y el de VALIDAR ausente.
   */
  it('⭐ con esma.modificar (capturar) pero SIN esma.revisar: captura, y NO autoriza', () => {
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'esma.modificar']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    // Capturar sigue siendo suyo: los botones de alta quedan habilitados…
    expect(screen.getByTestId('edc-agregar-abono')).toBeEnabled();
    expect(screen.getByTestId('edc-agregar-descuento')).toBeEnabled();
    // …pero el de autorizar NI SIQUIERA SE DIBUJA (no un botón que truena en el 403).
    expect(screen.queryByTestId('edc-autorizar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Autorizar/i })).not.toBeInTheDocument();
  });

  it('⭐ y al revés: con esma.revisar pero sin esma.modificar autoriza, y no captura', () => {
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'esma.revisar']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    expect(screen.getByTestId('edc-autorizar')).toBeInTheDocument();
    expect(screen.getByTestId('edc-agregar-abono')).toBeDisabled();
    expect(screen.getByTestId('edc-agregar-descuento')).toBeDisabled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐⭐ FILA 0.145 — CORREGIR DESDE LA PANTALLA DE MAQUILA
//
// La pantalla NO decide quién puede corregir ni qué: cada renglón llega con su `corregible` y su
// `importeCorregible` ya calculados por el servidor. Estas pruebas fijan que los OBEDECE — y que el
// cajón arranca del importe GUARDADO, que es lo que hacía falta para el caso más común (un
// movimiento capturado por error todavía no está revisado, así que su `monto` viaja vacío).
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('EstadoCuentaPagina · corregir un movimiento sin factura (fila 0.145)', () => {
  /** El mismo estado de cuenta, con el renglón de abono marcado como se pida. */
  function conRenglon(cambios: Record<string, unknown>): void {
    const fila = estadoConMovimientos.movimientos[0];
    if (fila === undefined) throw new Error('El fixture perdió su renglón.');
    mock.estado = {
      data: { ...estadoConMovimientos, movimientos: [{ ...fila, ...cambios }] },
      isPending: false,
      isError: false,
      error: null,
    };
  }

  beforeEach(() => {
    corregirMutate.mockClear();
  });

  it('🔴 un renglón NO corregible no ofrece el botón', () => {
    conRenglon({ corregible: false });
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    expect(screen.queryByTestId('edc-corregir')).not.toBeInTheDocument();
  });

  it('un renglón corregible abre el cajón con el importe GUARDADO, aunque no aporte al saldo', async () => {
    // `monto: null` = capturado y sin revisar (no aporta todavía). Es el caso más común de la fila,
    // y el importe TIENE que poder tocarse.
    conRenglon({
      corregible: true,
      importeCorregible: true,
      monto: null,
      importeGuardado: 500,
      observacionesGuardadas: 'flete',
    });
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    await usuario.click(screen.getByTestId('edc-corregir'));
    expect(screen.getByTestId('corregir-importe')).toBeEnabled();
    expect(screen.getByTestId('corregir-importe')).toHaveValue(500);
    expect(screen.getByTestId('corregir-obs')).toHaveValue('flete');
    expect(screen.queryByText(/No tienes permiso para ver importes/i)).not.toBeInTheDocument();
  });

  it('manda al servidor SÓLO lo que cambió, con el concepto del renglón', async () => {
    conRenglon({
      corregible: true,
      importeCorregible: true,
      monto: null,
      importeGuardado: 500,
      observacionesGuardadas: 'flete',
    });
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    await usuario.click(screen.getByTestId('edc-corregir'));
    await usuario.clear(screen.getByTestId('corregir-importe'));
    await usuario.type(screen.getByTestId('corregir-importe'), '120');
    await usuario.type(screen.getByTestId('corregir-motivo'), 'era el flete chico');
    await usuario.click(screen.getByTestId('corregir-guardar'));

    const [args] = corregirMutate.mock.calls[0] as [
      { concepto: string; id: number; cuerpo: Record<string, unknown> },
    ];
    expect(args.concepto).toBe('abono');
    expect(args.id).toBe(1);
    expect(args.cuerpo).toEqual({ importe: 120, motivo: 'era el flete chico' });
  });

  it('🔴 sin motivo no se manda nada: el rastro es obligatorio', async () => {
    conRenglon({ corregible: true, importeCorregible: true, importeGuardado: 500 });
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    await usuario.click(screen.getByTestId('edc-corregir'));
    await usuario.clear(screen.getByTestId('corregir-importe'));
    await usuario.type(screen.getByTestId('corregir-importe'), '250');
    await usuario.click(screen.getByTestId('corregir-guardar'));
    expect(corregirMutate).not.toHaveBeenCalled();
  });

  it('🔴 con `importeCorregible: false` el importe se bloquea y se explica por qué', async () => {
    conRenglon({ corregible: true, importeCorregible: false, importeGuardado: 500 });
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos', 'consultas.ver-importes']),
      rutaInicial: { pathname: '/esma/estado-cuenta', state: { idMaquilero: 5 } },
    });
    await usuario.click(screen.getByTestId('edc-corregir'));
    expect(screen.getByTestId('corregir-importe')).toBeDisabled();
    expect(screen.getByText(/está aplicado a cargos/i)).toBeInTheDocument();
  });
});
