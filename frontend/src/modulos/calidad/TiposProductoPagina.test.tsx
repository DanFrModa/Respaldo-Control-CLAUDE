import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TipoProducto } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TiposProductoPagina } from './TiposProductoPagina';

/**
 * ⭐⭐ V1-E8t, ronda de corrección (§Post-F9.145) — **EL DESTINO DE LA PUERTA «Capturar el dígito».**
 *
 * Esta pantalla **no tenía ni una prueba**, y desde esta etapa es load-bearing: el diálogo de alta de
 * desarrollo pinta un botón que promete que **aquí** se puede capturar el dígito. Si su reja midiera
 * distinto que la puerta, ese botón llevaría a una pantalla sin acciones — la promesa rota que la
 * etapa vino a cerrar. Las dos miden con `puedeAdministrarTiposProducto`, y esto lo ancla.
 */
const tipos: TipoProducto[] = [
  {
    id: 4,
    nombre: 'Pantalón',
    digitoConcepto: 7,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  },
  {
    id: 6,
    nombre: 'Ropa interior',
    digitoConcepto: null,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  },
];

vi.mock('@/api/calidad', () => ({
  useTiposProducto: () => ({
    data: { datos: tipos, total: 2, pagina: 1, porPagina: 10, totalPaginas: 1 },
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDesactivarTipoProducto: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivarTipoProducto: () => ({ mutate: vi.fn(), isPending: false }),
  useCrearTipoProducto: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarTipoProducto: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('<TiposProductoPagina> · el destino de la puerta (V1-E8t)', () => {
  it('⭐ a quien llega por la puerta (ve Calidad y administra su catálogo) le deja capturar', () => {
    renderConProveedores(<TiposProductoPagina />, {
      sesion: estadoSesionDePrueba(['calidad.ver', 'calidad.administrar-catalogo']),
    });

    // Lo que la puerta prometió: aquí hay dónde apretar.
    expect(screen.getByTestId('nuevo-tipo-producto')).toBeInTheDocument();
    // Y el que no tiene dígito se distingue a simple vista (por eso se vino hasta acá).
    expect(screen.getByText(/Ropa interior/)).toBeInTheDocument();
  });

  it('sin `calidad.administrar-catalogo` la pantalla es de sólo lectura (misma reja que la puerta)', () => {
    renderConProveedores(<TiposProductoPagina />, {
      sesion: estadoSesionDePrueba(['calidad.ver']),
    });

    expect(screen.queryByTestId('nuevo-tipo-producto')).not.toBeInTheDocument();
    // Ver sí se puede: §Post-F9.68 es esconder la ACCIÓN, no el dato.
    expect(screen.getByText(/Ropa interior/)).toBeInTheDocument();
  });
});
