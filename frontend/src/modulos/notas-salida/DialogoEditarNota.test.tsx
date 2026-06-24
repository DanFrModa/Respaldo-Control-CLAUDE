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
vi.mock('@/api/avios', () => ({
  useAvios: () => ({ data: { datos: [{ id: 3, clave: 'BOT-01', descripcion: 'Botón' }] } }),
}));
vi.mock('@/api/telas', () => ({
  useTelas: () => ({ data: { datos: [{ id: 7, nombre: 'Felpa francesa' }] } }),
}));
vi.mock('@/api/ordenes-consulta', () => ({
  useConsultaOrdenes: () => ({
    data: { datos: [{ id: 50, folio: 1001, codigoModelo: 'MOD-1', cliente: 'Cliente A' }] },
  }),
}));
// El editor de renglones usa el kardex de tela (para listar las salidas-a-orden).
vi.mock('@/api/inventario-materiales', () => ({
  useKardexTela: () => ({ data: { renglones: [] }, isPending: false }),
}));

describe('DialogoEditarNota (F4-E5)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    actualizarMutate.mockReset();
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
    fireEvent.change(screen.getByTestId('selector-avio-nota'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('cantidad-nota'), { target: { value: '5' } });

    const crear = screen.getByTestId('confirmar-nota');
    expect(crear).toBeEnabled();
    crear.click();
    expect(crearMutate).toHaveBeenCalledTimes(1);
    const cuerpo = crearMutate.mock.calls.at(0)?.[0] as { lineas: { idAvio?: number }[] };
    expect(cuerpo.lineas.at(0)?.idAvio).toBe(3);
  });

  it('un renglón de TELA sin salida-a-orden NO habilita crear (la tela exige el movimiento)', () => {
    renderConProveedores(
      <DialogoEditarNota abierto alCambiarAbierto={() => undefined} alGuardada={() => undefined} />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    fireEvent.change(screen.getByTestId('nota-maquilero'), { target: { value: '9' } });
    fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('selector-orden-nota'), { target: { value: '50' } });
    fireEvent.change(screen.getByTestId('tipo-material-nota'), { target: { value: 'tela' } });
    fireEvent.change(screen.getByTestId('selector-tela-nota'), { target: { value: '7' } });
    // No hay salidas-a-orden disponibles (kardex vacío) → no se puede elegir el movimiento.
    expect(screen.getByTestId('confirmar-nota')).toBeDisabled();
    expect(screen.getByTestId('sin-salidas-tela-nota')).toBeInTheDocument();
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
