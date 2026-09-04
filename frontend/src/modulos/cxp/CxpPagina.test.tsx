import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReactRouterDom from 'react-router-dom';

import type { CxpBandeja, CxpBandejaQuery } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CxpPagina } from './CxpPagina';

/** Estado mutable del hook mockeado (objeto estable para el factory de vi.mock). */
const estado: { valor: unknown } = { valor: null };

/** Las QUERIES con las que la pantalla pidió la bandeja, en orden (la última es la vigente). */
const consultas: CxpBandejaQuery[] = [];

vi.mock('@/api/cxp', () => ({
  useBandejaPorPagar: (query: CxpBandejaQuery) => {
    consultas.push(query);
    return estado.valor;
  },
}));

/** Adónde navegó la pantalla, con el `state` que llevaba (el segmento viaja ahí). */
const navegar = vi.fn();

vi.mock('react-router-dom', async (importarOriginal) => ({
  ...(await importarOriginal<typeof ReactRouterDom>()),
  useNavigate: () => navegar,
}));

/** La última query que la pantalla mandó al servidor. */
function ultimaConsulta(): CxpBandejaQuery {
  const ultima = consultas.at(-1);
  if (ultima === undefined) {
    throw new Error('La pantalla no consultó la bandeja ni una vez.');
  }
  return ultima;
}

/** Nada capturado sin revisar (lo normal). */
const sinPorRevisar = { abonos: 0, pagos: 0, descuentos: 0, neto: 0, partidas: 0 };

const conCartera: CxpBandeja = {
  filas: [
    {
      idProveedor: 7,
      proveedor: 'Hilaturas del Norte',
      nombreCorto: 'HDN',
      diasCredito: 30,
      saldo: 88000,
      corriente: 40400,
      d1a30: 47600,
      d31a60: 0,
      mas60: 0,
      maquila: 0,
      maquilaPorRevisar: sinPorRevisar,
    },
    // Maquilero con SOLO deuda EsMa (0 en el motor): su saldo vive en la cubeta "Maquila".
    {
      idProveedor: 9,
      proveedor: 'Maquilas del Sur',
      nombreCorto: 'MDS',
      diasCredito: 0,
      saldo: 15000,
      corriente: 0,
      d1a30: 0,
      d31a60: 0,
      mas60: 0,
      maquila: 15000,
      maquilaPorRevisar: sinPorRevisar,
    },
  ],
  total: 2,
  pagina: 1,
  porPagina: 20,
  totalPaginas: 1,
  // carteraMotor = 103000 − 15000 = 88000; % = (88000 − 47600) / 88000 = 46 (la maquila NO cuenta).
  resumen: {
    carteraTotal: 103000,
    vencido: 47600,
    maquilaTotal: 15000,
    alCorrientePct: 46,
    proveedoresConSaldo: 2,
    maquilaPorRevisar: sinPorRevisar,
  },
  segmento: 'todos',
  limitesAging: { limite1: 30, limite2: 60 },
};

