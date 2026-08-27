import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as ReactRouterDom from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CandidatoLista, DescartadoLista, DiagnosticoCandidatos } from '@/api/listas-precios';
import { renderConProveedores } from '@/pruebas/utilidades';

import { DialogoCrearLista } from './DialogoCrearLista';

/**
 * ⭐ V1-E8f (§Post-F9.128) — «NO HAY DESARROLLOS DISPONIBLES» TIENE QUE DECIR POR QUÉ.
 *
 * Daniel llegó hasta aquí y se quedó parado: *"si tengo el permiso. Sí veo el botón. Justo me sale la
 * leyenda de que no hay desarrollos disponibles."* El diálogo funcionaba; lo que faltaba era que
 * dijera qué le faltaba a SU modelo (congelar el precosto) y por dónde ir.
 *
 * Lo que se blinda: con cero candidatos, el aviso NOMBRA cada modelo descartado, su motivo y el
 * remedio; y cuando SÍ hay candidatos, aparecen y el aviso desaparece (la gemela).
 */
const navegar = vi.fn();
vi.mock('react-router-dom', async (importarOriginal) => {
  const real = await importarOriginal<typeof ReactRouterDom>();
  return { ...real, useNavigate: () => navegar };
});

let diagnostico: DiagnosticoCandidatos;
vi.mock('@/api/listas-precios', () => ({
  useCandidatosLista: () => ({ data: diagnostico, isPending: false, isError: false }),
  useCrearLista: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/clientes', () => ({
  useDepartamentosCliente: () => ({ data: [], isPending: false }),
}));

/** El contexto de proyecto precarga cliente+departamento: el diálogo consulta sin tocar selectores. */
const PROYECTO = {
  id: 7,
  folio: 101,
  nombre: 'Joggers',
  idCliente: 3,
  cliente: 'C&A',
  idClienteDepartamento: 4,
  departamento: 'Caballero',
};

function descartado(
  idDesarrollo: number,
  codigoModelo: string,
  motivo: DescartadoLista['motivo'],
  extra: Partial<DescartadoLista> = {},
): DescartadoLista {
  return {
    idDesarrollo,
    idProyecto: PROYECTO.id,
    folioProyecto: PROYECTO.folio,
    nombreProyecto: PROYECTO.nombre,
    codigoModelo,
    numeroCliente: null,
    motivo,
    versionPrecosto: null,
    idLista: null,
    folioLista: null,
    ...extra,
  };
}

function candidato(idDesarrollo: number, codigoModelo: string): CandidatoLista {
  return {
    idDesarrollo,
    idProyecto: PROYECTO.id,
    folioProyecto: PROYECTO.folio,
    nombreProyecto: PROYECTO.nombre,
    codigoModelo,
    descripcionModelo: null,
    numeroCliente: null,
    idPrecosto: 500,
    versionPrecosto: 2,
    costoTotal: 40,
  };
}

function abrir(): void {
  renderConProveedores(
    <DialogoCrearLista abierto alCambiarAbierto={vi.fn()} proyecto={PROYECTO} />,
  );
}

describe('<DialogoCrearLista> · por qué no hay candidatos (V1-E8f)', () => {
  beforeEach(() => {
    navegar.mockClear();
    diagnostico = { datos: [], descartados: [] };
  });

  // ⭐ EL CASO DE DANIEL.
  it('con el precosto en BORRADOR nombra el modelo, la versión y el acto de congelarlo', () => {
    diagnostico = {
      datos: [],
      descartados: [descartado(1, 'A-100', 'precosto-borrador', { versionPrecosto: 3 })],
    };
    abrir();

    const aviso = screen.getByTestId('candidatos-vacio');
    expect(aviso).toHaveTextContent('A-100');
    expect(aviso).toHaveTextContent(/v3 en borrador/i);
    expect(aviso).toHaveTextContent(/Congelar versión/i);
    // Y ya NO se limita a decir que no hay nada disponible.
    expect(aviso).not.toHaveTextContent(/^No hay desarrollos cotizados disponibles/i);
  });

  it('con motivos MEZCLADOS los separa por grupo, cada uno con su remedio', () => {
    diagnostico = {
      datos: [],
      descartados: [
        descartado(1, 'A-100', 'precosto-borrador', { versionPrecosto: 1 }),
        descartado(2, 'B-200', 'ya-en-lista', { idLista: 9, folioLista: 12 }),
        descartado(3, 'C-300', 'sin-precosto'),
        descartado(4, 'D-400', 'apagado'),
      ],
    };
    abrir();

    expect(screen.getByTestId('motivo-precosto-borrador')).toHaveTextContent('A-100');
    // El que ya está colocado dice EN CUÁL lista: es el dato que permite ir a buscarla.
    expect(screen.getByTestId('motivo-ya-en-lista')).toHaveTextContent(/lista #12/i);
    expect(screen.getByTestId('motivo-sin-precosto')).toHaveTextContent('C-300');
    expect(screen.getByTestId('motivo-apagado')).toHaveTextContent(/Reactívalos/i);
  });

  it('sin NINGÚN modelo dice que hay que capturarlo antes, no que "no hay disponibles"', () => {
    diagnostico = { datos: [], descartados: [] };
    abrir();

    const aviso = screen.getByTestId('candidatos-vacio');
    expect(aviso).toHaveTextContent(/todavía no tiene modelos en desarrollo/i);
    expect(aviso).toHaveTextContent(/precosto congelado/i);
  });

  it('lleva a Pre-costeos: el aviso no deja al usuario sin salida', async () => {
    const usuario = userEvent.setup();
    diagnostico = {
      datos: [],
      descartados: [descartado(1, 'A-100', 'precosto-borrador', { versionPrecosto: 1 })],
    };
    abrir();

    await usuario.click(screen.getByRole('button', { name: 'Ir a Pre-costeos' }));
    expect(navegar).toHaveBeenCalledWith('/desarrollo');
  });

  // Lo que sólo INFORMA (ya colocado / apagado) no se arregla en Pre-costeos: ofrecer ahí una
  // puerta falsa sería mandar al usuario a dar la vuelta para nada.
  it('sin nada que congelar, NO ofrece la puerta a Pre-costeos', () => {
    diagnostico = {
      datos: [],
      descartados: [descartado(2, 'B-200', 'ya-en-lista', { idLista: 9, folioLista: 12 })],
    };
    abrir();

    expect(screen.queryByRole('button', { name: 'Ir a Pre-costeos' })).not.toBeInTheDocument();
  });

  // LA GEMELA: cuando el modelo SÍ califica, aparece y el aviso se va.
  it('con candidatos aparecen las filas y el aviso desaparece', () => {
    diagnostico = { datos: [candidato(1, 'A-100')], descartados: [] };
    abrir();

    expect(screen.queryByTestId('candidatos-vacio')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('fila-candidato')).toHaveLength(1);
    expect(screen.getByTestId('candidatos-lista')).toHaveTextContent('A-100');
  });
});
