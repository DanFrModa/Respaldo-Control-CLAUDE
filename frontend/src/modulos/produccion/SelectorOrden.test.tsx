import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { SelectorOrden } from './SelectorOrden';

/**
 * REGRESIÓN QUE NO DEBE VOLVER (26-jul-2026): este selector es la puerta de entrada de **TRES**
 * pantallas de operación (entrega a cliente, salida de tela a orden y alta de auditoría).
 * Filtraba `estado: 'completa'`; cuando ese estado pasó a ser AUTOMÁTICO (hoy: tallas + receta
 * liberada, y arte si aplica), las órdenes a las que les faltaba cualquiera de esos requisitos
 * —muy comunes en lo migrado de Access, que llegó sin receta— DESAPARECÍAN de los tres buscadores
 * y la orden no se podía operar. Aquí se fija que el filtro sea "todas menos canceladas" y que una
 * orden `capturada` SÍ se pueda elegir.
 *
 * ⚠️ **Este docblock decía SIETE** (añadiendo corte, envío a maquila, recibo y «nota de salida de
 * tela»), **y era falso** — corte, envío y recibo viven en `AvanceProduccion.tsx`, que recibe
 * `idOrden` como prop, y «Notas de salida» usa un `<select>` nativo, no este componente. Medido el
 * 26-sep-2026 con `grep -rn "SelectorOrden'" frontend/src`, tras haber engañado al lead, que
 * publicó «seis pantallas» en la fila 0.214 citando el docblock del componente como si fuera una
 * medición. **Si cambias quién usa este selector, mide y actualiza esto y su gemelo del
 * componente.**
 */

const useOrdenesMock = vi.fn<(query: Record<string, unknown>) => Record<string, unknown>>();
vi.mock('@/api/ordenes', () => ({
  useOrdenes: (query: Record<string, unknown>) => useOrdenesMock(query),
}));
/** 0.227: la consulta del AVISO («lo buscado existe pero está cerrado»). */
const useConsultaOrdenesMock =
  vi.fn<(query: Record<string, unknown>, opciones?: { habilitado?: boolean }) => unknown>();
vi.mock('@/api/ordenes-consulta', () => ({
  useConsultaOrdenes: (query: Record<string, unknown>, opciones?: { habilitado?: boolean }) =>
    useConsultaOrdenesMock(query, opciones),
}));

/** Orden INCOMPLETA (`capturada`: le falta algún requisito) — el caso que se rompía. */
const ordenCapturada = {
  id: 9,
  folio: 5424,
  estado: 'capturada',
  codigoModelo: 'A-100',
  cliente: 'Liverpool',
  totalPiezas: 120,
} as unknown as Orden;

function paginaCon(ordenes: Orden[]): Record<string, unknown> {
  return {
    data: { datos: ordenes, total: ordenes.length, pagina: 1, porPagina: 8, totalPaginas: 1 },
    isPending: false,
    isError: false,
    error: null,
  };
}

/** Respuesta de la consulta de CERRADAS: sólo si está habilitada (si no, como react-query: nada). */
function cerradasQueCoinciden(folios: number[], total = folios.length) {
  return (_query: Record<string, unknown>, opciones?: { habilitado?: boolean }): unknown =>
    opciones?.habilitado === false
      ? { data: undefined, isPlaceholderData: false }
      : {
          data: {
            datos: folios.map((folio) => ({ id: folio, folio })),
            total,
            pagina: 1,
            porPagina: 5,
            totalPaginas: 1,
          },
          isPlaceholderData: false,
        };
}

describe('<SelectorOrden>', () => {
  beforeEach(() => {
    useOrdenesMock.mockReset();
    useOrdenesMock.mockReturnValue(paginaCon([ordenCapturada]));
    useConsultaOrdenesMock.mockReset();
    useConsultaOrdenesMock.mockImplementation(cerradasQueCoinciden([]));
  });

  it('NO filtra por estado "completa": pide todas las órdenes menos las canceladas', () => {
    renderConProveedores(<SelectorOrden idSeleccionada={undefined} alSeleccionar={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });

    const query = useOrdenesMock.mock.calls[0]?.[0];
    expect(query).toMatchObject({ incluirCanceladas: 'false' });
    expect(query).not.toHaveProperty('estado');
  });

  it('deja SELECCIONAR una orden en estado "capturada" (sin receta de avíos)', async () => {
    const usuario = userEvent.setup();
    const alSeleccionar = vi.fn();
    renderConProveedores(
      <SelectorOrden idSeleccionada={undefined} alSeleccionar={alSeleccionar} />,
      { sesion: estadoSesionDePrueba([]) },
    );

    await usuario.click(screen.getByTestId('selector-orden-busqueda'));
    expect(screen.getByTestId('selector-orden-opcion')).toHaveTextContent('Orden #5424');
    await usuario.click(screen.getByTestId('selector-orden-opcion'));

    expect(alSeleccionar).toHaveBeenCalledTimes(1);
    expect(alSeleccionar.mock.calls[0]?.[0]).toMatchObject({ id: 9, estado: 'capturada' });
  });

  it('cuando no hay resultados NO habla de "órdenes completas"', async () => {
    const usuario = userEvent.setup();
    useOrdenesMock.mockReturnValue(paginaCon([]));
    renderConProveedores(<SelectorOrden idSeleccionada={undefined} alSeleccionar={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });

    await usuario.click(screen.getByTestId('selector-orden-busqueda'));
    expect(screen.getByText('No hay órdenes abiertas que coincidan.')).toBeInTheDocument();
    expect(screen.queryByText(/completa/i)).not.toBeInTheDocument();
  });
});

