import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderConProveedores } from '@/pruebas/utilidades';

import { DialogoAgregarModelos, type MesaDeLaLista } from './DialogoAgregarModelos';

const agregarMutate = vi.fn();
const crearModeloMutate = vi.fn();
const alCrearModeloNuevo = vi.fn();

let candidatos: {
  isPending: boolean;
  data: { datos: unknown[]; descartados: unknown[]; faltanFactores: boolean };
};
let clienteData: { data: { abreviatura: string | null } | undefined };

vi.mock('@/api/listas-precios', () => ({
  useCandidatosLista: () => candidatos,
  useAgregarLineasLista: () => ({ mutate: agregarMutate, isPending: false }),
  useCrearModeloEnLista: () => ({ mutate: crearModeloMutate, isPending: false }),
}));
vi.mock('@/api/clientes', () => ({
  useCliente: () => clienteData,
}));
vi.mock('@/api/calidad', () => ({
  useTiposProductoActivos: () => ({ data: { datos: [{ id: 7, nombre: 'Pantalón' }] } }),
}));
vi.mock('@/api/modelos', () => ({
  useGeneros: () => ({ data: [{ id: 1, nombre: 'Caballero' }] }),
}));
vi.mock('@/api/proyectos', () => ({
  useProyectos: () => ({
    data: { datos: [{ id: 30, folio: 12, nombre: 'Otoño 26', archivado: false }] },
  }),
}));
// El selector de modelo tiene su propia prueba; aquí sólo hace falta poder elegir uno.
vi.mock('@/modulos/inventarios/SelectorModelo', () => ({
  SelectorModelo: ({ alSeleccionar }: { alSeleccionar: (m: { id: number }) => void }) => (
    <button
      type="button"
      data-testid="elegir-modelo-origen"
      onClick={() => alSeleccionar({ id: 99 })}
    >
      elegir
    </button>
  ),
}));

const MESA: MesaDeLaLista = {
  id: 5,
  idCliente: 1,
  idClienteDepartamento: 2,
  nombreCliente: 'C&A',
  nombreDepartamento: 'NIÑOS',
};

function pintar(): void {
  renderConProveedores(
    <DialogoAgregarModelos
      abierto
      alCambiarAbierto={() => undefined}
      mesa={MESA}
      alCrearModeloNuevo={alCrearModeloNuevo}
    />,
  );
}

function candidato(idDesarrollo: number, codigoModelo: string): Record<string, unknown> {
  return {
    idDesarrollo,
    idProyecto: 30,
    folioProyecto: 12,
    nombreProyecto: 'Otoño 26',
    codigoModelo,
    descripcionModelo: null,
    numeroCliente: null,
    idPrecosto: 100 + idDesarrollo,
    versionPrecosto: 1,
    costoTotal: 42.2,
  };
}

