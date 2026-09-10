import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EstadoLista } from '@/api/estados-lista';
import type { ListaDetalle } from '@/api/listas-precios';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { SelectorEstadoLista } from './SelectorEstadoLista';

const cambiarMutate = vi.fn();

let estados: { data: { datos: EstadoLista[] } };

vi.mock('@/api/estados-lista', () => ({
  useEstadosLista: () => estados,
}));
vi.mock('@/api/negociacion', () => ({
  useCambiarEstadoLista: () => ({ mutate: cambiarMutate, isPending: false }),
}));

function estado(
  over: Partial<EstadoLista> & Pick<EstadoLista, 'id' | 'codigo' | 'nombre'>,
): EstadoLista {
  return {
    orden: 1,
    esCierre: false,
    activo: true,
    creadoEn: '2026-07-06T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-07-06T00:00:00.000Z',
    modificadoPorId: null,
    ...over,
  };
}

function lista(idEstadoLista: number, nombreEstado: string): ListaDetalle {
  return {
    id: 5,
    folio: 1,
    idCliente: 1,
    nombreCliente: 'C&A',
    idClienteDepartamento: 1,
    nombreDepartamento: 'NIÑOS',
    fecha: '2026-07-06',
    idEstadoLista,
    codigoEstado: 'cerrada',
    nombreEstado,
    margenPct: 50,
    descuentosPct: 10,
    regaliasPct: 5,
    costoVentasPct: 5,
    notas: null,
    // ⭐ V1-E8y: el LUGAR de la cita (§Post-F9.152).
    lugar: null,
    lineas: [],
    creadoEn: '2026-07-06T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-07-06T00:00:00.000Z',
    modificadoPorId: null,
  };
}

describe('<SelectorEstadoLista>', () => {
  beforeEach(() => {
    cambiarMutate.mockReset();
    estados = {
      data: {
        datos: [
          estado({ id: 1, codigo: 'abierta', nombre: 'Abierta' }),
          estado({ id: 3, codigo: 'cerrada', nombre: 'Cerrada', esCierre: true }),
        ],
      },
    };
  });

  it('permite REABRIR una lista cerrada moviéndola a un estado abierto', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<SelectorEstadoLista lista={lista(3, 'Cerrada')} />, {
      sesion: estadoSesionDePrueba(['listas.negociar']),
    });

    // La opción del estado ACTUAL (cerrada) no aparece como destino; sí la de abrir.
    await usuario.selectOptions(screen.getByTestId('nuevo-estado-lista'), '1');
    await usuario.click(screen.getByTestId('confirmar-estado-lista'));

    expect(cambiarMutate).toHaveBeenCalledTimes(1);
    expect(cambiarMutate).toHaveBeenCalledWith(
      { id: 5, cuerpo: { idEstadoLista: 1 } },
      expect.anything(),
    );
  });

  it('el botón anuncia "Cerrar lista" cuando el destino es de cierre', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<SelectorEstadoLista lista={lista(1, 'Abierta')} />, {
      sesion: estadoSesionDePrueba(['listas.negociar']),
    });
    await usuario.selectOptions(screen.getByTestId('nuevo-estado-lista'), '3');
    expect(screen.getByTestId('confirmar-estado-lista')).toHaveTextContent('Cerrar lista');
  });
});
