import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as ReactRouter from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

/**
 * Pruebas de la CAPTURA de una entrada de tela por factura/remisión (etapa B1): la cabecera del
 * documento + los renglones (partidas) se mandan juntos y el documento nace en BORRADOR (no toca
 * el inventario hasta confirmarse desde la lista). Sin renglones o sin número de documento, el
 * botón no deja guardar.
 */

const crearMutate = vi.fn();
const actualizarMutate = vi.fn();
const navegar = vi.fn();
const useEntradaTelaMock = vi.fn();

vi.mock('@/api/entradas-tela', () => ({
  useCrearEntradaTela: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarEntradaTela: () => ({ mutate: actualizarMutate, isPending: false }),
  useEntradaTela: (id: unknown) => useEntradaTelaMock(id) as unknown,
}));
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({
    data: { datos: [{ id: 2, nombre: 'Bodega Telas' }], total: 1 },
    isPending: false,
    isError: false,
  }),
}));
// Espía del código de rol con el que la captura pide los proveedores (debe ser "vende-telas").
const { espiaRolProveedor } = vi.hoisted(() => ({ espiaRolProveedor: vi.fn() }));
vi.mock('@/api/proveedores', () => ({
  COD_ROL_PROVEEDOR: { vendeTelas: 'vende-telas', vendeAvios: 'vende-avios' },
  useProveedoresPorRol: (codigo: string | undefined) => {
    espiaRolProveedor(codigo);
    // El backend ya filtró por rol: solo llegan proveedores de telas.
    return {
      data: { datos: [{ id: 3, nombre: 'Textiles del Norte' }], total: 1 },
      isPending: false,
      isError: false,
    };
  },
}));
vi.mock('react-router-dom', async () => {
  const real = await vi.importActual<typeof ReactRouter>('react-router-dom');
  return { ...real, useNavigate: () => navegar, useParams: () => ({}) };
});
// La captura de renglones se simula: un botón que emite un renglón ya armado.
vi.mock('./CapturaRenglonesTelaColor', () => ({
  CapturaRenglonesTelaColor: ({ onChange }: { onChange: (renglones: unknown[]) => void }) => (
    <button
      type="button"
      data-testid="agregar-renglon"
      onClick={() =>
        onChange([
          {
            idTelaColor: 71,
            tela: 'Felpa Suiza',
            color: 'Marino',
            nombreComplemento: 'Cardigan',
            cantidad: 300,
            cantidadComplemento: 45,
            loteProveedor: 'L-A',
            precioUnit: 90,
            precioUnitComplemento: 120,
          },
        ])
      }
    >
      agregar renglón
    </button>
  ),
}));

const { CapturaEntradaTelaPagina } = await import('./CapturaEntradaTelaPagina');

