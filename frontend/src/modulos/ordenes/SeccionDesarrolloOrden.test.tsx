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
/**
 * `nombreAutor` parametrizado (V1-E8q): permite probar el caso «hay id pero el nombre no resuelve»
 * sin mutar el fixture por fuera.
 */
function expedienteDePrueba(nombreAutor: string | null = 'Daniel Masri') {
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
        // 🔴 V1-E8q: id con forma de CUID REAL, como en producción. Antes decía 'daniel' —con forma
        // de nombre— y eso ENMASCARABA el defecto: la pantalla pintaba el id crudo y el test pasaba
        // igual, porque el id se leía como si fuera una persona. Un fixture que no se parece al
        // mundo es una prueba que caduca sin avisar.
        registradoPorId: 'cm3x9k2q0000abcd1234efgh',
        nombreRegistradoPor: nombreAutor,
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

  // §Post-F9.68 — esconder, no negar: sin `consultas.ver-importes` el campo del
  // precio se va COMPLETO (rótulo incluido) y NO queda letrero de permiso ni
  // celda vacía. Va con su gemela positiva: con el permiso, el precio SÍ está.
  it('sin permiso de importes el campo del precio no existe (ni letrero ni celda vacía)', () => {
    useSugerenciaLigaMock.mockReturnValue({
      data: sugerenciaConCandidato(87.5),
      isPending: false,
      isError: false,
    });
    renderConProveedores(
      <SeccionDesarrolloOrden orden={ordenDePrueba} puedeAdministrar verImportes={false} />,
      { sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']) },
    );
    expect(screen.queryByTestId('precio-sugerido-pedido')).toBeNull();
    expect(screen.queryByText(/Precio sugerido al pedido/i)).toBeNull();
    expect(screen.queryByText(/permiso/i)).toBeNull();
  });

  it('CON permiso de importes el precio sí se muestra (gemela positiva)', () => {
    useSugerenciaLigaMock.mockReturnValue({
      data: sugerenciaConCandidato(87.5),
      isPending: false,
      isError: false,
    });
    renderConProveedores(
      <SeccionDesarrolloOrden orden={ordenDePrueba} puedeAdministrar verImportes />,
      { sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']) },
    );
    expect(screen.getByTestId('precio-sugerido-pedido')).toBeInTheDocument();
    expect(screen.getByText(/Precio sugerido al pedido/i)).toBeInTheDocument();
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

  /**
   * 🔴 V1-E8q — LA PUERTA GEMELA. El hilo de la negociación se pinta en DOS lugares: el panel de la
   * lista de precios y ESTE expediente. El panel ya mostraba el nombre; aquí se pintaba el
   * `registradoPorId` CRUDO (`cm3x9k2q…`), que es exactamente el defecto que la etapa vino a
   * eliminar — un id no es un autor para nadie.
   *
   * La prueba exige las dos mitades: que SE VEA el nombre y que NO SE VEA el id.
   */
  it('🔴 el acuerdo dice QUIÉN lo escribió con su NOMBRE, nunca el id crudo', () => {
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

    const acuerdo = screen.getByTestId('acuerdo-negociacion');
    expect(acuerdo).toHaveTextContent('por Daniel Masri');
    expect(acuerdo.textContent).not.toContain('cm3x9k2q0000abcd1234efgh');
  });

  /**
   * Los tres casos de `autorDeEvento`, en ESTA pantalla: un id sin nombre resoluble lo escribió una
   * PERSONA, y decir «Sistema» le atribuiría al sistema lo que dijo alguien en la mesa.
   */
  it('un autor sin nombre resoluble NO se llama «Sistema» (lo escribió una persona)', () => {
    useSugerenciaLigaMock.mockReturnValue({
      data: { idOrden: 50, folioOrden: 7, yaLigada: true, candidato: null },
      isPending: false,
      isError: false,
    });
    useExpedienteOrdenMock.mockReturnValue({
      data: expedienteDePrueba(null),
      isPending: false,
      isError: false,
    });
    renderConProveedores(
      <SeccionDesarrolloOrden orden={ordenDePrueba} puedeAdministrar verImportes />,
      { sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']) },
    );

    const acuerdo = screen.getByTestId('acuerdo-negociacion');
    expect(acuerdo).toHaveTextContent('Usuario dado de baja');
    expect(acuerdo.textContent).not.toContain('Sistema');
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
