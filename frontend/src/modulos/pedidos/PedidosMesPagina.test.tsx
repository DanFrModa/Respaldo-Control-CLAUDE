import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PedidosPorMes } from '@/api/tipos';
import type { ClavePermiso } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { PedidosMesPagina } from './PedidosMesPagina';

/**
 * Unit de la pantalla PEDIDOS POR MES (rediseño R3, §4.1) — SIN red (capa de datos mockeada).
 * Cubre lo que el e2e (que corre como admin) NO ejercita (hallazgo del reviewer): el GATING de
 * IMPORTES sin `pedidos.importes` (columnas Precio/Importe y el "Importe total" de la barra NO se
 * pintan; el backend además manda los valores en null) y el gate del deep-link del constructor
 * (`state.abrirConstructor` sin `pedidos.administrar` NO abre nada).
 */

// ── Capa de datos mockeada (la consulta por mes se controla por test; lo demás inerte) ──
const usePedidosPorMes = vi.fn<() => unknown>();

vi.mock('@/api/pedidos-mes', () => ({
  usePedidosPorMes: () => usePedidosPorMes(),
  useCandidatosDesarrollo: () => ({ data: [], isPending: false }),
  useSalidaProduccion: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/pedidos', () => ({
  CLAVE_PEDIDOS: ['pedidos'],
  useCrearPedido: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/api/adjuntos-pedido', () => ({
  useAdjuntosPedido: () => ({ data: [], isPending: false, isError: false, error: null }),
  useSubirAdjuntoPedido: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQuitarAdjuntoPedido: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/clientes', () => ({
  useClientes: () => ({ data: { datos: [] }, isPending: false }),
  useCamposCliente: () => ({ data: [], isPending: false }),
}));
vi.mock('@/api/empresas', () => ({
  useEmpresas: () => ({ data: [], isPending: false }),
}));
vi.mock('@/api/colores', () => ({
  // `useCrearColor` lo pide `AgregarColorMatriz`, el combobox con búsqueda server-side que la
  // matriz de "Generar OP" reusa desde V1-E4 (punto 7).
  useColores: () => ({ data: { datos: [] }, isPending: false, isFetching: false }),
  useCrearColor: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/tallas', () => ({
  useTallasActivas: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/ordenes-consulta', () => ({
  imprimirOrden: vi.fn(),
}));

/** Página de ejemplo: un pedido con un renglón (los importes van según el permiso simulado). */
function paginaDeEjemplo(conImportes: boolean): PedidosPorMes {
  return {
    datos: [
      {
        id: 1,
        folio: 1502,
        idEmpresa: 1,
        empresa: 'FR Moda',
        idCliente: 3,
        cliente: 'C&A',
        ocCliente: 'OC-CA-4471',
        fechaDe: null,
        fechaHasta: '2026-08-15',
        estatus: 'vigente',
        cantidadTotal: 100,
        cortadoTotal: 40,
        importeTotal: conImportes ? 14800 : null,
        renglones: [
          {
            id: 11,
            idModelo: 9,
            codigoModelo: 'KM-114',
            origenModelo: 'produccion',
            descripcionModelo: 'Playera Cherry',
            idDesarrollo: 5,
            numeroCliente: 'CA-KM-114',
            numeroProduccion: 51114,
            // V1-E3: los nº de los modelos de producción del renglón (uno por color/OP). Aquí el
            // caso LEGADO —el renglón ya apuntaba a un modelo de producción—, con su única OP.
            numerosProduccion: [51114],
            cantidad: 100,
            precio: conImportes ? 148 : null,
            importe: conImportes ? 14800 : null,
            idOrden: 501,
            folioOrden: 5500,
            numOrdenes: 1,
            cortado: 40,
          },
        ],
      },
    ],
    totales: {
      pedidos: 1,
      ordenes: 1,
      piezas: 100,
      cortado: 40,
      avancePct: 40,
      importe: conImportes ? 14800 : null,
    },
    total: 1,
    pagina: 1,
    porPagina: 50,
    totalPaginas: 1,
  };
}

