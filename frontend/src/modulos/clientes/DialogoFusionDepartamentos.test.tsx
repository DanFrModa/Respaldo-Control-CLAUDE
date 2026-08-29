/**
 * Tests del diálogo de FUSIÓN de departamentos duplicados (§Post-F9.122a).
 *
 * ⭐ Lo que importa aquí no es que pinte bonito: es que **el impacto que enseña venga del servidor**,
 * no de una cuenta propia. Por eso el mock de `usePreviaFusionDepartamentos` devuelve totales que NO
 * se pueden derivar de la lista de departamentos que recibe el componente: si algún día alguien
 * "optimiza" el diálogo calculando el impacto en el cliente, estas aserciones se ponen rojas.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { ClienteDepartamento, FusionDepartamentosPrevia } from '@/api/tipos';

const fusionarMutate = vi.fn();
let previa: {
  data: FusionDepartamentosPrevia | undefined;
  isPending: boolean;
  isError: boolean;
  error: { message: string } | null;
};

vi.mock('@/api/clientes', () => ({
  useFusionarDepartamentos: () => ({ mutate: fusionarMutate, isPending: false }),
  usePreviaFusionDepartamentos: () => previa,
}));

const { DialogoFusionDepartamentos } = await import('./DialogoFusionDepartamentos');

function departamento(id: number, nombre: string, activo = true): ClienteDepartamento {
  return {
    id,
    idCliente: 1,
    nombre,
    activo,
    creadoEn: '2026-08-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-08-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

const DEPARTAMENTOS = [
  departamento(1, 'Caballeros'),
  departamento(2, '2-HOMBRE'),
  departamento(3, 'VARONIL'),
];

function pintar(): void {
  render(
    <DialogoFusionDepartamentos
      abierto
      alCambiarAbierto={vi.fn()}
      idCliente={1}
      departamentos={DEPARTAMENTOS}
    />,
  );
}

beforeEach(() => {
  fusionarMutate.mockReset();
  previa = { data: undefined, isPending: false, isError: false, error: null };
});

describe('<DialogoFusionDepartamentos>', () => {
  it('no deja confirmar hasta que hay canónico Y al menos un duplicado marcado', async () => {
    const usuario = userEvent.setup();
    pintar();

    expect(screen.getByTestId('fusion-depto-confirmar')).toBeDisabled();

    await usuario.selectOptions(screen.getByTestId('fusion-depto-destino'), '1');
    expect(screen.getByTestId('fusion-depto-confirmar')).toBeDisabled(); // canónico solo: no basta

    await usuario.click(screen.getByTestId('fusion-depto-origen-opcion-2'));
    expect(screen.getByTestId('fusion-depto-confirmar')).toBeEnabled();
  });

  it('el canónico elegido desaparece de la lista de duplicados (no se puede absorber a sí mismo)', async () => {
    const usuario = userEvent.setup();
    pintar();

    await usuario.selectOptions(screen.getByTestId('fusion-depto-destino'), '1');

    expect(screen.queryByTestId('fusion-depto-origen-opcion-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('fusion-depto-origen-opcion-2')).toBeInTheDocument();
    expect(screen.getByTestId('fusion-depto-origen-opcion-3')).toBeInTheDocument();
  });

  it('⭐ enseña el impacto TAL COMO LO CUENTA EL SERVIDOR (no lo calcula por su cuenta)', async () => {
    const usuario = userEvent.setup();
    // Cuentas imposibles de derivar del arreglo de departamentos: si el diálogo las inventara,
    // estos números no podrían salir.
    previa = {
      data: {
        destino: { id: 1, nombre: 'Caballeros' },
        origenes: [
          {
            id: 2,
            nombre: '2-HOMBRE',
            usos: [{ relacion: 'proyectos', etiqueta: 'proyectos de desarrollo', cuenta: 7 }],
            factoresSeDescartan: false,
          },
        ],
        totales: [
          { relacion: 'proyectos', etiqueta: 'proyectos de desarrollo', cuenta: 7 },
          { relacion: 'listasPrecios', etiqueta: 'listas de precios', cuenta: 3 },
        ],
      },
      isPending: false,
      isError: false,
      error: null,
    };
    pintar();

    await usuario.selectOptions(screen.getByTestId('fusion-depto-destino'), '1');
    await usuario.click(screen.getByTestId('fusion-depto-origen-opcion-2'));

    const impacto = screen.getByTestId('fusion-depto-impacto');
    expect(impacto).toHaveTextContent('7');
    expect(impacto).toHaveTextContent('proyectos de desarrollo');
    expect(impacto).toHaveTextContent('3');
    expect(impacto).toHaveTextContent('listas de precios');
  });

  it('⚖️ AVISA de la colisión de factores ANTES de apretar, y dice que ganan los del que se queda', async () => {
    const usuario = userEvent.setup();
    previa = {
      data: {
        destino: { id: 1, nombre: 'Caballeros' },
        origenes: [{ id: 2, nombre: '2-HOMBRE', usos: [], factoresSeDescartan: true }],
        totales: [],
      },
      isPending: false,
      isError: false,
      error: null,
    };
    pintar();

    await usuario.selectOptions(screen.getByTestId('fusion-depto-destino'), '1');
    await usuario.click(screen.getByTestId('fusion-depto-origen-opcion-2'));

    const aviso = screen.getByTestId('fusion-depto-aviso-factores');
    expect(aviso).toHaveTextContent('factores de precio propios');
    expect(aviso).toHaveTextContent('Caballeros');
    expect(aviso).toHaveTextContent('bitácora');
  });

  it('sin colisión NO enseña el aviso de factores (gemela negativa)', async () => {
    const usuario = userEvent.setup();
    previa = {
      data: {
        destino: { id: 1, nombre: 'Caballeros' },
        origenes: [{ id: 2, nombre: '2-HOMBRE', usos: [], factoresSeDescartan: false }],
        totales: [],
      },
      isPending: false,
      isError: false,
      error: null,
    };
    pintar();

    await usuario.selectOptions(screen.getByTestId('fusion-depto-destino'), '1');
    await usuario.click(screen.getByTestId('fusion-depto-origen-opcion-2'));

    expect(screen.queryByTestId('fusion-depto-aviso-factores')).not.toBeInTheDocument();
  });

  it('manda la fusión con el canónico y TODOS los duplicados marcados', async () => {
    const usuario = userEvent.setup();
    pintar();

    await usuario.selectOptions(screen.getByTestId('fusion-depto-destino'), '1');
    await usuario.click(screen.getByTestId('fusion-depto-origen-opcion-2'));
    await usuario.click(screen.getByTestId('fusion-depto-origen-opcion-3'));
    await usuario.click(screen.getByTestId('fusion-depto-confirmar'));

    expect(fusionarMutate).toHaveBeenCalledWith(
      { idCliente: 1, cuerpo: { idDestino: 1, origenes: [2, 3] } },
      expect.anything(),
    );
  });
});
