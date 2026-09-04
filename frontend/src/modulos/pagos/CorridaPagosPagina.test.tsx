import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClavePermiso, CorridaDetalle, CorridasLista } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CorridaPagosPagina } from './CorridaPagosPagina';

/**
 * LA PANTALLA DE LA CORRIDA (fila 0.113), medida donde importa:
 *
 *  • las secciones por RUBRO se pintan con sus columnas de referencia (maquileros llevan lo
 *    recibido en la semana; los conceptos no llevan referencia ninguna);
 *  • ⭐ la referencia NUNCA llena el campo de captura (§Post-F9.189(b));
 *  • ⭐ los bloqueos de la guarda fiscal salen CON EL NOMBRE y desactivan «cerrar»;
 *  • un pago PARTIDO se ve como DOS renglones, no como uno sumado;
 *  • sin `pagos.corrida-armar` la pantalla es de sólo lectura.
 */

/** Estado mutable de los hooks mockeados (objetos estables para el factory de vi.mock). */
const estado: { lista: unknown; detalle: unknown; concentrado: unknown } = {
  lista: null,
  detalle: null,
  concentrado: null,
};
const ejecutado = { ids: [] as unknown[] };
const guardado = { llamadas: [] as unknown[] };

vi.mock('@/api/pagos', () => ({
  useCorridas: () => estado.lista,
  useCorrida: () => estado.detalle,
  useConceptosPago: () => ({ data: { datos: [] }, isPending: false, isError: false }),
  useCrearCorrida: () => ({ mutate: vi.fn(), isPending: false }),
  useGuardarRenglon: () => ({
    mutate: (args: unknown) => guardado.llamadas.push(args),
    isPending: false,
  }),
  useEliminarRenglon: () => ({ mutate: vi.fn(), isPending: false }),
  useCerrarCorrida: () => ({ mutate: vi.fn(), isPending: false }),
  useEjecutarCorrida: () => ({ mutate: (id: unknown) => ejecutado.ids.push(id), isPending: false }),
  useConcentrado: () => estado.concentrado,
}));

const TOTALES_CERO = { efectivo: 0, transferencia: 0, total: 0, renglones: 0 };

const CORRIDA = {
  id: 7,
  folio: 12,
  semana: '2026-08-31',
  conFactura: false,
  estado: 'borrador' as const,
  notas: null,
  cerradaEn: null,
  ejecutadaEn: null,
  totales: TOTALES_CERO,
};

const lista: CorridasLista = {
  filas: [CORRIDA],
  total: 1,
  pagina: 1,
  porPagina: 20,
  totalPaginas: 1,
};

/** Una fila de maquilero SIN capturar: saldo y recibos de referencia, campo vacío. */
const filaMaquilero = {
  origen: 'maquila' as const,
  idProveedor: 5,
  idConcepto: null,
  rubro: 'maquila' as const,
  nombre: 'TALLER NORTE',
  nombreCorto: 'TN',
  formaPagoSugerida: 'efectivo' as const,
  idCuentaSugerida: null,
  cuentas: [],
  puedeConFactura: false,
  saldo: 12_345,
  vencido: null,
  porRevisarNeto: 500,
  porRevisarPartidas: 2,
  recibosSemanaImporte: 9_000,
  recibosSemanaCantidad: 300,
  renglones: [],
  totalCapturado: 0,
};

const detalle: CorridaDetalle = {
  corrida: CORRIDA,
  secciones: [
    { rubro: 'maquila', filas: [filaMaquilero], totales: TOTALES_CERO },
    {
      rubro: 'caja_chica',
      filas: [
        {
          origen: 'concepto',
          idProveedor: null,
          idConcepto: 3,
          rubro: 'caja_chica',
          nombre: 'Caja chica',
          nombreCorto: null,
          formaPagoSugerida: 'efectivo',
          idCuentaSugerida: null,
          cuentas: [],
          puedeConFactura: false,
          saldo: null,
          vencido: null,
          porRevisarNeto: null,
          porRevisarPartidas: 0,
          recibosSemanaImporte: null,
          recibosSemanaCantidad: 0,
          renglones: [
            {
              id: 41,
              origen: 'concepto',
              idProveedor: null,
              idConcepto: 3,
              rubro: 'caja_chica',
              nombre: 'Caja chica',
              monto: 0,
              formaPago: 'efectivo',
              idCuenta: null,
              beneficiario: 'Caja chica',
              banco: null,
              tipoCuenta: null,
              ultimos4: null,
              aliasCuenta: null,
              cuentaEsFiscal: null,
              concepto: 'Caja chica de la semana',
              referencia: null,
              idPagoMaquilero: null,
              idMovimientoTercero: null,
            },
          ],
          totalCapturado: 0,
        },
      ],
      totales: TOTALES_CERO,
    },
  ],
  bloqueos: [],
};

