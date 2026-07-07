import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { SeccionDesarrolloOrden } from './SeccionDesarrolloOrden';

const useSugerenciaLigaMock = vi.fn();
const useExpedienteOrdenMock = vi.fn();
const ligarMutateMock = vi.fn();
const quitarMutateMock = vi.fn();

vi.mock('@/api/liga-orden', () => ({
  useSugerenciaLiga: (id: unknown) => useSugerenciaLigaMock(id) as unknown,
  useExpedienteOrden: (id: unknown, ligada: unknown) =>
    useExpedienteOrdenMock(id, ligada) as unknown,
  useLigarOrden: () => ({ mutate: ligarMutateMock, isPending: false }),
  useQuitarLiga: () => ({ mutate: quitarMutateMock, isPending: false }),
}));

/** Orden mínima (el componente solo usa `id`). */
const ordenDePrueba = { id: 50 } as unknown as Orden;

/** Candidato de sugerencia con precio propuesto. */
function sugerenciaConCandidato(precio: number | null) {
  return {
    idOrden: 50,
    folioOrden: 7,
    yaLigada: false,
    candidato: {
      idDesarrollo: 3,
      idProyecto: 2,
      folioProyecto: 12,
      nombreProyecto: 'Primavera Liverpool',
      codigoModelo: 'A-100',
      descripcionModelo: 'Playera',
      numeroCliente: 'LIV-77',
      estado: 'en-lista' as const,
      idListaLinea: 9,
      folioLista: 4,
      precioSugeridoPedido: precio,
    },
  };
}

/** Expediente 360 de una orden ligada. */
function expedienteDePrueba() {
  return {
    idOrden: 50,
    folioOrden: 7,
    idModelo: 9,
    codigoModelo: 'A-100',
    descripcionModelo: 'Playera',
    idDesarrollo: 3,
    numeroCliente: 'LIV-77',
    estadoDesarrollo: 'ligado-produccion' as const,
    idProyecto: 2,
    folioProyecto: 12,
    nombreProyecto: 'Primavera Liverpool',
    idCliente: 1,
    nombreCliente: 'Liverpool',
    idClienteDepartamento: 1,
    nombreDepartamento: 'Damas',
    temporada: 'Primavera',
    precostoVigente: { idPrecosto: 5, version: 2, costoTotal: 123.45, congeladoEn: null },
    lista: {
      idLista: 4,
      folioLista: 4,
      codigoEstadoLista: 'aprobada',
      nombreEstadoLista: 'Aprobada',
      idListaLinea: 9,
      precio: 200,
      aprobado: true,
    },
    acuerdos: [
      {
        id: 1,
        idListaLinea: 9,
        idPrecostoAnterior: null,
        idPrecostoNuevo: null,
        versionAnterior: null,
        versionNueva: null,
        precioAnterior: 180,
        precioNuevo: 200,
        acuerdo: 'Se acordó $200 tras la ronda 2.',
        registradoPorId: 'daniel',
        registradoEn: '2026-07-01T10:00:00.000Z',
      },
    ],
  };
}

describe('SeccionDesarrolloOrden (F8-E6)', () => {
  beforeEach(() => {
    useSugerenciaLigaMock.mockReset();
    useExpedienteOrdenMock.mockReset();
    ligarMutateMock.mockReset();
    quitarMutateMock.mockReset();
    useExpedienteOrdenMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
  });

  it('orden NO ligada: muestra la sugerencia con el precio propuesto y liga al hacer clic', async () => {
    useSugerenciaLigaMock.mockReturnValue({
      data: sugerenciaConCandidato(150),
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(
      <SeccionDesarrolloOrden orden={ordenDePrueba} puedeAdministrar verImportes />,
      { sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']) },
    );

    expect(screen.getByTestId('desarrollo-orden-sugerencia')).toBeInTheDocument();
    expect(screen.getByTestId('precio-sugerido-pedido')).toHaveTextContent('150');

    await usuario.click(screen.getByTestId('ligar-desarrollo'));
    expect(ligarMutateMock).toHaveBeenCalledOnce();
    const [args] = ligarMutateMock.mock.calls[0] as [{ idOrden: number; idDesarrollo: number }];
    expect(args).toEqual({ idOrden: 50, idDesarrollo: 3 });
  });

  it('sin permiso de importes NO muestra el precio (deriva del permiso, no del null)', () => {
    useSugerenciaLigaMock.mockReturnValue({
      data: sugerenciaConCandidato(null),
      isPending: false,
      isError: false,
    });
    renderConProveedores(
      <SeccionDesarrolloOrden orden={ordenDePrueba} puedeAdministrar verImportes={false} />,
      { sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']) },
    );
    expect(screen.getByTestId('precio-sugerido-pedido')).toHaveTextContent(
      'Sin permiso de importes',
    );
  });

  it('sin desarrollo.administrar no muestra el botón de ligar', () => {
    useSugerenciaLigaMock.mockReturnValue({
      data: sugerenciaConCandidato(150),
      isPending: false,
      isError: false,
    });
    renderConProveedores(
      <SeccionDesarrolloOrden orden={ordenDePrueba} puedeAdministrar={false} verImportes />,
      { sesion: estadoSesionDePrueba(['desarrollo.ver']) },
    );
    expect(screen.queryByTestId('ligar-desarrollo')).not.toBeInTheDocument();
  });

  it('orden ligada: muestra la vista 360 (proyecto, precio, acuerdos) y el botón de quitar liga', () => {
    useSugerenciaLigaMock.mockReturnValue({
      data: { idOrden: 50, folioOrden: 7, yaLigada: true, candidato: null },
      isPending: false,
      isError: false,
    });
    useExpedienteOrdenMock.mockReturnValue({
      data: expedienteDePrueba(),
      isPending: false,
      isError: false,
    });
    renderConProveedores(
      <SeccionDesarrolloOrden orden={ordenDePrueba} puedeAdministrar verImportes />,
      { sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']) },
    );

    expect(screen.getByTestId('desarrollo-orden-ligada')).toBeInTheDocument();
    expect(screen.getByText('Primavera Liverpool')).toBeInTheDocument();
    expect(screen.getByTestId('acuerdo-negociacion')).toHaveTextContent('Se acordó $200');
    expect(screen.getByTestId('quitar-liga-desarrollo')).toBeInTheDocument();
  });

  it('orden ligada: pide el expediente solo cuando hay liga (enabled)', () => {
    useSugerenciaLigaMock.mockReturnValue({
      data: { idOrden: 50, folioOrden: 7, yaLigada: true, candidato: null },
      isPending: false,
      isError: false,
    });
    useExpedienteOrdenMock.mockReturnValue({
      data: expedienteDePrueba(),
      isPending: false,
      isError: false,
    });
    renderConProveedores(
      <SeccionDesarrolloOrden orden={ordenDePrueba} puedeAdministrar verImportes />,
      {
        sesion: estadoSesionDePrueba(['desarrollo.ver']),
      },
    );
    // Se llamó con (idOrden, ligada=true).
    expect(useExpedienteOrdenMock).toHaveBeenCalledWith(50, true);
  });
});
