import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ReglasDuracionPagina } from './ReglasDuracionPagina';

// `vi.hoisted` para que los datos existan cuando la fábrica de `vi.mock` corra (la fábrica se
// iza por encima de las declaraciones de módulo).
const datos = vi.hoisted(() => {
  const aud = {
    activo: true,
    creadoEn: '2026-06-22T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-06-22T00:00:00.000Z',
    modificadoPorId: null,
  };
  return {
    factores: [{ id: 1, deCant: 1, aCant: 500, factor: 0.6, ...aud }],
    telas: [{ id: 1, nombre: 'Existencia', dias: 2, factorTela: 0.07, ...aud }],
    aplicaciones: [
      { id: 1, nombre: 'Estampado Sencillo', clave: 'A1', dias: 3, factor: null, ...aud },
    ],
  };
});

vi.mock('@/api/ruta-critica-plantillas', () => {
  const lista =
    <T,>(data: T[]) =>
    () => ({ data, isPending: false, isError: false, error: null });
  const mut = () => ({ mutate: vi.fn(), isPending: false });
  return {
    useFactoresCantidadRc: lista(datos.factores),
    useDuracionesTelaRc: lista(datos.telas),
    useDuracionesAplicacionRc: lista(datos.aplicaciones),
    useCrearFactorCantidadRc: mut,
    useActualizarFactorCantidadRc: mut,
    useDesactivarFactorCantidadRc: mut,
    useCrearDuracionTelaRc: mut,
    useActualizarDuracionTelaRc: mut,
    useDesactivarDuracionTelaRc: mut,
    useCrearDuracionAplicacionRc: mut,
    useActualizarDuracionAplicacionRc: mut,
    useDesactivarDuracionAplicacionRc: mut,
  };
});

describe('ReglasDuracionPagina', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('muestra la pestaña de cantidad por defecto y permite cambiar a tela y aplicación', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ReglasDuracionPagina />, {
      sesion: estadoSesionDePrueba(['rc.catalogo-ver', 'rc.catalogo-administrar']),
    });

    // Pestaña cantidad: muestra el rango.
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByTestId('nuevo-factor')).toBeInTheDocument();

    // Cambia a "Por tipo de tela".
    await usuario.click(screen.getByTestId('tab-tela'));
    expect(screen.getByText('Existencia')).toBeInTheDocument();

    // Cambia a "Por aplicación".
    await usuario.click(screen.getByTestId('tab-aplicacion'));
    expect(screen.getByText('Estampado Sencillo')).toBeInTheDocument();
  });

  it('sin permiso de administrar oculta el botón de alta', () => {
    renderConProveedores(<ReglasDuracionPagina />, {
      sesion: estadoSesionDePrueba(['rc.catalogo-ver']),
    });
    expect(screen.queryByTestId('nuevo-factor')).not.toBeInTheDocument();
  });
});