/** La relación ejecutable tal como la manda el servidor (sólo lo que lleva monto). */
const CONCENTRADO = {
  corrida: { ...CORRIDA, estado: 'cerrada' as const },
  secciones: [
    {
      rubro: 'maquila' as const,
      renglones: [
        {
          rubro: 'maquila' as const,
          nombre: 'TALLER NORTE',
          beneficiario: 'Fulana de Tal',
          banco: 'BBVA',
          tipoCuenta: 'clabe' as const,
          // Sintética a propósito (repo público, fila 0.123).
          cuenta: '002010055555555551',
          aliasCuenta: '1',
          formaPago: 'transferencia' as const,
          monto: 30_000,
          concepto: 'Maquila semana 36',
          referencia: '7909 y 7888',
        },
      ],
      totales: { efectivo: 0, transferencia: 30_000, total: 30_000, renglones: 1 },
    },
  ],
  totales: { efectivo: 0, transferencia: 30_000, total: 30_000, renglones: 1 },
};

// El default es lo realista: quien arma la corrida decide montos, o sea ve dinero.
function pintar(
  permisos: ClavePermiso[] = ['pagos.corrida-ver', 'pagos.corrida-armar', 'consultas.ver-importes'],
): void {
  renderConProveedores(<CorridaPagosPagina />, { sesion: estadoSesionDePrueba(permisos) });
}

beforeEach(() => {
  guardado.llamadas = [];
  ejecutado.ids = [];
  estado.concentrado = { data: CONCENTRADO, isPending: false, isError: false };
  estado.lista = { data: lista, isPending: false, isError: false };
  estado.detalle = { data: detalle, isPending: false, isError: false };
});

describe('la pantalla de trabajo', () => {
  it('pinta UNA sección por rubro (maquileros y conceptos en la misma pantalla)', () => {
    pintar();
    expect(screen.getByTestId('corrida-seccion-maquila')).toBeInTheDocument();
    expect(screen.getByTestId('corrida-seccion-caja_chica')).toBeInTheDocument();
    expect(screen.getByText('Maquileros')).toBeInTheDocument();
    expect(screen.getByText('Caja chica', { selector: 'h2' })).toBeInTheDocument();
  });

  it('⭐ la REFERENCIA se ve al lado, y el campo de captura arranca VACÍO', () => {
    pintar();
    const seccion = screen.getByTestId('corrida-seccion-maquila');
    // El saldo y lo recibido en la semana están a la vista…
    expect(within(seccion).getByText(/12,345/)).toBeInTheDocument();
    expect(within(seccion).getByText(/recibió 300 pzas/)).toBeInTheDocument();
    expect(within(seccion).getByText(/por revisar/)).toBeInTheDocument();
    // …y el campo NO los toma: el monto lo decide Daniel (§Post-F9.189(b)).
    const campo = within(seccion).getByLabelText('A pagar a TALLER NORTE');
    expect(campo).toHaveValue(null);
  });

  it('un concepto no lleva referencia: nace en cero', () => {
    pintar();
    const seccion = screen.getByTestId('corrida-seccion-caja_chica');
    expect(within(seccion).queryByText(/por revisar/)).not.toBeInTheDocument();
    expect(within(seccion).getByLabelText('A pagar a Caja chica')).toHaveValue(0);
  });

  it('teclear un monto y salir del campo lo GUARDA (una llamada, no una por tecla)', async () => {
    const usuario = userEvent.setup();
    pintar();
    const campo = screen.getByLabelText('A pagar a TALLER NORTE');
    await usuario.type(campo, '7500');
    expect(guardado.llamadas).toHaveLength(0); // todavía nada: se guarda al salir
    await usuario.tab();
    expect(guardado.llamadas).toHaveLength(1);
    expect(guardado.llamadas[0]).toMatchObject({
      idCorrida: 7,
      cuerpo: { idProveedor: 5, monto: 7500, formaPago: 'efectivo' },
    });
    // ⭐ Y el `origen` NO viaja: lo deriva el servidor del beneficiario y sus roles. Mandarlo desde
    // el cliente era el agujero B1 — decide en qué libro nace el pago (EsMa vs CxP), así que un
    // cuerpo cruzado metía el dinero en el libro equivocado.
    expect((guardado.llamadas[0] as { cuerpo: Record<string, unknown> }).cuerpo).not.toHaveProperty(
      'origen',
    );
  });
});