/**
 * ⭐⭐ 0.227 (§Post-F9.244, etapa 2) — LAS CERRADAS NO APARECEN DONDE SE CAPTURA… pero NUNCA EN
 * SILENCIO. Las tres pantallas de este selector son de captura. Por omisión pide al SERVIDOR sólo las
 * abiertas; el interruptor «Mostrar cerradas» las devuelve; y si lo buscado existe pero está cerrado,
 * se DICE —el «no hay coincidencias» mudo es justo el defecto del 26-jul que documenta el componente—.
 */
describe('<SelectorOrden> · las cerradas (0.227)', () => {
  beforeEach(() => {
    useOrdenesMock.mockReset();
    useOrdenesMock.mockReturnValue(paginaCon([ordenCapturada]));
    useConsultaOrdenesMock.mockReset();
    useConsultaOrdenesMock.mockImplementation(cerradasQueCoinciden([]));
  });

  const ultimaQuery = (): Record<string, unknown> | undefined => useOrdenesMock.mock.lastCall?.[0];

  it('por omisión pide al SERVIDOR sólo las abiertas (nunca filtra en el cliente)', () => {
    renderConProveedores(<SelectorOrden idSeleccionada={undefined} alSeleccionar={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });
    expect(ultimaQuery()).toMatchObject({ cerradas: 'ocultar', incluirCanceladas: 'false' });
    expect(screen.getByTestId('selector-orden-mostrar-cerradas')).not.toBeChecked();
  });

  it('el interruptor «Mostrar cerradas» las vuelve a pedir, y la cerrada sale MARCADA', async () => {
    const usuario = userEvent.setup();
    const cerrada = {
      ...ordenCapturada,
      id: 10,
      folio: 5425,
      estado: 'cerrada',
      cerradaEn: '2026-10-01T10:00:00.000Z',
    } as unknown as Orden;
    useOrdenesMock.mockImplementation((query) =>
      paginaCon(query.cerradas === 'incluir' ? [cerrada, ordenCapturada] : [ordenCapturada]),
    );
    const alSeleccionar = vi.fn();
    renderConProveedores(
      <SelectorOrden idSeleccionada={undefined} alSeleccionar={alSeleccionar} />,
      { sesion: estadoSesionDePrueba([]) },
    );

    await usuario.click(screen.getByTestId('selector-orden-mostrar-cerradas'));
    expect(ultimaQuery()).toMatchObject({ cerradas: 'incluir' });

    await usuario.click(screen.getByTestId('selector-orden-busqueda'));
    const opciones = screen.getAllByTestId('selector-orden-opcion');
    expect(opciones[0]).toHaveTextContent('Orden #5425');
    expect(opciones[0]).toHaveTextContent('Cerrada');
    expect(opciones[1]).not.toHaveTextContent('Cerrada');
    // Elegirla SIGUE funcionando (la pantalla avisa y apaga el guardar: etapa 1).
    await usuario.click(opciones[0] as HTMLElement);
    expect(alSeleccionar.mock.calls[0]?.[0]).toMatchObject({ id: 10 });
  });

  it('⭐ si lo buscado sólo existe CERRADO, lo DICE (en la lista y debajo del buscador)', async () => {
    const usuario = userEvent.setup();
    useOrdenesMock.mockReturnValue(paginaCon([]));
    useConsultaOrdenesMock.mockImplementation(cerradasQueCoinciden([5424]));
    renderConProveedores(<SelectorOrden idSeleccionada={undefined} alSeleccionar={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });

    await usuario.type(screen.getByTestId('selector-orden-busqueda'), '5424');
    const texto =
      'La orden 5424 está cerrada: actívala con “Mostrar cerradas” para consultarla; para ' +
      'moverla hay que reabrirla.';
    expect(await screen.findByTestId('selector-orden-aviso-cerradas')).toHaveTextContent(texto);
    // Y en la lista, en lugar del «no hay coincidencias» mudo.
    expect(screen.getByTestId('selector-orden-lista')).toHaveTextContent(texto);
    expect(screen.queryByText('No hay órdenes abiertas que coincidan.')).not.toBeInTheDocument();

    // La consulta del aviso pregunta por LO BUSCADO y sólo por las cerradas.
    expect(useConsultaOrdenesMock.mock.lastCall?.[0]).toMatchObject({
      cerradas: 'solo',
      busqueda: '5424',
    });

    // Sigue a la vista al salir del buscador (que es cuando se va a pulsar el interruptor).
    await usuario.tab();
    expect(screen.getByTestId('selector-orden-aviso-cerradas')).toHaveTextContent(texto);
  });

  it('también avisa si hay abiertas Y cerradas que coinciden (la cerrada no se esconde callada)', async () => {
    const usuario = userEvent.setup();
    useConsultaOrdenesMock.mockImplementation(cerradasQueCoinciden([5401, 5402], 9));
    renderConProveedores(<SelectorOrden idSeleccionada={undefined} alSeleccionar={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });

    await usuario.type(screen.getByTestId('selector-orden-busqueda'), 'A-100');
    expect(await screen.findByTestId('selector-orden-aviso-cerradas')).toHaveTextContent(
      'Las órdenes 5401, 5402 y 7 más están cerradas',
    );
  });

  it('con datos de OTRA búsqueda (placeholder de react-query) NO avisa: hablaría de lo que no se buscó', async () => {
    const usuario = userEvent.setup();
    useOrdenesMock.mockReturnValue(paginaCon([]));
    // La respuesta trae cerradas, pero es la de la búsqueda ANTERIOR (keepPreviousData).
    useConsultaOrdenesMock.mockImplementation((_query, opciones) =>
      opciones?.habilitado === false
        ? { data: undefined, isPlaceholderData: false }
        : {
            data: {
              datos: [{ id: 5424, folio: 5424 }],
              total: 1,
              pagina: 1,
              porPagina: 5,
              totalPaginas: 1,
            },
            isPlaceholderData: true,
          },
    );
    renderConProveedores(<SelectorOrden idSeleccionada={undefined} alSeleccionar={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });

    await usuario.type(screen.getByTestId('selector-orden-busqueda'), '9999');
    // Ya resuelto el debounce y la consulta de abiertas, la lista dice lo que de verdad pasó…
    expect(await screen.findByText('No hay órdenes abiertas que coincidan.')).toBeInTheDocument();
    expect(useConsultaOrdenesMock.mock.lastCall?.[1]).toEqual({ habilitado: true });
    // …y no se inventa el aviso con los datos viejos.
    expect(screen.queryByTestId('selector-orden-aviso-cerradas')).not.toBeInTheDocument();
    expect(screen.queryByText(/La orden 5424 está cerrada/)).not.toBeInTheDocument();
  });

  it('la orden elegida que NO viene en la lista (enlace directo, cerrada) se rotula con `etiquetaSeleccion`', () => {
    // La lista sólo trae abiertas (y 8): la 77 no está, pero es la elegida.
    renderConProveedores(
      <SelectorOrden idSeleccionada={77} alSeleccionar={vi.fn()} etiquetaSeleccion="Orden #9001" />,
      { sesion: estadoSesionDePrueba([]) },
    );
    expect(screen.getByTestId('selector-orden-busqueda')).toHaveValue('Orden #9001');
  });

  it('sin búsqueda, o con el interruptor encendido, NO pregunta por las cerradas ni avisa', async () => {
    const usuario = userEvent.setup();
    useConsultaOrdenesMock.mockImplementation(cerradasQueCoinciden([5424]));
    renderConProveedores(<SelectorOrden idSeleccionada={undefined} alSeleccionar={vi.fn()} />, {
      sesion: estadoSesionDePrueba([]),
    });
    expect(useConsultaOrdenesMock.mock.lastCall?.[1]).toEqual({ habilitado: false });
    expect(screen.queryByTestId('selector-orden-aviso-cerradas')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('selector-orden-mostrar-cerradas'));
    await usuario.type(screen.getByTestId('selector-orden-busqueda'), '5424');
    // Espera al debounce: aun resuelto, con el interruptor encendido no hay nada que avisar.
    await new Promise((r) => setTimeout(r, 400));
    expect(useConsultaOrdenesMock.mock.lastCall?.[1]).toEqual({ habilitado: false });
    expect(screen.queryByTestId('selector-orden-aviso-cerradas')).not.toBeInTheDocument();
  });
});
