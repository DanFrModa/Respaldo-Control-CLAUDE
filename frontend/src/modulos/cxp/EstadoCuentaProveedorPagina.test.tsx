import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CxpEstadoCuenta } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { EstadoCuentaProveedorPagina } from './EstadoCuentaProveedorPagina';

/** Estado mutable del hook mockeado. */
const estado: { valor: unknown } = { valor: null };

/** Las queries con las que la pantalla pidió el estado de cuenta (la última es la vigente). */
const consultas: { segmento?: string }[] = [];

const corregirMotorMutate = vi.fn();
const corregirEsMaMutate = vi.fn();

vi.mock('@/api/cxp', () => ({
  useEstadoCuentaProveedor: (_id: number | null, query: { segmento?: string }) => {
    consultas.push(query);
    return estado.valor;
  },
  useRegistrarMovimientoCxp: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarMovimientoCxp: () => ({ mutate: vi.fn(), isPending: false }),
  // Fila 0.145: corregir un movimiento sin factura.
  useCorregirMovimientoCxp: () => ({ mutate: corregirMotorMutate, isPending: false }),
  imprimirEstadoCuentaCxp: vi.fn(),
}));

// El estado de cuenta del proveedor mezcla las dos fuentes, así que la pantalla puede mandar la
// corrección al endpoint de EsMa: se mockea igual.
vi.mock('@/api/esma', () => ({
  useCorregirMovimientoEsMa: () => ({ mutate: corregirEsMaMutate, isPending: false }),
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
      idMovimientoCorregido: null,
      observacionesGuardadas: null,
      importeGuardado: 1000,
      corregible: false,
      importeCorregible: false,
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
    consultas.length = 0;
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

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐ FILA 0.132 — EL DETALLE ABRE EN LA MISMA RELACIÓN DE PAGO QUE LA BANDEJA
// Si se entra desde el listado "Sin factura" y el estado de cuenta abriera en "todo", se leería un
// saldo MAYOR que el que esa relación va a pagar — justo la confusión que partir la bandeja evita.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('EstadoCuentaProveedorPagina · segmento heredado de la bandeja', () => {
  beforeEach(() => {
    consultas.length = 0;
    estado.valor = { data: cuenta, isPending: false, isError: false, error: null };
  });

  it.each(['con', 'sin'] as const)('abre en el segmento «%s» que traía el enlace', (segmento) => {
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver']),
      rutaInicial: { pathname: '/cxp/estado-cuenta', state: { idProveedor: 7, segmento } },
    });
    expect(consultas.at(-1)?.segmento).toBe(segmento);
    expect(screen.getByTestId('cxp-edc-segmento')).toHaveValue(segmento);
  });

  it('sin segmento en el enlace sigue abriendo en la cuenta completa', () => {
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver']),
      rutaInicial: conProveedor,
    });
    expect(consultas.at(-1)?.segmento).toBe('todos');
  });

  it('un segmento inventado en el `state` no viaja al API', () => {
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver']),
      rutaInicial: {
        pathname: '/cxp/estado-cuenta',
        state: { idProveedor: 7, segmento: 'fiscal' },
      },
    });
    expect(consultas.at(-1)?.segmento).toBe('todos');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐⭐ FILA 0.145 — CORREGIR UN MOVIMIENTO SIN FACTURA