describe('⭐ el CONCEPTO (la explicación del pago)', () => {
  it('se captura en la relación y viaja al guardar', async () => {
    // Sale de LEER el archivo real de finanzas: su columna «Concepto» es lo que le dice a quien
    // ejecuta la transferencia QUÉ está pagando. Sin ella el pago no se puede ejecutar.
    const usuario = userEvent.setup();
    pintar();
    const campo = screen.getByLabelText('Concepto del pago a TALLER NORTE');
    await usuario.type(campo, 'Maquila semana 36');
    await usuario.tab();
    expect(guardado.llamadas[0]).toMatchObject({
      cuerpo: { concepto: 'Maquila semana 36' },
    });
  });

  it('en un renglón ya capturado se ve lo que dice', () => {
    pintar();
    const seccion = screen.getByTestId('corrida-seccion-caja_chica');
    expect(within(seccion).getByLabelText('Concepto del pago a Caja chica')).toHaveValue(
      'Caja chica de la semana',
    );
  });
});

describe('⭐ la guarda fiscal', () => {
  it('los bloqueos salen CON EL NOMBRE y no dejan cerrar', () => {
    estado.detalle = {
      data: {
        ...detalle,
        bloqueos: [{ nombre: 'TALLER NORTE', motivo: 'No tiene cuenta fiscal capturada.' }],
      },
      isPending: false,
      isError: false,
    };
    pintar();
    const aviso = screen.getByTestId('corrida-bloqueos');
    expect(within(aviso).getByText('TALLER NORTE')).toBeInTheDocument();
    expect(screen.getByTestId('corrida-cerrar')).toBeDisabled();
  });

  it('sin bloqueos, cerrar está disponible', () => {
    pintar();
    expect(screen.getByTestId('corrida-cerrar')).toBeEnabled();
  });
});

describe('un pago PARTIDO', () => {
  it('⭐ sale como DOS renglones, no como uno sumado', () => {
    const conDos = {
      ...filaMaquilero,
      renglones: [30_000, 20_000].map((monto, i) => ({
        id: 100 + i,
        origen: 'maquila' as const,
        idProveedor: 5,
        idConcepto: null,
        rubro: 'maquila' as const,
        nombre: 'TALLER NORTE',
        monto,
        formaPago: 'transferencia' as const,
        idCuenta: 900 + i,
        beneficiario: `Beneficiario ${String(i + 1)}`,
        banco: 'BBVA',
        tipoCuenta: 'clabe' as const,
        ultimos4: `000${String(i + 1)}`,
        aliasCuenta: String(i + 1),
        cuentaEsFiscal: false,
        concepto: null,
        referencia: null,
        idPagoMaquilero: null,
        idMovimientoTercero: null,
      })),
      totalCapturado: 50_000,
    };
    estado.detalle = {
      data: {
        ...detalle,
        secciones: [{ rubro: 'maquila', filas: [conDos], totales: TOTALES_CERO }],
      },
      isPending: false,
      isError: false,
    };
    pintar();
    const seccion = screen.getByTestId('corrida-seccion-maquila');
    expect(within(seccion).getAllByTestId('corrida-renglon')).toHaveLength(2);
    expect(within(seccion).getByText(/cuenta 1/)).toBeInTheDocument();
    expect(within(seccion).getByText(/cuenta 2/)).toBeInTheDocument();
  });
});

