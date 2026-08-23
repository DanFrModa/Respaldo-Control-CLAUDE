import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderConProveedores } from '@/pruebas/utilidades';

import { DialogoDesautorizarOc } from './DialogoDesautorizarOc';
import { ocDePrueba } from './fixtures';

/**
 * ⭐ V1-E3y (§Post-F9.79) — el diálogo de DES-AUTORIZAR.
 *
 * Lo que fija: el **motivo es obligatorio** (el botón no se puede disparar en vacío, igual que en la
 * cancelación) y lo que se manda va **recortado**. Quitar la firma de una compra es tan grave como
 * cancelarla: un motivo en blanco —o de puros espacios— dejaría una bitácora que no explica nada.
 *
 * ⚠️ Esto NO es la defensa: el backend re-valida el motivo y el permiso (A1/A4). Aquí sólo se
 * comprueba que la pantalla no invite a mandar basura.
 */
const { desautorizarMutate } = vi.hoisted(() => ({ desautorizarMutate: vi.fn() }));

vi.mock('@/api/ordenes-compra', () => ({
  useDesautorizarOc: () => ({ mutate: desautorizarMutate, isPending: false }),
}));

describe('DialogoDesautorizarOc (V1-E3y)', () => {
  beforeEach(() => {
    desautorizarMutate.mockReset();
  });

  function abrir() {
    return renderConProveedores(
      <DialogoDesautorizarOc abierto alCambiarAbierto={vi.fn()} oc={ocDePrueba()} />,
    );
  }

  it('sin motivo el botón está deshabilitado y no se manda nada', () => {
    abrir();
    const boton = screen.getByTestId('confirmar-desautorizar-oc');
    expect(boton).toBeDisabled();
    fireEvent.click(boton);
    expect(desautorizarMutate).not.toHaveBeenCalled();
  });

  it('un motivo de puros espacios tampoco alcanza', () => {
    abrir();
    fireEvent.change(screen.getByTestId('oc-motivo-desautorizar'), { target: { value: '    ' } });
    expect(screen.getByTestId('confirmar-desautorizar-oc')).toBeDisabled();
    expect(desautorizarMutate).not.toHaveBeenCalled();
  });

  it('con motivo manda la mutación con el texto RECORTADO', () => {
    abrir();
    fireEvent.change(screen.getByTestId('oc-motivo-desautorizar'), {
      target: { value: '  me equivoqué de tela  ' },
    });
    fireEvent.click(screen.getByTestId('confirmar-desautorizar-oc'));
    expect(desautorizarMutate).toHaveBeenCalledWith(
      { id: ocDePrueba().id, cuerpo: { motivo: 'me equivoqué de tela' } },
      expect.anything(),
    );
  });
});
