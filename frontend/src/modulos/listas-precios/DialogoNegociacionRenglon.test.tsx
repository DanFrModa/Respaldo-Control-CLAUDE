import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListaLinea } from '@/api/listas-precios';
import type { NegociacionEvento } from '@/api/negociacion';
import type { PrecostoResumen } from '@/api/precostos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoNegociacionRenglon } from './DialogoNegociacionRenglon';

// ── Estado controlado de la capa de datos (sin red) ──────────────────────────────
let eventos: { data: NegociacionEvento[]; isPending: boolean; isError: boolean; error: null };
let versiones: { data: PrecostoResumen[] };
const rondaMutate = vi.fn();
const acuerdoMutate = vi.fn();

vi.mock('@/api/negociacion', () => ({
  useEventosLinea: () => eventos,
  useRegistrarRonda: () => ({ mutate: rondaMutate, isPending: false }),
  useRegistrarAcuerdo: () => ({ mutate: acuerdoMutate, isPending: false }),
}));
vi.mock('@/api/precostos', () => ({
  usePrecostosDesarrollo: () => versiones,
  CLAVE_PRECOSTOS: ['precostos'],
}));
vi.mock('@/api/desarrollos', () => ({
  useDesarrollo: () => ({ data: undefined }),
}));
// El editor de precosto y el comparador se prueban por separado: aquí se estampan.
vi.mock('@/modulos/desarrollo/DialogoPrecosto', () => ({
  DialogoPrecosto: () => <div data-testid="stub-precosto" />,
}));
vi.mock('./ComparadorVersiones', () => ({
  ComparadorVersiones: () => <div data-testid="stub-comparador" />,
}));

function linea(): ListaLinea {
  return {
    id: 7,
    idDesarrollo: 3,
    idPrecosto: 11,
    versionPrecosto: 1,
    codigoModelo: 'MOD-X',
    descripcionModelo: null,
    numeroCliente: null,
    costoUnit: 40,
    precioCalculado: 100,
    precioAprobado: null,
    aprobado: false,
    aprobadoPorId: null,
    aprobadoEn: null,
  };
}

function evento(
  over: Partial<NegociacionEvento> & Pick<NegociacionEvento, 'id'>,
): NegociacionEvento {
  return {
    idListaLinea: 7,
    idPrecostoAnterior: 11,
    idPrecostoNuevo: 12,
    versionAnterior: 1,
    versionNueva: 2,
    precioAnterior: 100,
    precioNuevo: 120,
    acuerdo: 'Se quitan bolsas',
    registradoPorId: 'u1',
    registradoEn: '2026-07-06T10:00:00.000Z',
    ...over,
  };
}

function resumen(
  over: Partial<PrecostoResumen> & Pick<PrecostoResumen, 'id' | 'version'>,
): PrecostoResumen {
  return {
    estado: 'congelado',
    congelado: true,
    costoTotal: 40,
    congeladoEn: '2026-07-06T00:00:00.000Z',
    congeladoPorId: null,
    creadoEn: '2026-07-06T00:00:00.000Z',
    ...over,
  };
}

describe('<DialogoNegociacionRenglon>', () => {
  beforeEach(() => {
    rondaMutate.mockReset();
    acuerdoMutate.mockReset();
    eventos = { data: [], isPending: false, isError: false, error: null };
    versiones = { data: [] };
  });

  it('muestra el historial de eventos y permite comparar una ronda', async () => {
    const usuario = userEvent.setup();
    eventos = { data: [evento({ id: 1 })], isPending: false, isError: false, error: null };
    renderConProveedores(
      <DialogoNegociacionRenglon
        abierto
        alCambiarAbierto={() => {}}
        linea={linea()}
        verImportes
        puedeNegociar
      />,
      { sesion: estadoSesionDePrueba(['listas.ver', 'listas.negociar']) },
    );

    const panel = screen.getByTestId('panel-negociacion');
    expect(within(panel).getByTestId('fila-evento-negociacion')).toBeInTheDocument();
    expect(within(panel).getByText('Se quitan bolsas')).toBeInTheDocument();

    await usuario.click(within(panel).getByTestId('comparar-evento'));
    expect(screen.getByTestId('stub-comparador')).toBeInTheDocument();
  });

  it('sin listas.negociar NO ofrece las acciones de negociar', () => {
    eventos = { data: [], isPending: false, isError: false, error: null };
    renderConProveedores(
      <DialogoNegociacionRenglon
        abierto
        alCambiarAbierto={() => {}}
        linea={linea()}
        verImportes
        puedeNegociar={false}
      />,
      { sesion: estadoSesionDePrueba(['listas.ver']) },
    );
    expect(screen.queryByTestId('abrir-nueva-ronda')).not.toBeInTheDocument();
    expect(screen.queryByTestId('abrir-acuerdo')).not.toBeInTheDocument();
    expect(screen.getByTestId('negociacion-vacia')).toBeInTheDocument();
  });

  it('la nueva ronda exige elegir versión + acuerdo y llama a registrarRonda', async () => {
    const usuario = userEvent.setup();
    // Una versión congelada distinta de la actual (id 12 ≠ idPrecosto 11) para poder elegirla.
    versiones = { data: [resumen({ id: 12, version: 2 })] };
    renderConProveedores(
      <DialogoNegociacionRenglon
        abierto
        alCambiarAbierto={() => {}}
        linea={linea()}
        verImportes
        puedeNegociar
      />,
      { sesion: estadoSesionDePrueba(['listas.ver', 'listas.negociar', 'desarrollo.precostear']) },
    );

    await usuario.click(screen.getByTestId('abrir-nueva-ronda'));
    await usuario.selectOptions(screen.getByTestId('ronda-version'), '12');
    await usuario.type(screen.getByTestId('ronda-acuerdo'), 'Quitamos bolsas');
    await usuario.type(screen.getByTestId('ronda-precio'), '150');
    await usuario.click(screen.getByTestId('confirmar-ronda'));

    expect(rondaMutate).toHaveBeenCalledTimes(1);
    expect(rondaMutate).toHaveBeenCalledWith(
      {
        idLinea: 7,
        cuerpo: { idPrecostoNuevo: 12, acuerdo: 'Quitamos bolsas', precioAcordado: 150 },
      },
      expect.anything(),
    );
  });

  it('el acuerdo sin re-costeo llama a registrarAcuerdo', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoNegociacionRenglon
        abierto
        alCambiarAbierto={() => {}}
        linea={linea()}
        verImportes
        puedeNegociar
      />,
      { sesion: estadoSesionDePrueba(['listas.ver', 'listas.negociar']) },
    );

    await usuario.click(screen.getByTestId('abrir-acuerdo'));
    await usuario.type(screen.getByTestId('acuerdo-texto'), 'Cliente pide muestra');
    await usuario.click(screen.getByTestId('confirmar-acuerdo'));

    expect(acuerdoMutate).toHaveBeenCalledTimes(1);
    expect(acuerdoMutate).toHaveBeenCalledWith(
      { idLinea: 7, cuerpo: { acuerdo: 'Cliente pide muestra' } },
      expect.anything(),
    );
  });
});