describe('<DialogoAgregarModelos> — la mesa abierta (§Post-F9.152)', () => {
  beforeEach(() => {
    agregarMutate.mockReset();
    crearModeloMutate.mockReset();
    alCrearModeloNuevo.mockReset();
    candidatos = {
      isPending: false,
      data: { datos: [candidato(1, 'CYA-26-71-001')], descartados: [], faltanFactores: false },
    };
    clienteData = { data: { abreviatura: 'CYA' } };
  });

  it('agrega a la lista los modelos cotizados que se marcan', async () => {
    const usuario = userEvent.setup();
    pintar();

    await usuario.click(screen.getByLabelText(/CYA-26-71-001/i, { selector: 'input' }));
    await usuario.click(screen.getByTestId('confirmar-agregar-lineas'));

    expect(agregarMutate.mock.calls[0]?.[0]).toMatchObject({
      id: 5,
      cuerpo: { idsDesarrollo: [1] },
    });
  });

  it('sin nada marcado el botón de agregar está apagado', () => {
    pintar();
    expect(screen.getByTestId('confirmar-agregar-lineas')).toBeDisabled();
  });

  it('cuando no hay candidatos lo DICE (y ofrece crear uno nuevo)', () => {
    candidatos.data.datos = [];
    pintar();
    expect(screen.getByTestId('sin-candidatos-agregar')).toHaveTextContent(/Modelo nuevo/i);
  });

  it('🔴 DESDE CERO manda tipo de prenda, género y año; sin `idModeloOrigen`', async () => {
    const usuario = userEvent.setup();
    pintar();

    await usuario.click(screen.getByTestId('modo-modelo-nuevo'));
    await usuario.selectOptions(screen.getByTestId('agregar-tipo'), '7');
    await usuario.selectOptions(screen.getByTestId('agregar-genero'), '1');
    await usuario.selectOptions(screen.getByTestId('agregar-proyecto'), '30');
    await usuario.click(screen.getByTestId('confirmar-modelo-nuevo'));

    const cuerpo = crearModeloMutate.mock.calls[0]?.[0] as { cuerpo: Record<string, unknown> };
    expect(cuerpo.cuerpo).toMatchObject({ idTipoProducto: 7, idGenero: 1, idProyecto: 30 });
    expect(cuerpo.cuerpo['idModeloOrigen']).toBeUndefined();
  });

  it('🔴 COPIANDO manda `idModeloOrigen` y NO exige tipo ni género (se heredan)', async () => {
    const usuario = userEvent.setup();
    pintar();

    await usuario.click(screen.getByTestId('modo-modelo-nuevo'));
    await usuario.click(screen.getByTestId('agregar-copiar'));
    await usuario.click(screen.getByTestId('elegir-modelo-origen'));
    await usuario.selectOptions(screen.getByTestId('agregar-proyecto'), '30');
    await usuario.click(screen.getByTestId('confirmar-modelo-nuevo'));

    const cuerpo = crearModeloMutate.mock.calls[0]?.[0] as { cuerpo: Record<string, unknown> };
    expect(cuerpo.cuerpo).toMatchObject({ idModeloOrigen: 99, idProyecto: 30 });
    expect(cuerpo.cuerpo['idTipoProducto']).toBeUndefined();
  });

  it('🔴 desde cero SIN los dos dígitos no llama al servidor y explica por qué', async () => {
    const usuario = userEvent.setup();
    pintar();

    await usuario.click(screen.getByTestId('modo-modelo-nuevo'));
    await usuario.selectOptions(screen.getByTestId('agregar-proyecto'), '30');
    await usuario.click(screen.getByTestId('confirmar-modelo-nuevo'));

    expect(crearModeloMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/tipo de prenda y el género/i)).toBeInTheDocument();
  });

  it('el PROYECTO NUEVO viaja por nombre, en la misma llamada (nunca dos altas sueltas)', async () => {
    const usuario = userEvent.setup();
    pintar();

    await usuario.click(screen.getByTestId('modo-modelo-nuevo'));
    await usuario.selectOptions(screen.getByTestId('agregar-tipo'), '7');
    await usuario.selectOptions(screen.getByTestId('agregar-genero'), '1');
    await usuario.selectOptions(screen.getByTestId('agregar-proyecto'), 'nuevo');
    await usuario.type(screen.getByTestId('agregar-proyecto-nombre'), 'Cita septiembre');
    await usuario.click(screen.getByTestId('confirmar-modelo-nuevo'));

    const cuerpo = crearModeloMutate.mock.calls[0]?.[0] as { cuerpo: Record<string, unknown> };
    expect(cuerpo.cuerpo).toMatchObject({ nombreProyectoNuevo: 'Cita septiembre' });
    expect(cuerpo.cuerpo['idProyecto']).toBeUndefined();
  });

  it('🔴 un cliente SIN ABREVIATURA se avisa ANTES y el botón queda apagado (no truena en la cita)', async () => {
    const usuario = userEvent.setup();
    clienteData = { data: { abreviatura: null } };
    pintar();

    await usuario.click(screen.getByTestId('modo-modelo-nuevo'));

    expect(screen.getByTestId('aviso-sin-abreviatura')).toHaveTextContent(/abreviatura/i);
    expect(screen.getByTestId('confirmar-modelo-nuevo')).toBeDisabled();
  });
});