// La pantalla NO decide quién puede corregir ni qué: cada renglón llega del servidor con su
// `corregible` (bandera de la persona + sin factura + vivo + …) y su `importeCorregible`. Estas
// pruebas fijan que la pantalla OBEDECE esas dos banderas y no reinventa la regla — que es
// exactamente la forma en que se acaba ofreciendo un botón que el servidor rechaza.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('EstadoCuentaProveedorPagina · corregir un movimiento sin factura', () => {
  /** El mismo estado de cuenta, con el renglón marcado como corregible o no. */
  function conRenglon(cambios: Partial<CxpEstadoCuenta['movimientos'][number]>): void {
    const fila = cuenta.movimientos[0];
    if (fila === undefined) {
      throw new Error('El fixture perdió su renglón.');
    }
    estado.valor = {
      data: { ...cuenta, movimientos: [{ ...fila, ...cambios }] },
      isPending: false,
      isError: false,
      error: null,
    };
  }

  beforeEach(() => {
    consultas.length = 0;
    corregirMotorMutate.mockClear();
    corregirEsMaMutate.mockClear();
  });

  it('🔴 un renglón NO corregible no ofrece el botón', () => {
    conRenglon({ corregible: false });
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'cxp.administrar', 'consultas.ver-importes']),
      rutaInicial: conProveedor,
    });
    expect(screen.queryByTestId('cxp-edc-corregir')).not.toBeInTheDocument();
  });

  it('un renglón corregible lo ofrece, y abre el cajón con los valores del movimiento', async () => {
    conRenglon({ corregible: true, importeCorregible: true, observacionesGuardadas: 'sem 35' });
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'cxp.administrar', 'consultas.ver-importes']),
      rutaInicial: conProveedor,
    });
    await usuario.click(screen.getByTestId('cxp-edc-corregir'));

    // Arranca con lo que el renglón ya dice: por eso se siente una edición y no una captura nueva.
    expect(screen.getByTestId('corregir-importe')).toHaveValue(1000);
    expect(screen.getByTestId('corregir-fecha')).toHaveValue('2026-07-01');
    // ⭐ Las observaciones salen del texto GUARDADO, no del que pinta la columna.
    expect(screen.getByTestId('corregir-obs')).toHaveValue('sem 35');
  });

  it('🔴 sin motivo no se manda nada: el rastro es obligatorio', async () => {
    conRenglon({ corregible: true, importeCorregible: true });
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'cxp.administrar', 'consultas.ver-importes']),
      rutaInicial: conProveedor,
    });
    await usuario.click(screen.getByTestId('cxp-edc-corregir'));
    await usuario.clear(screen.getByTestId('corregir-importe'));
    await usuario.type(screen.getByTestId('corregir-importe'), '250');
    await usuario.click(screen.getByTestId('corregir-guardar'));
    expect(corregirMotorMutate).not.toHaveBeenCalled();
  });

  it('manda SÓLO lo que cambió, al endpoint del MOTOR cuando el renglón es del motor', async () => {
    conRenglon({ corregible: true, importeCorregible: true, observacionesGuardadas: 'sem 35' });
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'cxp.administrar', 'consultas.ver-importes']),
      rutaInicial: conProveedor,
    });
    await usuario.click(screen.getByTestId('cxp-edc-corregir'));
    await usuario.clear(screen.getByTestId('corregir-importe'));
    await usuario.type(screen.getByTestId('corregir-importe'), '250');
    await usuario.type(screen.getByTestId('corregir-motivo'), 'se tecleó de más');
    await usuario.click(screen.getByTestId('corregir-guardar'));

    expect(corregirEsMaMutate).not.toHaveBeenCalled();
    const [args] = corregirMotorMutate.mock.calls[0] as [
      { idMovimiento: number; cuerpo: Record<string, unknown> },
    ];
    expect(args.idMovimiento).toBe(11);
    // La fecha y las observaciones NO viajan: no se tocaron.
    expect(args.cuerpo).toEqual({ importe: 250, motivo: 'se tecleó de más' });
  });

  it('⭐ un renglón de EsMa va al endpoint de EsMa, con su concepto', async () => {
    conRenglon({
      fuente: 'esma',
      origen: 'abono',
      id: 42,
      corregible: true,
      importeCorregible: true,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'cxp.administrar', 'consultas.ver-importes']),
      rutaInicial: conProveedor,
    });
    await usuario.click(screen.getByTestId('cxp-edc-corregir'));
    await usuario.clear(screen.getByTestId('corregir-importe'));
    await usuario.type(screen.getByTestId('corregir-importe'), '120');
    await usuario.type(screen.getByTestId('corregir-motivo'), 'era el flete chico');
    await usuario.click(screen.getByTestId('corregir-guardar'));

    expect(corregirMotorMutate).not.toHaveBeenCalled();
    const [args] = corregirEsMaMutate.mock.calls[0] as [
      { concepto: string; id: number; cuerpo: Record<string, unknown> },
    ];
    expect(args.concepto).toBe('abono');
    expect(args.id).toBe(42);
    expect(args.cuerpo).toEqual({ importe: 120, motivo: 'era el flete chico' });
  });

  it('🔴 con `importeCorregible: false` el importe queda bloqueado y se explica por qué', async () => {
    conRenglon({ corregible: true, importeCorregible: false });
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'cxp.administrar', 'consultas.ver-importes']),
      rutaInicial: conProveedor,
    });
    await usuario.click(screen.getByTestId('cxp-edc-corregir'));
    expect(screen.getByTestId('corregir-importe')).toBeDisabled();
    expect(screen.getByText(/está aplicado a cargos/i)).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 REGRESIÓN (reviewer de la 0.145) — EL CASO CENTRAL DE LA FILA NO SE PODÍA CORREGIR
