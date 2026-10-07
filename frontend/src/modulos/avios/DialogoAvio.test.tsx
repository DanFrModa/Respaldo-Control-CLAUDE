import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Avio } from '@/api/avios';
import { renderConProveedores } from '@/pruebas/utilidades';

import { DialogoAvio } from './DialogoAvio';

/**
 * 🔒 Fila 0.249 parte B — la mitad «no pisar» del diálogo de avío.
 *
 * El servidor tapa los precios del avío a quien no los puede ver (`preciosOcultos: true`). Si ese
 * avío llegara a editarse, el formulario NUNCA vio el precio de referencia ni el de cada
 * proveedor: mandar `precioReferencia: null` lo BORRARÍA, y el grid de proveedores es SET-COMPLETO
 * (cada precio omitido se guarda `null`). Lo que se fija aquí: con precios tapados no viaja
 * ninguno de los dos; con precios visibles viajan los dos (el control, para que la primera no
 * pase en verde por un formulario que nunca los manda).
 */
const actualizarMutate = vi.fn();

vi.mock('@/api/avios', () => ({
  useCrearAvio: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarAvio: () => ({ mutate: actualizarMutate, isPending: false }),
}));

vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({
    data: { datos: [], total: 0, pagina: 1, porPagina: 100, totalPaginas: 0 },
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('@/modulos/cxp/SelectorProveedor', () => ({
  SelectorProveedor: () => null,
}));

function avio(sobre: Partial<Avio> = {}): Avio {
  return {
    id: 7,
    clave: 'BTN-07',
    descripcion: 'Botón 7',
    unidad: 'pza',
    presentacion: 'CAJA',
    favorito: false,
    cantFav: null,
    esGenerico: false,
    seCompraSinColor: false,
    precioReferencia: 1.5,
    proveedores: [
      {
        idProveedor: 1,
        nombreProveedor: 'Botones SA',
        precio: 0.5,
        condiciones: null,
        habitual: true,
        preciosOcultos: false,
      },
    ],
    preciosOcultos: false,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    ...sobre,
  };
}

describe('<DialogoAvio> y los precios tapados (fila 0.249 parte B)', () => {
  beforeEach(() => {
    actualizarMutate.mockReset();
  });

  it('con precios TAPADOS no pide ni manda el precio de referencia ni el grid de proveedores', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoAvio
        abierto
        alCambiarAbierto={vi.fn()}
        avio={avio({
          precioReferencia: null,
          preciosOcultos: true,
          proveedores: [
            {
              idProveedor: 1,
              nombreProveedor: 'Botones SA',
              precio: null,
              condiciones: null,
              habitual: true,
              preciosOcultos: true,
            },
          ],
        })}
      />,
    );

    expect(screen.queryByLabelText('Precio de referencia')).not.toBeInTheDocument();
    expect(screen.getByTestId('precios-avio-tapados')).toBeInTheDocument();
    await usuario.click(screen.getByTestId('guardar-avio'));

    await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    const args = actualizarMutate.mock.calls[0]?.[0] as { cuerpo: Record<string, unknown> };
    expect(args.cuerpo.clave).toBe('BTN-07');
    expect(args.cuerpo).not.toHaveProperty('precioReferencia');
    expect(args.cuerpo).not.toHaveProperty('proveedores');
  });

  it('con precios VISIBLES manda los dos, como siempre (control)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoAvio abierto alCambiarAbierto={vi.fn()} avio={avio()} />);

    await usuario.click(screen.getByTestId('guardar-avio'));

    await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    const args = actualizarMutate.mock.calls[0]?.[0] as {
      cuerpo: { precioReferencia?: number; proveedores?: { precio?: number }[] };
    };
    expect(args.cuerpo.precioReferencia).toBe(1.5);
    expect(args.cuerpo.proveedores?.[0]?.precio).toBe(0.5);
  });
});