function consulta(datos: PedidosPorMes): unknown {
  return {
    data: datos,
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

/**
 * ⭐⭐ V1-E3 — un renglón de modelo de DESARROLLO con DOS OPs de dos colores. Su
 * `numeroProduccion` (el del modelo del renglón) es `null` **para siempre**: desde esta etapa el
 * desarrollo ya no se promueve, y el número vive en el modelo de cada OP.
 */
function paginaPorColor(numerosProduccion: number[] = [71001, 71002]): PedidosPorMes {
  const pagina = paginaDeEjemplo(true);
  const [fila] = pagina.datos;
  if (fila === undefined) throw new Error('la página de ejemplo perdió su pedido');
  const [renglon] = fila.renglones;
  if (renglon === undefined) throw new Error('la página de ejemplo perdió su renglón');
  return {
    ...pagina,
    datos: [
      {
        ...fila,
        renglones: [
          {
            ...renglon,
            codigoModelo: 'CYA-26-71-003',
            origenModelo: 'desarrollo',
            numeroProduccion: null,
            numerosProduccion,
            numOrdenes: numerosProduccion.length,
          },
        ],
      },
    ],
  };
}

describe('<PedidosMesPagina>', () => {
  beforeEach(() => {
    usePedidosPorMes.mockReset();
  });

  /**
   * 🔴 LA PRUEBA DE V1-E3 EN LA PANTALLA. Sin `numerosProduccion`, la fila de un renglón de
   * desarrollo enseñaría su código (`CYA-26-71-003`) **y ningún número, nunca**, porque el modelo
   * del renglón ya no se promueve. Si alguien vuelve a leer `renglon.numeroProduccion` para pintar
   * el `prod. #…`, esta prueba cae.
   */
  it('⭐⭐ enseña los nº de producción de los MODELOS POR COLOR del renglón, no el del renglón', () => {
    usePedidosPorMes.mockReturnValue(consulta(paginaPorColor()));
    renderConProveedores(<PedidosMesPagina />, {
      sesion: estadoSesionDePrueba(['pedidos.ver', 'pedidos.importes']),
    });

    expect(screen.getByText('CYA-26-71-003')).toBeInTheDocument();
    expect(screen.getByText('prod. #71001 · #71002')).toBeInTheDocument();
  });

  it('un renglón sin ninguna OP y sin nº no pinta el chip de producción', () => {
    // Control negativo: si el helper devolviera algo siempre, la prueba de arriba pasaría con todo
    // roto (bastaría con pintar el texto vacío).
    usePedidosPorMes.mockReturnValue(consulta(paginaPorColor([])));
    renderConProveedores(<PedidosMesPagina />, {
      sesion: estadoSesionDePrueba(['pedidos.ver', 'pedidos.importes']),
    });

    expect(screen.queryByText(/prod\. #/)).not.toBeInTheDocument();
  });

  it('CON pedidos.importes pinta Precio/Importe y el Importe total de la barra', () => {
    usePedidosPorMes.mockReturnValue(consulta(paginaDeEjemplo(true)));
    renderConProveedores(<PedidosMesPagina />, {
      sesion: estadoSesionDePrueba(['pedidos.ver', 'pedidos.importes']),
    });

    expect(screen.getByText('Precio')).toBeInTheDocument();
    expect(screen.getByText('Importe')).toBeInTheDocument();
    expect(screen.getByText('Importe total')).toBeInTheDocument();
    // El renglón trae su precio formateado.
    expect(screen.getByText('$148.00')).toBeInTheDocument();
  });

  it('SIN pedidos.importes NO pinta las columnas Precio/Importe ni el Importe total (gating)', () => {
    usePedidosPorMes.mockReturnValue(consulta(paginaDeEjemplo(false)));
    renderConProveedores(<PedidosMesPagina />, {
      sesion: estadoSesionDePrueba(['pedidos.ver']),
    });

    // La tabla sí pinta el pedido…
    expect(screen.getByText('1502-F')).toBeInTheDocument();
    expect(screen.getByText('C&A')).toBeInTheDocument();
    // …pero SIN columnas de dinero ni total de la barra (además el backend los manda en null).
    expect(screen.queryByText('Precio')).not.toBeInTheDocument();
    expect(screen.queryByText('Importe')).not.toBeInTheDocument();
    expect(screen.queryByText('Importe total')).not.toBeInTheDocument();
    expect(screen.queryByText('$148.00')).not.toBeInTheDocument();
  });

  it('sin pedidos.administrar el deep-link state.abrirConstructor NO abre el constructor', () => {
    usePedidosPorMes.mockReturnValue(consulta(paginaDeEjemplo(false)));
    renderConProveedores(<PedidosMesPagina />, {
      sesion: estadoSesionDePrueba(['pedidos.ver']),
      rutaInicial: { pathname: '/pedidos', state: { abrirConstructor: true } },
    });

    expect(screen.queryByTestId('constructor-pedido')).not.toBeInTheDocument();
    // Tampoco existe el CTA "Nuevo pedido" (gated con pedidos.administrar).
    expect(screen.queryByTestId('nuevo-pedido')).not.toBeInTheDocument();
  });

  it('con pedidos.administrar el deep-link SÍ abre el constructor', () => {
    usePedidosPorMes.mockReturnValue(consulta(paginaDeEjemplo(true)));
    renderConProveedores(<PedidosMesPagina />, {
      sesion: estadoSesionDePrueba(['pedidos.ver', 'pedidos.administrar', 'pedidos.importes']),
      rutaInicial: { pathname: '/pedidos', state: { abrirConstructor: true } },
    });

    expect(screen.getByTestId('constructor-pedido')).toBeInTheDocument();
  });

  /**
   * ⭐ V1-E4 punto 3 — EL RESURTIDO. El backend modela N OPs por renglón A PROPÓSITO
   * (`salidaAProduccion` reusa el nº de producción del modelo en la segunda salida), pero la
   * pantalla cambiaba el botón "Generar OP" por la liga a la orden en cuanto nacía la primera: la
   * SEGUNDA OP era imposible desde aquí. El renglón de ejemplo YA tiene OP (folio 5500), así que
   * esta prueba falla si el botón desaparece de nuevo.
   */
  describe('⭐ resurtido: la segunda OP de un renglón (V1-E4)', () => {
    const PERM: ClavePermiso[] = ['pedidos.ver', 'pedidos.administrar', 'ordenes.administrar'];

    it('con una OP ya creada, sigue habiendo cómo generar otra', () => {
      usePedidosPorMes.mockReturnValue(consulta(paginaDeEjemplo(false)));
      renderConProveedores(<PedidosMesPagina />, { sesion: estadoSesionDePrueba(PERM) });

      // La liga a la OP existente sigue ahí…
      expect(screen.getByTestId('pedidos-liga-orden')).toHaveTextContent('5500');
      // …y ADEMÁS el botón de resurtido.
      expect(screen.getByTestId('pedidos-resurtido')).toBeInTheDocument();
    });

    it('el botón de resurtido abre el panel de Generar OP del MISMO renglón', async () => {
      const usuario = userEvent.setup();
      usePedidosPorMes.mockReturnValue(consulta(paginaDeEjemplo(false)));
      renderConProveedores(<PedidosMesPagina />, { sesion: estadoSesionDePrueba(PERM) });

      await usuario.click(screen.getByTestId('pedidos-resurtido'));

      const panel = await screen.findByTestId('panel-generar-op');
      expect(panel).toHaveAttribute('aria-label', expect.stringContaining('KM-114'));
    });

    it('sin ordenes.administrar no se ofrece el resurtido', () => {
      usePedidosPorMes.mockReturnValue(consulta(paginaDeEjemplo(false)));
      renderConProveedores(<PedidosMesPagina />, {
        sesion: estadoSesionDePrueba(['pedidos.ver']),
      });

      expect(screen.queryByTestId('pedidos-resurtido')).not.toBeInTheDocument();
    });
  });

  /**
   * ⭐ V1-E4 punto 7 — los colores de la matriz de "Generar OP" salían de la PRIMERA PÁGINA del
   * catálogo (100). El catálogo los rebasa (el importador de OC por PDF crea colores solo), así
   * que había colores INALCANZABLES y el usuario terminaba duplicándolos. Ahora se busca en
   * servidor con el mismo combobox que la matriz de la OP.
   */
  it('⭐ la matriz de Generar OP busca colores en servidor, no en una lista precargada', async () => {
    const usuario = userEvent.setup();
    usePedidosPorMes.mockReturnValue(consulta(paginaDeEjemplo(false)));
    renderConProveedores(<PedidosMesPagina />, {
      sesion: estadoSesionDePrueba(['pedidos.ver', 'pedidos.administrar', 'ordenes.administrar']),
    });

    await usuario.click(screen.getByTestId('pedidos-resurtido'));
    await screen.findByTestId('panel-generar-op');

    // El combobox con typeahead (`matriz-color-al-vuelo`), NO el <select> del catálogo cargado.
    expect(screen.getByTestId('matriz-color-al-vuelo')).toBeInTheDocument();
    expect(screen.queryByTestId('matriz-op-agregar-color')).not.toBeInTheDocument();
  });
});
