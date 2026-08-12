import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoDesarrollo } from './DialogoDesarrollo';

/**
 * El selector de modelo del alta de desarrollo (Daniel, ago-2026). El catálogo real tiene ~5,000
 * modelos:
 * el `<select>` anterior sólo traía la PRIMERA página (tope 100) y el modelo recién dado de alta no
 * aparecía. Ahora es un combobox con búsqueda SERVER-SIDE — estas pruebas fijan que (a) sin teclear
 * nada ya ofrece opciones y (b) lo tecleado viaja al API como `busqueda`.
 */
let ultimaQueryModelos: Record<string, unknown> | undefined;
const crearDesarrolloMutate = vi.fn();

vi.mock('@/api/modelos', () => ({
  useModelos: (query: Record<string, unknown>) => {
    ultimaQueryModelos = query;
    const busqueda = typeof query['busqueda'] === 'string' ? query['busqueda'] : '';
    const catalogo = [
      { id: 1, codigo: 'A-100', descripcion: 'Jogger niño' },
      { id: 2, codigo: 'Z-999', descripcion: 'Sudadera dama' },
    ];
    return {
      data: {
        datos:
          busqueda === ''
            ? catalogo
            : catalogo.filter(
                (m) => m.codigo.includes(busqueda) || m.descripcion.includes(busqueda),
              ),
      },
      isPending: false,
      isError: false,
    };
  },
  useCrearModelo: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/api/desarrollos', () => ({
  useCrearDesarrollo: () => ({ mutateAsync: crearDesarrolloMutate, isPending: false }),
}));

describe('<DialogoDesarrollo>', () => {
  beforeEach(() => {
    ultimaQueryModelos = undefined;
    crearDesarrolloMutate.mockReset();
    crearDesarrolloMutate.mockResolvedValue({ id: 9 });
  });

  it('el selector de modelo ofrece opciones SIN teclear nada (no arranca vacío)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoDesarrollo abierto alCambiarAbierto={() => {}} idProyecto={1} />, {
      sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']),
    });

    await usuario.click(screen.getByTestId('desarrollo-modelo-busqueda'));
    expect(await screen.findAllByTestId('desarrollo-modelo-opcion')).toHaveLength(2);
    // Sin texto no se manda `busqueda`: el servidor devuelve la primera página del catálogo.
    expect(ultimaQueryModelos?.['busqueda']).toBeUndefined();
  });

  it('lo tecleado se BUSCA EN EL SERVIDOR y al elegir se manda el modelo al alta', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoDesarrollo abierto alCambiarAbierto={() => {}} idProyecto={1} />, {
      sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']),
    });

    await usuario.type(screen.getByTestId('desarrollo-modelo-busqueda'), 'Z-999');
    await vi.waitFor(() => expect(ultimaQueryModelos?.['busqueda']).toBe('Z-999'));

    const opciones = await screen.findAllByTestId('desarrollo-modelo-opcion');
    expect(opciones).toHaveLength(1);
    // `fireEvent`: la lista vive en un PORTAL y en jsdom hereda el `pointer-events:none` de radix.
    fireEvent.mouseDown(opciones[0] as HTMLElement);

    await usuario.click(screen.getByTestId('guardar-desarrollo'));
    await vi.waitFor(() =>
      expect(crearDesarrolloMutate).toHaveBeenCalledWith({
        idProyecto: 1,
        cuerpo: { idModelo: 2 },
      }),
    );
  });
});