describe('CapturaEntradaTelaPagina (B1)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    actualizarMutate.mockReset();
    navegar.mockReset();
    useEntradaTelaMock.mockReset();
    useEntradaTelaMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
  });

  it('manda cabecera + renglones (con precios y lote del proveedor) al guardar el borrador', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });

    await usuario.selectOptions(screen.getByTestId('entrada-tipo'), 'remision');
    await usuario.type(screen.getByTestId('entrada-numero'), 'R-2200');
    await usuario.selectOptions(screen.getByTestId('entrada-proveedor'), '3');
    await usuario.selectOptions(screen.getByTestId('entrada-almacen'), '2');
    await usuario.click(screen.getByTestId('agregar-renglon'));
    await usuario.click(screen.getByTestId('entrada-guardar'));

    expect(crearMutate).toHaveBeenCalledTimes(1);
    expect(crearMutate.mock.calls[0]?.[0]).toMatchObject({
      tipoDocumento: 'remision',
      numeroDocumento: 'R-2200',
      idProveedor: 3,
      idAlmacen: 2,
      lineas: [
        {
          idTelaColor: 71,
          cantidad: 300,
          cantidadComplemento: 45,
          loteProveedor: 'L-A',
          precioUnit: 90,
          precioUnitComplemento: 120,
        },
      ],
    });
  });

  it('sin número de documento o sin renglones no deja guardar', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    await usuario.selectOptions(screen.getByTestId('entrada-proveedor'), '3');
    await usuario.selectOptions(screen.getByTestId('entrada-almacen'), '2');
    // Sin número NI renglones.
    expect(screen.getByTestId('entrada-guardar')).toBeDisabled();
    await usuario.type(screen.getByTestId('entrada-numero'), 'A-1');
    // Con número pero sin renglones sigue deshabilitado.
    expect(screen.getByTestId('entrada-guardar')).toBeDisabled();
  });

  it('un documento CONFIRMADO no se edita: avisa y bloquea la captura (no muere con 409)', () => {
    useEntradaTelaMock.mockReturnValue({
      data: {
        id: 5,
        folio: 12,
        estatus: 'confirmada',
        tipoDocumento: 'factura',
        numeroDocumento: 'A-1001',
        idProveedor: 3,
        fecha: '2026-08-06',
        idAlmacen: 2,
        observaciones: null,
        avisos: [],
        lineas: [],
      },
      isPending: false,
      isError: false,
    });
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    expect(screen.getByTestId('entrada-no-editable')).toHaveTextContent('confirmada');
    expect(screen.getByTestId('entrada-numero')).toBeDisabled();
    expect(screen.getByTestId('entrada-guardar')).toBeDisabled();
  });

  it('el AVISO de factura repetida se muestra al editar (informa, no bloquea)', () => {
    useEntradaTelaMock.mockReturnValue({
      data: {
        id: 5,
        folio: 12,
        estatus: 'borrador',
        tipoDocumento: 'factura',
        numeroDocumento: 'A-1001',
        idProveedor: 3,
        fecha: '2026-08-06',
        idAlmacen: 2,
        observaciones: null,
        avisos: ['Ojo: ya hay otra entrada de este proveedor con el documento "A-1001" (folio 7).'],
        lineas: [],
      },
      isPending: false,
      isError: false,
    });
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    expect(screen.getByTestId('entrada-aviso')).toHaveTextContent('A-1001');
    // No bloquea: los campos siguen editables.
    expect(screen.getByTestId('entrada-numero')).toBeEnabled();
  });

  it('sin `inventario-telas.mover` la captura queda deshabilitada', () => {
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    expect(screen.getByTestId('entrada-numero')).toBeDisabled();
    expect(screen.getByTestId('entrada-guardar')).toBeDisabled();
  });

  it('solo ofrece proveedores con el rol «Vende telas» (decisión P.2)', () => {
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    // La lista se pide ACOTADA al rol: el filtro lo aplica el servidor, no la pantalla.
    expect(espiaRolProveedor).toHaveBeenCalledWith('vende-telas');
    const selector = screen.getByTestId('entrada-proveedor');
    expect(
      within(selector).getByRole('option', { name: 'Textiles del Norte' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('entrada-proveedor-ayuda')).toHaveTextContent('«Vende telas»');
  });

  it('al EDITAR conserva el proveedor capturado aunque no traiga el rol', () => {
    // Documento viejo cuyo proveedor (id 99) no aparece en la lista acotada.
    useEntradaTelaMock.mockReturnValue({
      data: {
        id: 5,
        folio: 12,
        estatus: 'borrador',
        tipoDocumento: 'factura',
        numeroDocumento: 'A-1001',
        idProveedor: 99,
        proveedor: 'Taller Montaño',
        fecha: '2026-08-06',
        idAlmacen: 2,
        observaciones: null,
        avisos: [],
        lineas: [],
      },
      isPending: false,
      isError: false,
    });
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    const selector = screen.getByTestId('entrada-proveedor');
    expect(selector).toHaveValue('99');
    expect(within(selector).getByRole('option', { name: 'Taller Montaño' })).toBeInTheDocument();
  });
});