//
// Un movimiento «capturado por error» es, por definición, uno que **aún no se revisó**. Para ésos la
// convivencia con EsMa vacía el `monto` (no aportan al saldo todavía) y el cajón arrancaba de ahí:
// deshabilitaba el importe y lo explicaba con un mensaje sobre PERMISOS que era falso. Ahora el
// cajón arranca de `importeGuardado`, que el servidor manda ya normalizado (positivo, y vacío sólo
// por permiso en un renglón corregible). ⚠️ Estas pruebas usan un fixture ESCRITO A MANO, así que no
// pueden afirmar nada del servidor: que el dato salga bien de ahí —incluidos los movimientos
// migrados, guardados en negativo— lo prueba `correccion-sin-factura.int.test.ts`.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('EstadoCuentaProveedorPagina · corregir un renglón SIN REVISAR (monto vacío)', () => {
  beforeEach(() => {
    consultas.length = 0;
    corregirMotorMutate.mockClear();
    corregirEsMaMutate.mockClear();
    const fila = cuenta.movimientos[0];
    if (fila === undefined) throw new Error('El fixture perdió su renglón.');
    estado.valor = {
      data: {
        ...cuenta,
        movimientos: [
          {
            ...fila,
            fuente: 'esma',
            origen: 'abono',
            id: 42,
            // Así llega un renglón EsMa capturado y sin revisar: sin monto, pero con su importe.
            monto: null,
            importeGuardado: 500,
            observaciones: ' (pendiente de revisión)',
            observacionesGuardadas: null,
            corregible: true,
            importeCorregible: true,
          },
        ],
      },
      isPending: false,
      isError: false,
      error: null,
    };
  });

  it('🔴 el importe se puede tocar, y NO se dice nada falso sobre los permisos', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'cxp.administrar', 'consultas.ver-importes']),
      rutaInicial: conProveedor,
    });
    await usuario.click(screen.getByTestId('cxp-edc-corregir'));
    expect(screen.getByTestId('corregir-importe')).toBeEnabled();
    expect(screen.getByTestId('corregir-importe')).toHaveValue(500);
    expect(screen.queryByText(/No tienes permiso para ver importes/i)).not.toBeInTheDocument();
  });

  it('y el importe corregido llega al servidor', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'cxp.administrar', 'consultas.ver-importes']),
      rutaInicial: conProveedor,
    });
    await usuario.click(screen.getByTestId('cxp-edc-corregir'));
    await usuario.clear(screen.getByTestId('corregir-importe'));
    await usuario.type(screen.getByTestId('corregir-importe'), '120');
    await usuario.type(screen.getByTestId('corregir-motivo'), 'era el flete chico');
    await usuario.click(screen.getByTestId('corregir-guardar'));

    const [args] = corregirEsMaMutate.mock.calls[0] as [{ cuerpo: Record<string, unknown> }];
    expect(args.cuerpo).toEqual({ importe: 120, motivo: 'era el flete chico' });
  });

  it('sin `consultas.ver-importes` sí se dice —y ahí es verdad—', async () => {
    // Mismo renglón, pero el servidor ya vació el importe porque quien mira no puede verlo.
    const previo = estado.valor as { data: { movimientos: Record<string, unknown>[] } };
    const fila = previo.data.movimientos[0];
    estado.valor = {
      ...previo,
      data: { ...previo.data, movimientos: [{ ...fila, importeGuardado: null }] },
    };
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'cxp.administrar']),
      rutaInicial: conProveedor,
    });
    await usuario.click(screen.getByTestId('cxp-edc-corregir'));
    expect(screen.getByTestId('corregir-importe')).toBeDisabled();
    expect(screen.getByText(/No tienes permiso para ver importes/i)).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 EL GEMELO DEL NEGATIVO: UN RENGLÓN MIGRADO CON IMPORTE **0**
