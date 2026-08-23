import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoEditarNota } from './DialogoEditarNota';
import { notaDePrueba } from './fixtures';

// ── Mocks de la capa de datos (sin red) ──────────────────────────────────────
const crearMutate = vi.fn();
const actualizarMutate = vi.fn();

vi.mock('@/api/notas-salida', () => ({
  useCrearNota: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarNota: () => ({ mutate: actualizarMutate, isPending: false }),
}));

vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({
    data: { datos: [{ id: 9, nombre: 'Costuras del Bajío' }] },
    isPending: false,
  }),
}));
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({
    data: { datos: [{ id: 2, nombre: 'Almacén central' }] },
    isPending: false,
  }),
}));
// El renglón elige el avío con el COMBOBOX de búsqueda server-side (V1-E3c).
vi.mock('@/api/avios', () => ({
  useAvios: () => ({
    data: { datos: [{ id: 3, clave: 'BOT-01', descripcion: 'Botón', esGenerico: false }] },
    isPending: false,
    isError: false,
    error: null,
  }),
}));
vi.mock('@/api/telas', () => ({
  useTelas: () => ({ data: { datos: [{ id: 7, nombre: 'Felpa francesa' }] } }),
}));
vi.mock('@/api/ordenes-consulta', () => ({
  useConsultaOrdenes: () => ({
    data: { datos: [{ id: 50, folio: 1001, codigoModelo: 'MOD-1', cliente: 'Cliente A' }] },
  }),
}));
// El editor de renglones usa el kardex de tela (para listar las salidas-a-orden) y las existencias
// de avío del almacén origen (aviso "excede", R6 §4.6).
vi.mock('@/api/inventario-materiales', () => ({
  useKardexTela: () => ({ data: { renglones: [] }, isPending: false }),
  useExistenciasAvio: () => ({ data: { filas: [] }, isPending: false }),
}));
// "Traer avíos de la orden" (R6): la habilitación de la orden elegida (mock controlable por test).
const useHabilitacionOrdenMock = vi.fn();
vi.mock('@/api/habilitacion', () => ({
  useHabilitacionOrden: () => useHabilitacionOrdenMock() as unknown,
}));

/** Elige el avío en el combobox del renglón: enfocar abre la lista y se clickea la opción. */
function elegirAvioBoton(): void {
  fireEvent.focus(screen.getByTestId('selector-avio-nota-busqueda'));
  fireEvent.mouseDown(screen.getAllByTestId('selector-avio-nota-opcion')[0] as HTMLElement);
}

describe('DialogoEditarNota (F4-E5)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    actualizarMutate.mockReset();
    useHabilitacionOrdenMock.mockReset();
    useHabilitacionOrdenMock.mockReturnValue({ data: undefined, isPending: false });
  });

  it('al ALTA arranca con un renglón vacío y el botón crear deshabilitado', () => {
    renderConProveedores(
      <DialogoEditarNota abierto alCambiarAbierto={() => undefined} alGuardada={() => undefined} />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    expect(screen.getByTestId('renglon-nota')).toBeInTheDocument();
    // Sin maquilero/almacén/material, no se puede guardar.
    expect(screen.getByTestId('confirmar-nota')).toBeDisabled();
  });

  it('un renglón de AVÍO sin avío deja el botón crear deshabilitado (no permite renglón sin material)', () => {
    renderConProveedores(
      <DialogoEditarNota abierto alCambiarAbierto={() => undefined} alGuardada={() => undefined} />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    // Encabezado completo.
    fireEvent.change(screen.getByTestId('nota-maquilero'), { target: { value: '9' } });
    fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
    // Orden + cantidad, pero SIN elegir avío.
    fireEvent.change(screen.getByTestId('selector-orden-nota'), { target: { value: '50' } });
    fireEvent.change(screen.getByTestId('cantidad-nota'), { target: { value: '5' } });
    expect(screen.getByTestId('confirmar-nota')).toBeDisabled();
  });

  it('un renglón de AVÍO completo habilita crear y envía el cuerpo', () => {
    renderConProveedores(
      <DialogoEditarNota abierto alCambiarAbierto={() => undefined} alGuardada={() => undefined} />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    fireEvent.change(screen.getByTestId('nota-maquilero'), { target: { value: '9' } });
    fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('selector-orden-nota'), { target: { value: '50' } });
    elegirAvioBoton();
    fireEvent.change(screen.getByTestId('cantidad-nota'), { target: { value: '5' } });

    const crear = screen.getByTestId('confirmar-nota');
    expect(crear).toBeEnabled();
    crear.click();
    expect(crearMutate).toHaveBeenCalledTimes(1);
    const cuerpo = crearMutate.mock.calls.at(0)?.[0] as { lineas: { idAvio?: number }[] };
    expect(cuerpo.lineas.at(0)?.idAvio).toBe(3);
  });

  it('el constructor es SOLO-AVÍOS: no ofrece renglones de tela (§4.6 dec. 2)', () => {
    renderConProveedores(
      <DialogoEditarNota abierto alCambiarAbierto={() => undefined} alGuardada={() => undefined} />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    // No hay selector de "Tipo de material" ni forma de armar un renglón de tela desde aquí:
    // la tela se registra en «Salida de tela a orden» (por color).
    expect(screen.queryByTestId('tipo-material-nota')).toBeNull();
    expect(screen.queryByTestId('selector-tela-nota')).toBeNull();
    // El único selector de material del renglón es el de avío (ahora un combobox buscable).
    expect(screen.getByTestId('selector-avio-nota-busqueda')).toBeInTheDocument();
  });

  it('"Traer avíos de la orden" carga la receta como renglones con su cantidad sugerida (R6)', () => {
    useHabilitacionOrdenMock.mockReturnValue({
      data: {
        idOrden: 50,
        folioOrden: 1001,
        idMaquilero: 9,
        avios: [
          { idAvio: 3, requerido: 180, unidad: 'pza', esExtra: false },
          // Un extra NO se trae (solo la receta).
          { idAvio: 99, requerido: 0, unidad: 'pza', esExtra: true },
        ],
      },
      isPending: false,
    });
    renderConProveedores(
      <DialogoEditarNota abierto alCambiarAbierto={() => undefined} alGuardada={() => undefined} />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    // Elige la orden en el selector de "Traer avíos" y pulsa el botón.
    fireEvent.change(screen.getByTestId('nota-traer-orden'), { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('nota-traer-boton'));

    // El renglón vacío inicial se descartó y quedó el avío de la receta (cantidad = requerido).
    expect(screen.getByTestId('cantidad-nota')).toHaveValue(180);
    // La clave viaja con el renglón traído: el combobox la muestra sin depender del typeahead.
    expect(screen.getByTestId('selector-avio-nota-busqueda')).toHaveValue('BOT-01');
  });

  it('en EDICIÓN precarga el encabezado de la nota', () => {
    renderConProveedores(
      <DialogoEditarNota
        abierto
        alCambiarAbierto={() => undefined}
        nota={notaDePrueba()}
        alGuardada={() => undefined}
      />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    expect(screen.getByTestId('nota-maquilero')).toHaveValue('9');
    expect(screen.getByTestId('nota-almacen')).toHaveValue('2');
    // Dos renglones precargados (avío + tela).
    expect(screen.getAllByTestId('renglon-nota')).toHaveLength(2);
  });
});
