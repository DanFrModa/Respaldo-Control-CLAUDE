import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ClavePermiso } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CapturaProductividadPagina } from './CapturaProductividadPagina';

/**
 * CAPTURA de productividad — §Post-F9.68 (esconder, no negar): sin
 * `indicadores.fecha-libre` NO se pinta un campo de fecha apagado con un letrero
 * al lado explicando el permiso; se pinta la fecha (que mueven los atajos) y ya.
 *
 * Las dos pruebas van EN PAREJA: sin el permiso el campo editable no está, CON
 * el permiso sí. La negativa sola pasaría igual si la pantalla no montara.
 */

vi.mock('@/api/productividad', () => ({
  useActividades: () => ({ data: { datos: [] }, isPending: false, isError: false, error: null }),
  usePersonal: () => ({ data: { datos: [] }, isPending: false, isError: false, error: null }),
  useRegistrosProductividad: () => ({
    data: { datos: [] },
    isPending: false,
    isError: false,
    error: null,
  }),
  useRegistrarProductividad: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarRegistroProductividad: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/components/dominio/FiltroCliente', () => ({
  FiltroCliente: () => null,
}));

const BASE: ClavePermiso[] = ['indicadores.ip-productividad'];

function render(permisos: ClavePermiso[]): void {
  renderConProveedores(<CapturaProductividadPagina />, {
    sesion: estadoSesionDePrueba(permisos),
    rutaInicial: '/indicadores/productividad/captura',
  });
}

describe('CapturaProductividadPagina · fecha libre', () => {
  it('SIN indicadores.fecha-libre la fecha no es editable y nada menciona el permiso', () => {
    render(BASE);
    const campo = screen.getByTestId('cap-fecha');
    expect(campo).toHaveAttribute('readonly');
    expect(campo).not.toHaveAttribute('disabled');
    expect(screen.queryByText(/permiso/i)).toBeNull();
    // Los atajos siguen ahí: se captura igual, solo que sin fecha libre.
    expect(screen.getByRole('button', { name: 'Hoy' })).toBeInTheDocument();
  });

  it('CON indicadores.fecha-libre la fecha sí es editable (gemela positiva)', () => {
    render([...BASE, 'indicadores.fecha-libre']);
    const campo = screen.getByTestId('cap-fecha');
    expect(campo).not.toHaveAttribute('readonly');
    expect(campo).toHaveAttribute('type', 'date');
  });
});
