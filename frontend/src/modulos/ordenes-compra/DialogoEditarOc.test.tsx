import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoEditarOc } from './DialogoEditarOc';
import { ocDePrueba } from './fixtures';

/**
 * Pruebas del selector de PROVEEDOR del diálogo de OC (ajuste 07-ago-2026): la lista se acota al
 * rol que piden los renglones (solo telas → «Vende telas»; solo avíos → «Vende avíos»; mezclada o
 * libre → todos) y NUNCA pierde el proveedor ya capturado aunque no cumpla el rol vigente.
 */

// Espía del código de rol con el que el diálogo pide los proveedores + catálogo simulado por rol.
const { espiaRolProveedor } = vi.hoisted(() => ({ espiaRolProveedor: vi.fn() }));

const PROVEEDORES_POR_ROL: Record<string, { id: number; nombre: string }[]> = {
  'vende-telas': [{ id: 5, nombre: 'Telas del Norte' }],
  'vende-avios': [{ id: 9, nombre: 'Avíos Monterrey' }],
  // Sin acotar: el catálogo completo (incluye un maquilero, que no vende material).
  todos: [
    { id: 5, nombre: 'Telas del Norte' },
    { id: 9, nombre: 'Avíos Monterrey' },
    { id: 12, nombre: 'Taller Montaño' },
  ],
};

vi.mock('@/api/proveedores', () => ({
  COD_ROL_PROVEEDOR: { vendeTelas: 'vende-telas', vendeAvios: 'vende-avios' },
  useProveedoresPorRol: (codigo: string | undefined) => {
    espiaRolProveedor(codigo);
    return {
      data: { datos: PROVEEDORES_POR_ROL[codigo ?? 'todos'] ?? [] },
      isPending: false,
    };
  },
}));

vi.mock('@/api/ordenes-compra', () => ({
  useCrearOc: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarOc: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/telas', () => ({ useTelas: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/avios', () => ({ useAvios: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/colores', () => ({ useColores: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/tallas', () => ({ useTallasActivas: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/ordenes-consulta', () => ({
  useConsultaOrdenes: () => ({ data: { datos: [] } }),
}));

/** Renderiza el diálogo abierto (alta si no se pasa `oc`). */
function montar(oc?: ReturnType<typeof ocDePrueba>): void {
  renderConProveedores(
    <DialogoEditarOc
      abierto
      alCambiarAbierto={vi.fn()}
      alGuardada={vi.fn()}
      {...(oc === undefined ? {} : { oc })}
    />,
    { sesion: estadoSesionDePrueba(['compras.administrar']) },
  );
}

/** Nombres de las opciones del selector de proveedor (sin el placeholder). */
function opcionesProveedor(): string[] {
  const selector = screen.getByTestId('oc-proveedor');
  return within(selector)
    .getAllByRole('option')
    .map((opcion) => opcion.textContent ?? '')
    .filter((texto) => texto !== 'Elige un proveedor…');
}

describe('DialogoEditarOc · proveedor acotado por los renglones', () => {
  it('en una OC nueva (renglón de tela por defecto) solo lista proveedores de telas', () => {
    montar();
    expect(espiaRolProveedor).toHaveBeenCalledWith('vende-telas');
    expect(opcionesProveedor()).toEqual(['Telas del Norte']);
    expect(screen.getByTestId('oc-proveedor-ayuda')).toHaveTextContent('«Vende telas»');
  });

  it('al cambiar el renglón a avío, cambia a proveedores de avíos', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Tipo de material del renglón 1'), {
      target: { value: 'avio' },
    });
    expect(espiaRolProveedor).toHaveBeenCalledWith('vende-avios');
    expect(opcionesProveedor()).toEqual(['Avíos Monterrey']);
    expect(screen.getByTestId('oc-proveedor-ayuda')).toHaveTextContent('«Vende avíos»');
  });

  it('con renglones de tela Y de avío no acota: la OC mixta es legítima', () => {
    montar();
    fireEvent.click(screen.getByTestId('agregar-renglon-oc'));
    fireEvent.change(screen.getByLabelText('Tipo de material del renglón 2'), {
      target: { value: 'avio' },
    });
    expect(espiaRolProveedor).toHaveBeenCalledWith(undefined);
    expect(opcionesProveedor()).toEqual(['Telas del Norte', 'Avíos Monterrey', 'Taller Montaño']);
    expect(screen.queryByTestId('oc-proveedor-ayuda')).not.toBeInTheDocument();
  });

  it('conserva el proveedor ya capturado aunque no cumpla el rol vigente', () => {
    // OC migrada: su proveedor (id 12) no tiene el rol «Vende telas», pero la OC pide tela.
    montar(ocDePrueba({ idProveedor: 12, proveedor: 'Taller Montaño' }));
    const selector = screen.getByTestId('oc-proveedor');
    expect(selector).toHaveValue('12');
    expect(within(selector).getByRole('option', { name: 'Taller Montaño' })).toBeInTheDocument();
  });
});