//
// El ETL de EsMa carga un monto vacío como **0** (`migracion/loaders/esma-cargos.ts:545`,
// `parsearDinero(...) ?? 0`), y esos movimientos llegan con `conFactura = null`, que cuenta como SIN
// factura ⇒ son CORREGIBLES. El cajón validaba el importe SIEMPRE, así que sobre ellos guardar
// cortaba con «Captura un importe mayor a 0» **aunque sólo se hubiera tocado la fecha** — el mismo
// defecto que el del monto negativo, y uno que `Math.abs` no puede curar porque |0| sigue siendo 0.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('EstadoCuentaProveedorPagina · corregir un renglón migrado con importe 0', () => {
  beforeEach(() => {
    consultas.length = 0;
    corregirMotorMutate.mockClear();
    corregirEsMaMutate.mockClear();
    const fila = cuenta.movimientos[0];
    if (fila === undefined) throw new Error('El fixture perdió su renglón.');
    estado.valor = {
      data: {
        ...cuenta,
        movimientos: [
          {
            ...fila,
            fuente: 'esma',
            origen: 'abono',
            id: 77,
            monto: 0,
            importeGuardado: 0,
            observaciones: 'saldo anterior',
            observacionesGuardadas: 'saldo anterior',
            corregible: true,
            importeCorregible: true,
          },
        ],
      },
      isPending: false,
      isError: false,
      error: null,
    };
  });

  it('🔴 corregir SÓLO LA FECHA funciona: el importe intacto no se valida', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'cxp.administrar', 'consultas.ver-importes']),
      rutaInicial: conProveedor,
    });
    await usuario.click(screen.getByTestId('cxp-edc-corregir'));
    expect(screen.getByTestId('corregir-importe')).toHaveValue(0);
    await usuario.clear(screen.getByTestId('corregir-fecha'));
    await usuario.type(screen.getByTestId('corregir-fecha'), '2026-09-08');
    await usuario.type(screen.getByTestId('corregir-motivo'), 'era de otra semana');
    await usuario.click(screen.getByTestId('corregir-guardar'));

    const [args] = corregirEsMaMutate.mock.calls[0] as [{ cuerpo: Record<string, unknown> }];
    // El importe NO viaja (no se tocó) y la fecha sí: exactamente lo que se pidió corregir.
    expect(args.cuerpo).toEqual({ fecha: '2026-09-08', motivo: 'era de otra semana' });
  });

  it('pero proponer un importe que NO sirve sí se corta, y ahí el mensaje es verdad', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'cxp.administrar', 'consultas.ver-importes']),
      rutaInicial: conProveedor,
    });
    await usuario.click(screen.getByTestId('cxp-edc-corregir'));
    await usuario.clear(screen.getByTestId('corregir-importe'));
    await usuario.type(screen.getByTestId('corregir-importe'), '-5');
    await usuario.type(screen.getByTestId('corregir-motivo'), 'a ver');
    await usuario.click(screen.getByTestId('corregir-guardar'));
    expect(corregirEsMaMutate).not.toHaveBeenCalled();
  });

  it('y el importe corregido a uno bueno sí viaja', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EstadoCuentaProveedorPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'cxp.administrar', 'consultas.ver-importes']),
      rutaInicial: conProveedor,
    });
    await usuario.click(screen.getByTestId('cxp-edc-corregir'));
    await usuario.clear(screen.getByTestId('corregir-importe'));
    await usuario.type(screen.getByTestId('corregir-importe'), '340');
    await usuario.type(screen.getByTestId('corregir-motivo'), 'sí tenía importe');
    await usuario.click(screen.getByTestId('corregir-guardar'));

    const [args] = corregirEsMaMutate.mock.calls[0] as [{ cuerpo: Record<string, unknown> }];
    expect(args.cuerpo).toEqual({ importe: 340, motivo: 'sí tenía importe' });
  });
});