describe('CxpPagina (F9-E2)', () => {
  beforeEach(() => {
    consultas.length = 0;
    estado.valor = { data: conCartera, isPending: false, isError: false, error: null };
  });

  it('muestra el estado de carga', () => {
    estado.valor = { data: undefined, isPending: true, isError: false, error: null };
    renderConProveedores(<CxpPagina />, { sesion: estadoSesionDePrueba(['cxp.ver']) });
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
  });

  it('muestra el estado de error', () => {
    estado.valor = {
      data: undefined,
      isPending: false,
      isError: true,
      error: { message: 'Boom' },
    };
    renderConProveedores(<CxpPagina />, { sesion: estadoSesionDePrueba(['cxp.ver']) });
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });

  it('pinta los KPIs de vistazo del resumen', () => {
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'consultas.ver-importes']),
    });
    // Cartera total (incl. maquila) + la maquila expuesta APARTE en el pie del tile.
    expect(screen.getByTestId('kpi-cartera')).toHaveTextContent('$103,000.00');
    expect(screen.getByTestId('kpi-cartera')).toHaveTextContent('$15,000.00');
    expect(screen.getByTestId('kpi-vencido')).toHaveTextContent('$47,600.00');
    // % SOLO sobre la cartera del motor (88,000) → 46, NO 54 (la maquila no cuenta).
    expect(screen.getByTestId('kpi-al-corriente')).toHaveTextContent('46');
    expect(screen.getByTestId('kpi-proveedores')).toHaveTextContent('2');
  });

  it('el % al corriente es "—" cuando no hay cartera del motor (solo maquila)', () => {
    estado.valor = {
      data: {
        ...conCartera,
        resumen: {
          carteraTotal: 15000,
          vencido: 0,
          maquilaTotal: 15000,
          alCorrientePct: null,
          proveedoresConSaldo: 1,
          maquilaPorRevisar: sinPorRevisar,
        },
      },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'consultas.ver-importes']),
    });
    expect(screen.getByTestId('kpi-al-corriente')).toHaveTextContent('—');
  });

  it('lista los proveedores con su saldo y aging', () => {
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'consultas.ver-importes']),
    });
    const fila = screen.getByTestId('cxp-fila-7');
    expect(fila).toHaveTextContent('Hilaturas del Norte');
    expect(fila).toHaveTextContent('$88,000.00');
    expect(fila).toHaveTextContent('$40,400.00');
    expect(fila).toHaveTextContent('$47,600.00');
  });

  it('muestra la cubeta de maquila para un proveedor con saldo EsMa', () => {
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'consultas.ver-importes']),
    });
    // Encabezado de la columna de maquila.
    expect(screen.getByRole('columnheader', { name: /maquila/i })).toBeInTheDocument();
    // El maquilero solo-EsMa aparece con su saldo en la cubeta Maquila (motor en "—").
    const fila = screen.getByTestId('cxp-fila-9');
    expect(fila).toHaveTextContent('Maquilas del Sur');
    expect(fila).toHaveTextContent('$15,000.00');
  });

  it('sin nada por revisar, el vistazo no anuncia un pendiente que no existe', () => {
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'consultas.ver-importes']),
    });
    expect(screen.getByTestId('kpi-cartera')).not.toHaveTextContent(/por revisar/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// §Post-F9.188(a) — EL MAQUILERO CON TODO SIN REVISAR NO DESAPARECE DE LA BANDEJA
// Al saldo sólo entra lo revisado (V1, fila 0.115). Sin esta columna, la fila con saldo 0 que el
// servidor decide enseñar se vería "en ceros" sin explicación; y con el corte viejo ni siquiera se vería.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('CxpPagina · maquila por revisar', () => {
  /** Un maquilero cuya ÚNICA maquila está capturada: saldo 0, y algo esperando decisión. */
  const todoCapturado: CxpBandeja['filas'][number] = {
    idProveedor: 11,
    proveedor: 'Maquila Todo Capturado',
    nombreCorto: null,
    diasCredito: 0,
    saldo: 0,
    corriente: 0,
    d1a30: 0,
    d31a60: 0,
    mas60: 0,
    maquila: 0,
    maquilaPorRevisar: { abonos: 400, pagos: 0, descuentos: 0, neto: 400, partidas: 1 },
  };

  it('⭐ el maquilero con TODO sin revisar se ve, con saldo 0 y su «por revisar» explicado', () => {
    estado.valor = {
      data: {
        ...conCartera,
        filas: [...conCartera.filas, todoCapturado],
        total: 3,
        resumen: { ...conCartera.resumen, maquilaPorRevisar: todoCapturado.maquilaPorRevisar },
      },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'consultas.ver-importes']),
    });
    expect(screen.getByRole('columnheader', { name: /por revisar/i })).toBeInTheDocument();
    const fila = screen.getByTestId('cxp-fila-11');
    expect(fila).toHaveTextContent('Maquila Todo Capturado');
    expect(fila).toHaveTextContent('$400.00');
    // Y el vistazo lo anuncia APARTE: la cartera sigue siendo la misma (no suma).
    const kpi = screen.getByTestId('kpi-cartera');
    expect(kpi).toHaveTextContent('$103,000.00');
    expect(kpi).toHaveTextContent(/por revisar/i);
    expect(kpi).toHaveTextContent('$400.00');
  });

  it('con los importes ocultos, dice CUÁNTAS partidas (el conteo nunca se oculta)', () => {
    estado.valor = {
      data: {
        ...conCartera,
        filas: [
          {
            ...todoCapturado,
            saldo: null,
            corriente: null,
            d1a30: null,
            d31a60: null,
            mas60: null,
            maquila: null,
            maquilaPorRevisar: {
              abonos: null,
              pagos: null,
              descuentos: null,
              neto: null,
              partidas: 2,
            },
          },
        ],
        total: 1,
        resumen: {
          carteraTotal: null,
          vencido: null,
          maquilaTotal: null,
          alCorrientePct: null,
          proveedoresConSaldo: 0,
          maquilaPorRevisar: {
            abonos: null,
            pagos: null,
            descuentos: null,
            neto: null,
            partidas: 2,
          },
        },
      },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<CxpPagina />, { sesion: estadoSesionDePrueba(['cxp.ver']) });
    expect(screen.getByTestId('cxp-fila-11')).toHaveTextContent('2 partidas');
    expect(screen.getByTestId('kpi-cartera')).toHaveTextContent('2 partidas');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐ FILA 0.132 (§Post-F9.192(5)) — DOS LISTADOS: Con factura / Sin factura
// Daniel: la bandeja del viernes *"debería partirse en Con factura / Sin factura, con totales y
// antigüedad por separado, porque son dos relaciones de pago distintas"*. La pantalla NO parte nada:
// cambia el `segmento` de la CONSULTA y el servidor devuelve las filas Y los KPIs de esa relación.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('CxpPagina · las dos relaciones de pago (segmento)', () => {
  /** La misma bandeja, respondida como si fuera la de un segmento (KPIs incluidos). */
  function bandejaDe(segmento: 'todos' | 'con' | 'sin', carteraTotal: number): CxpBandeja {
    return {
      ...conCartera,
      segmento,
      resumen: { ...conCartera.resumen, carteraTotal },
    };
  }

  beforeEach(() => {
    consultas.length = 0;
    navegar.mockReset();
    estado.valor = {
      data: bandejaDe('todos', 103000),
      isPending: false,
      isError: false,
      error: null,
    };
  });

  it('arranca en la cartera completa: pide `segmento: todos`', () => {
    renderConProveedores(<CxpPagina />, { sesion: estadoSesionDePrueba(['cxp.ver']) });
    expect(ultimaConsulta().segmento).toBe('todos');
    expect(screen.getByTestId('cxp-titulo-tabla')).toHaveTextContent('Con y sin factura');
  });

  it.each([
    ['cxp-segmento-con', 'con', 'Con factura'],
    ['cxp-segmento-sin', 'sin', 'Sin factura'],
  ] as const)('el chip %s consulta el segmento «%s»', (testid, segmento, titulo) => {
    renderConProveedores(<CxpPagina />, { sesion: estadoSesionDePrueba(['cxp.ver']) });
    fireEvent.click(screen.getByTestId(testid));

    expect(ultimaConsulta().segmento).toBe(segmento);
    expect(screen.getByTestId('cxp-titulo-tabla')).toHaveTextContent(titulo);
    expect(screen.getByTestId('cxp-titulo-kpis')).toHaveTextContent(titulo);
  });

  it('⭐ los KPIs cambian con el chip: son los del segmento, no los de la cartera completa', () => {
    estado.valor = { data: bandejaDe('con', 88000), isPending: false, isError: false, error: null };
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver', 'consultas.ver-importes']),
      rutaInicial: '/cxp?segmento=con',
    });
    // El total que se ve es el que devolvió el servidor PARA "con factura" (no los 103,000 de todo).
    expect(screen.getByTestId('kpi-cartera')).toHaveTextContent('$88,000.00');
    expect(screen.getByTestId('kpi-cartera')).not.toHaveTextContent('$103,000.00');
  });

  it('⭐ el segmento se puede abrir DIRECTO por la URL (el enlace del viernes)', () => {
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver']),
      rutaInicial: '/cxp?segmento=sin',
    });
    expect(ultimaConsulta().segmento).toBe('sin');
    expect(screen.getByTestId('cxp-segmento-sin')).toHaveAttribute('aria-pressed', 'true');
  });

  it('un `?segmento=` inventado cae en la cartera completa, no viaja al API', () => {
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver']),
      rutaInicial: '/cxp?segmento=fiscal',
    });
    expect(ultimaConsulta().segmento).toBe('todos');
  });

  it('⭐ el clic en un proveedor lleva el segmento al estado de cuenta (no abre en «todo»)', () => {
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver']),
      rutaInicial: '/cxp?segmento=sin',
    });
    fireEvent.click(screen.getByTestId('cxp-fila-7'));
    expect(navegar).toHaveBeenCalledWith('/cxp/estado-cuenta', {
      state: { idProveedor: 7, segmento: 'sin' },
    });
  });

  it('la tabla vacía DICE en qué relación está vacía', () => {
    estado.valor = {
      data: { ...bandejaDe('sin', 0), filas: [], total: 0 },
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(<CxpPagina />, {
      sesion: estadoSesionDePrueba(['cxp.ver']),
      rutaInicial: '/cxp?segmento=sin',
    });
    expect(screen.getByTestId('cxp-vacio')).toHaveTextContent('Sin factura');
  });
});
