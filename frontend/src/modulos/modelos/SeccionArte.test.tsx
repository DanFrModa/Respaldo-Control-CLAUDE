import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Arte } from '@/api/artes';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { SeccionArte } from './SeccionArte';

/**
 * Pruebas de la sección ARTE del modelo (V1-E3d, §Post-F9.35).
 *
 * Lo que se cuida aquí es lo que el usuario ve y dispara: que el PRIMER arte sea el principal
 * (rótulo + `data-principal`), que los demás ofrezcan tomar su lugar, que quitar y editar
 * existan por renglón, y que en SOLO LECTURA no haya ninguna acción. La capa de datos va
 * simulada (sin red).
 */
const eliminarMutate = vi.fn();
const marcarPrincipalMutate = vi.fn();

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/api/artes', () => ({
  useEliminarArte: () => ({ mutate: eliminarMutate, isPending: false }),
  useMarcarArtePrincipal: () => ({ mutate: marcarPrincipalMutate, isPending: false }),
  useCrearArte: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarArte: () => ({ mutate: vi.fn(), isPending: false }),
  useCopiarArte: () => ({ mutate: vi.fn(), isPending: false }),
  useGaleriaArte: () => ({ data: { datos: [] }, isPending: false, isError: false }),
  useFotoArte: () => ({ data: null, isPending: false, isError: false }),
  useSubirFotoArte: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarFotoArte: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] }, isPending: false }),
}));

/** Un arte del modelo con lo mínimo que la sección pinta. */
function arte(over: { id: number; nombre: string; precio?: number; proveedor?: string }): Arte {
  return {
    id: over.id,
    idModelo: 1,
    nombre: over.nombre,
    descripcion: null,
    puntadas: null,
    precio: over.precio ?? null,
    tipo: 'BORDADO',
    idProveedor: over.proveedor === undefined ? null : 7,
    proveedor: over.proveedor ?? null,
    idArchivoFoto: null,
    orden: 0,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

const DOS_ARTES = [
  arte({ id: 5, nombre: 'Logo', precio: 30, proveedor: 'Eurobordados' }),
  arte({ id: 6, nombre: 'Estampa', precio: 12 }),
];

describe('<SeccionArte>', () => {
  beforeEach(() => {
    eliminarMutate.mockReset();
    marcarPrincipalMutate.mockReset();
  });

  it('rotula el PRIMER arte como principal y solo ofrece la acción en los demás', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<SeccionArte idModelo={1} artes={DOS_ARTES} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    expect(screen.getByTestId('arte-principal-5')).toHaveTextContent('Principal');
    expect(screen.queryByTestId('arte-principal-6')).not.toBeInTheDocument();
    expect(screen.getByTestId('renglon-arte-5')).toHaveAttribute('data-principal', 'si');
    expect(screen.queryByTestId('marcar-principal-arte-5')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('marcar-principal-arte-6'));
    expect(marcarPrincipalMutate).toHaveBeenCalledTimes(1);
    expect(marcarPrincipalMutate.mock.calls[0]?.[0]).toEqual({ idModelo: 1, idArte: 6 });
  });

  it('muestra el precio y el proveedor del arte (los datos que ahora viven en el modelo)', () => {
    renderConProveedores(<SeccionArte idModelo={1} artes={DOS_ARTES} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    expect(screen.getByTestId('renglon-arte-5')).toHaveTextContent('$30.00');
    expect(screen.getByTestId('renglon-arte-5')).toHaveTextContent('Eurobordados');
    expect(screen.getByTestId('renglon-arte-6')).toHaveTextContent('$12.00');
  });

  it('quitar un arte llama al backend con el modelo y el arte', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<SeccionArte idModelo={1} artes={DOS_ARTES} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.click(screen.getByTestId('quitar-arte-6'));
    expect(eliminarMutate).toHaveBeenCalledTimes(1);
    expect(eliminarMutate.mock.calls[0]?.[0]).toEqual({ idModelo: 1, idArte: 6 });
  });

  it('ofrece «copiar arte de otro modelo» (la conveniencia que daba el catálogo)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<SeccionArte idModelo={1} artes={DOS_ARTES} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.click(screen.getByTestId('abrir-copiar-arte'));
    expect(screen.getByTestId('dialogo-copiar-arte')).toBeInTheDocument();
  });

  it('en SOLO LECTURA se ve el rótulo pero ninguna acción', () => {
    renderConProveedores(<SeccionArte idModelo={1} artes={DOS_ARTES} puedeAdministrar={false} />, {
      sesion: estadoSesionDePrueba(['modelos.ver']),
    });

    expect(screen.getByTestId('arte-principal-5')).toBeInTheDocument();
    expect(screen.queryByTestId('agregar-arte')).not.toBeInTheDocument();
    expect(screen.queryByTestId('marcar-principal-arte-6')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quitar-arte-6')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editar-arte-6')).not.toBeInTheDocument();
  });

  it('sin arte muestra el vacío explicativo', () => {
    renderConProveedores(<SeccionArte idModelo={1} artes={[]} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });
    expect(screen.getByText('El modelo no tiene arte.')).toBeInTheDocument();
  });
});
