import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { limpiarCombobox, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoAlmacen } from './DialogoAlmacen';

/**
 * Pruebas del campo CORTADOR del almacén (§Post-F9.13): solo aparece en almacenes de TELA, en el
 * alta viaja únicamente si se eligió, y en EDICIÓN viaja siempre —incluido `null`— para poder
 * QUITAR la liga. El backend re-valida todo (tipo, rol `corte`, un cortador = un almacén).
 */

const crearMutate = vi.fn();
const actualizarMutate = vi.fn();

vi.mock('@/api/almacenes', () => ({
  useCrearAlmacen: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarAlmacen: () => ({ mutate: actualizarMutate, isPending: false }),
}));

const espiaRol = vi.fn();
vi.mock('@/api/proveedores', () => ({
  COD_ROL_PROVEEDOR: { corte: 'corte', vendeTelas: 'vende-telas' },
  // V1-E7g: el cortador se elige en un combobox con búsqueda en SERVIDOR; el mock filtra por
  // «contiene», igual que el servidor (`idsPorNombreSinAcentos` hace `LIKE %texto%`).
  useProveedoresPorRol: (codigo: string | undefined, filtros?: { busqueda?: string }) => {
    espiaRol(codigo);
    const todos = [{ id: 99, nombre: 'Taller Montaño' }];
    const busqueda = (filtros?.busqueda ?? '').toLowerCase();
    return {
      data: {
        datos:
          busqueda === '' ? todos : todos.filter((p) => p.nombre.toLowerCase().includes(busqueda)),
      },
      isPending: false,
    };
  },
}));

/** Almacén de ejemplo para el modo edición. */
function almacenDePrueba(sobrescribir: Record<string, unknown> = {}) {
  return {
    id: 3,
    nombre: 'Bodega Montaño',
    tipo: 'TELA' as const,
    activo: true,
    idEmpresa: 1,
    idCortador: 99,
    cortador: 'Taller Montaño',
    esTransitoProceso: false,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    ...sobrescribir,
  };
}

describe('DialogoAlmacen · cortador (§Post-F9.13)', () => {
  it('el campo solo existe en almacenes de TELA y ofrece únicamente cortadores', async () => {
    renderConProveedores(<DialogoAlmacen abierto alCambiarAbierto={vi.fn()} almacen={undefined} />);

    // El alta arranca en PT: sin campo de cortador.
    expect(screen.queryByTestId('almacen-cortador')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'TELA' } });
    expect(screen.getByTestId('almacen-cortador')).toBeInTheDocument();
    // La lista se pide acotada al rol "corte" (el filtro lo aplica el servidor).
    expect(espiaRol).toHaveBeenCalledWith('corte');
    // V1-E7g: la lista vive en el popover del combobox, que se abre al enfocar el campo.
    fireEvent.focus(screen.getByTestId('almacen-cortador-busqueda'));
    expect(await screen.findByTestId('almacen-cortador-opcion')).toHaveTextContent(
      'Taller Montaño',
    );
  });

  it('en el ALTA sin cortador elegido, el campo NO viaja en el cuerpo', async () => {
    renderConProveedores(<DialogoAlmacen abierto alCambiarAbierto={vi.fn()} almacen={undefined} />);
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Naucalpan' } });
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'TELA' } });
    fireEvent.click(screen.getByTestId('guardar-almacen'));

    await waitFor(() => {
      expect(crearMutate).toHaveBeenCalledWith(
        { nombre: 'Naucalpan', tipo: 'TELA' },
        expect.anything(),
      );
    });
  });

  it('en EDICIÓN, dejarlo en "sin cortador" manda null para QUITAR la liga', async () => {
    renderConProveedores(
      <DialogoAlmacen abierto alCambiarAbierto={vi.fn()} almacen={almacenDePrueba()} />,
    );

    // Llega con su cortador ya elegido…
    await waitFor(() => {
      expect(screen.getByTestId('almacen-cortador-busqueda')).toHaveValue('Taller Montaño');
    });
    // …y al vaciarlo, el PATCH manda null explícito (omitirlo dejaría la liga intacta).
    limpiarCombobox('almacen-cortador');
    fireEvent.click(screen.getByTestId('guardar-almacen'));

    await waitFor(() => {
      expect(actualizarMutate).toHaveBeenCalledWith(
        { id: 3, cuerpo: { nombre: 'Bodega Montaño', tipo: 'TELA', idCortador: null } },
        expect.anything(),
      );
    });
  });

  it('cambiar el tipo a PT manda la liga en null (no deja una liga huérfana)', async () => {
    renderConProveedores(
      <DialogoAlmacen abierto alCambiarAbierto={vi.fn()} almacen={almacenDePrueba()} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('almacen-cortador-busqueda')).toHaveValue('Taller Montaño');
    });

    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'PT' } });
    expect(screen.queryByTestId('almacen-cortador')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('guardar-almacen'));

    await waitFor(() => {
      expect(actualizarMutate).toHaveBeenCalledWith(
        { id: 3, cuerpo: { nombre: 'Bodega Montaño', tipo: 'PT', idCortador: null } },
        expect.anything(),
      );
    });
  });
});