describe('⭐ una corrida SIN filas se explica (no se queda en blanco)', () => {
  /** Deja el detalle sin ninguna sección (lo que devuelve el servidor en una base sin movimientos). */
  function sinSecciones(estadoCorrida: 'borrador' | 'cerrada' = 'borrador'): void {
    estado.detalle = {
      data: {
        ...detalle,
        corrida: { ...CORRIDA, estado: estadoCorrida },
        secciones: [],
      },
      isPending: false,
      isError: false,
    };
  }

  it('⭐ a quien SÍ puede agregar, la invita a hacerlo', () => {
    sinSecciones();
    pintar();
    expect(screen.getByTestId('corrida-sin-filas')).toHaveTextContent(/Agrega uno del catálogo/i);
  });

  it('⭐ a quien NO puede, sólo le explica el porqué (no la manda a un botón que no tiene)', () => {
    // `AgregarConcepto` se pinta con `editable` (borrador + `pagos.corrida-armar`). Sin ese permiso
    // la invitación sería un callejón sin salida.
    sinSecciones();
    pintar(['pagos.corrida-ver', 'consultas.ver-importes']);
    const aviso = screen.getByTestId('corrida-sin-filas');
    expect(aviso).toHaveTextContent(/no tiene renglones/i);
    expect(aviso).not.toHaveTextContent(/Agrega uno del catálogo/i);
  });

  it('⭐ tampoco la invita si la corrida ya está CERRADA (aunque pueda armar)', () => {
    // Cerrada no se edita (D3): el botón de agregar tampoco está.
    sinSecciones('cerrada');
    pintar();
    expect(screen.getByTestId('corrida-sin-filas')).not.toHaveTextContent(
      /Agrega uno del catálogo/i,
    );
  });

  it('con cero secciones dice por qué está vacía', () => {
    // 🔴 Lo destapó el CI: en su base recién sembrada no hay movimientos (ni EsMa ni CxP) ni
    // conceptos predeterminados, así que el servidor devuelve CERO secciones. La pantalla pintaba
    // la nada debajo del encabezado y se leía como rota — y el e2e se quedó esperando una sección
    // que en ese ambiente no podía existir.
    estado.detalle = {
      data: { ...detalle, secciones: [] },
      isPending: false,
      isError: false,
    };
    pintar();
    expect(screen.getByTestId('corrida-sin-filas')).toHaveTextContent(
      /Todavía no hay a quién pagarle esta semana/i,
    );
  });

  it('con secciones NO aparece el aviso de vacío', () => {
    pintar();
    expect(screen.queryByTestId('corrida-sin-filas')).not.toBeInTheDocument();
    expect(screen.getByTestId('corrida-seccion-maquila')).toBeInTheDocument();
  });
});

