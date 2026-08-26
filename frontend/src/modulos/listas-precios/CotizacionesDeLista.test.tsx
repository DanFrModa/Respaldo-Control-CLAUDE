import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CotizacionResumen } from '@/api/cotizaciones';
import type { ListaDetalle } from '@/api/listas-precios';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CotizacionesDeLista } from './CotizacionesDeLista';

/**
 * Unit del bloque de COTIZACIONES EMITIDAS (V1-E7c), centrado en la regresión H2.
 *
 * 🔴 **Por qué esta prueba existe y no es cosmética.** El diálogo de cancelar arrastraba el motivo de
 * un documento a otro: tecleabas el motivo de la #7, pulsabas «Volver», abrías cancelar en la #8 y el
 * campo seguía diciendo el motivo de la #7 **con el botón destructivo habilitado**. Un clic sellaba un
 * motivo equivocado en el documento equivocado **para siempre**, porque re-cancelar se rechaza (D3) y
 * no hay corrección posible. La causa era que Radix NO dispara `onOpenChange` en un cierre
 * PROGRAMÁTICO, así que el reset de `onOpenChange` nunca corría.
 */
const cancelarMutate = vi.fn();
let cotizaciones: CotizacionResumen[];

vi.mock('@/api/cotizaciones', () => ({
  useCotizaciones: () => ({ data: cotizaciones, isPending: false, isError: false }),
  useCancelarCotizacion: () => ({ mutate: cancelarMutate, isPending: false }),
  useEmitirCotizacion: () => ({ mutate: vi.fn(), isPending: false }),
  imprimirCotizacionPdf: vi.fn(),
}));

function cotizacion(id: number, folio: number): CotizacionResumen {
  return {
    id,
    folio,
    idLista: 5,
    folioLista: 7,
    idCliente: 1,
    nombreCliente: 'C&A',
    nombreDepartamento: 'NIÑOS',
    fecha: '2026-03-12',
    estado: 'emitida',
    totalRenglones: 5,
    total: 682.5,
    creadoEn: '2026-03-12T10:00:00.000Z',
  };
}

const LISTA: ListaDetalle = {
  id: 5,
  folio: 7,
  idCliente: 1,
  nombreCliente: 'C&A',
  idClienteDepartamento: 1,
  nombreDepartamento: 'NIÑOS',
  fecha: '2026-03-12',
  idEstadoLista: 1,
  codigoEstado: 'abierta',
  nombreEstado: 'Abierta',
  margenPct: 50,
  descuentosPct: 10,
  regaliasPct: 5,
  costoVentasPct: 5,
  notas: null,
  lineas: [],
  creadoEn: '2026-03-12T00:00:00.000Z',
  creadoPorId: null,
  modificadoEn: '2026-03-12T00:00:00.000Z',
  modificadoPorId: null,
};

const PERMISOS = ['listas.ver', 'listas.negociar', 'consultas.ver-importes'] as const;

describe('<CotizacionesDeLista>', () => {
  beforeEach(() => {
    cancelarMutate.mockReset();
    cotizaciones = [cotizacion(70, 7), cotizacion(80, 8)];
  });

  it('🔴 H2 — el motivo NO se arrastra de un documento a otro', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CotizacionesDeLista lista={LISTA} />, {
      sesion: estadoSesionDePrueba([...PERMISOS]),
    });

    // Se teclea el motivo de la cotización #7…
    await usuario.click(screen.getByTestId('cancelar-cotizacion-70'));
    const campo = screen.getByLabelText(/Motivo de la cancelación/);
    await usuario.type(campo, 'El cliente cambió la curva de tallas');
    expect(screen.getByTestId('confirmar-cancelar-cotizacion')).toBeEnabled();

    // …pero se cierra con «Volver» (cierre PROGRAMÁTICO: Radix no dispara onOpenChange).
    await usuario.click(screen.getByRole('button', { name: 'Volver' }));

    // Y se abre cancelar en la #8: el campo tiene que estar VACÍO y el botón BLOQUEADO.
    await usuario.click(screen.getByTestId('cancelar-cotizacion-80'));
    expect(screen.getByLabelText(/Motivo de la cancelación/)).toHaveValue('');
    expect(screen.getByTestId('confirmar-cancelar-cotizacion')).toBeDisabled();
    expect(cancelarMutate).not.toHaveBeenCalled();
  });

  it('cancela el documento correcto, con su motivo', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CotizacionesDeLista lista={LISTA} />, {
      sesion: estadoSesionDePrueba([...PERMISOS]),
    });

    await usuario.click(screen.getByTestId('cancelar-cotizacion-80'));
    await usuario.type(screen.getByLabelText(/Motivo de la cancelación/), 'Se duplicó');
    await usuario.click(screen.getByTestId('confirmar-cancelar-cotizacion'));

    expect(cancelarMutate).toHaveBeenCalledTimes(1);
    expect(cancelarMutate.mock.calls[0]?.[0]).toEqual({
      id: 80,
      cuerpo: { motivo: 'Se duplicó' },
    });
  });

  it('sin `listas.negociar` no se ofrece emitir ni cancelar (sólo consultar)', () => {
    renderConProveedores(<CotizacionesDeLista lista={LISTA} />, {
      sesion: estadoSesionDePrueba(['listas.ver', 'consultas.ver-importes']),
    });
    expect(screen.queryByTestId('emitir-cotizacion')).toBeNull();
    expect(screen.queryByTestId('cancelar-cotizacion-70')).toBeNull();
    // Pero el historial sí se ve, con su PDF.
    expect(within(screen.getByTestId('cotizaciones-de-lista')).getByText('#7')).toBeInTheDocument();
    expect(screen.getByTestId('cotizacion-pdf-70')).toBeInTheDocument();
  });
});