describe('⭐ la RELACIÓN EJECUTABLE (B5)', () => {
  /** Deja la corrida en `cerrada`, que es cuando finanzas la recibe. */
  function conCorridaCerrada(): void {
    estado.detalle = {
      data: { ...detalle, corrida: { ...CORRIDA, estado: 'cerrada' as const } },
      isPending: false,
      isError: false,
    };
  }

  it('en BORRADOR no se ofrece: todavía no es lo que finanzas recibe', () => {
    pintar();
    expect(screen.queryByTestId('corrida-ver-relacion')).not.toBeInTheDocument();
  });

  it('⭐ sin `consultas.ver-importes` el botón NO se ofrece (el servidor lo negaría)', () => {
    // Ofrecerlo y que termine en un 403 es peor que no ofrecerlo: la relación ejecutable es la
    // lista de montos y cuentas, y sin poder ver dinero no hay nada que enseñar ahí.
    conCorridaCerrada();
    pintar(['pagos.corrida-ver']);
    expect(screen.queryByTestId('corrida-ver-relacion')).not.toBeInTheDocument();
  });

  it('⭐ con la corrida cerrada hay botón, y quien SÓLO puede ver también lo tiene', () => {
    // Es el defecto que esta vista corrige: sin botón, quien tiene `pagos.corrida-ver` no podía
    // llegar al único sitio con el número de cuenta completo, o sea no podía transferir.
    conCorridaCerrada();
    pintar(['pagos.corrida-ver', 'consultas.ver-importes']);
    expect(screen.getByTestId('corrida-ver-relacion')).toBeInTheDocument();
  });

  it('⭐ al abrirla enseña la CUENTA COMPLETA, el concepto y los folios', async () => {
    const usuario = userEvent.setup();
    conCorridaCerrada();
    pintar();
    await usuario.click(screen.getByTestId('corrida-ver-relacion'));
    const relacion = screen.getByTestId('relacion-ejecutable');
    // El número entero (con separadores), no los últimos 4: es de donde se copia al banco.
    expect(within(relacion).getByText(/0020 1005 5555 5555 51/)).toBeInTheDocument();
    expect(within(relacion).getByText('Maquila semana 36')).toBeInTheDocument();
    expect(within(relacion).getByText('7909 y 7888')).toBeInTheDocument();
    expect(within(relacion).getByText('Fulana de Tal')).toBeInTheDocument();
    expect(within(relacion).getByTestId('relacion-gran-total')).toHaveTextContent('$30,000.00');
  });
});

describe('⭐ «marcar como pagada» pide confirmación (R3)', () => {
  function conCorridaCerrada(): void {
    estado.detalle = {
      data: { ...detalle, corrida: { ...CORRIDA, estado: 'cerrada' as const } },
      isPending: false,
      isError: false,
    };
  }

  it('el botón NO ejecuta de una: abre la confirmación con las cifras', async () => {
    const usuario = userEvent.setup();
    conCorridaCerrada();
    pintar();
    await usuario.click(screen.getByTestId('corrida-ejecutar'));
    expect(ejecutado.ids).toHaveLength(0); // todavía nada: ejecutar no tiene marcha atrás
    const dialogo = screen.getByTestId('corrida-confirmar-ejecutar');
    expect(dialogo).toHaveTextContent('no se puede deshacer');
  });

  it('cancelar NO ejecuta', async () => {
    const usuario = userEvent.setup();
    conCorridaCerrada();
    pintar();
    await usuario.click(screen.getByTestId('corrida-ejecutar'));
    await usuario.click(screen.getByTestId('corrida-confirmar-no'));
    expect(ejecutado.ids).toHaveLength(0);
    expect(screen.queryByTestId('corrida-confirmar-ejecutar')).not.toBeInTheDocument();
  });

  it('confirmar sí ejecuta', async () => {
    const usuario = userEvent.setup();
    conCorridaCerrada();
    pintar();
    await usuario.click(screen.getByTestId('corrida-ejecutar'));
    await usuario.click(screen.getByTestId('corrida-confirmar-si'));
    expect(ejecutado.ids).toEqual([7]);
  });
});

describe('los permisos', () => {
  it('sin `corrida-armar` no hay campo de captura ni botones de cierre', () => {
    pintar(['pagos.corrida-ver']);
    expect(screen.queryByLabelText('A pagar a TALLER NORTE')).not.toBeInTheDocument();
    expect(screen.queryByTestId('corrida-cerrar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('corrida-abrir')).not.toBeInTheDocument();
    // Pero la relación SÍ se ve: es lo que finanzas necesita.
    expect(screen.getByTestId('corrida-seccion-maquila')).toBeInTheDocument();
  });

  it('una corrida CERRADA ya no se edita (D3), aunque se tenga el permiso', () => {
    estado.detalle = {
      data: { ...detalle, corrida: { ...CORRIDA, estado: 'cerrada' as const } },
      isPending: false,
      isError: false,
    };
    pintar();
    expect(screen.queryByLabelText('A pagar a TALLER NORTE')).not.toBeInTheDocument();
    expect(screen.queryByTestId('corrida-cerrar')).not.toBeInTheDocument();
    expect(screen.getByTestId('corrida-ejecutar')).toBeInTheDocument();
  });
});
