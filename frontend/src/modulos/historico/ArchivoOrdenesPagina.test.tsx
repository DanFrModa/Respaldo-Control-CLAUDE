import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ArchivoOrdenesPagina } from './ArchivoOrdenesPagina';

const { espiaQuery } = vi.hoisted(() => ({ espiaQuery: vi.fn() }));

vi.mock('@/api/historico-ordenes', () => ({
  useHistoricoOrdenes: (query: unknown) => {
    espiaQuery(query);
    return {
      data: {
        datos: [
          {
            id: 1,
            numero: '12345',
            fecha: '2019-05-04',
            fechaEntrega: '2019-06-01',
            idModelo: 7,
            modelo: 'M-900',
            descripcionModelo: 'Sudadera cerrada',
            tipoProducto: 'Sudadera',
            genero: 'Caballero',
            cliente: 'C&A',
            maquilero: 'Taller Montaño',
            etiquetaMarca: 'Marilyn',
            totalPiezas: 1200,
            cancelada: false,
          },
        ],
        total: 1,
        pagina: 1,
        porPagina: 25,
      },
      isPending: false,
      isFetching: false,
      isError: false,
    };
  },
  useHistoricoOrden: (id: number | null) => ({
    data:
      id === null
        ? undefined
        : {
            id,
            numero: '12345',
            fecha: '2019-05-04',
            fechaEntrega: '2019-06-01',
            idModelo: 7,
            modelo: 'M-900',
            descripcionModelo: 'Sudadera cerrada',
            tipoProducto: 'Sudadera',
            genero: 'Caballero',
            cliente: 'C&A',
            maquilero: 'Taller Montaño',
            etiquetaMarca: 'Marilyn',
            totalPiezas: 1200,
            cancelada: false,
            tela: 'Felpa Perchada',
            composicion: '60/40',
            observaciones: null,
            motivoCancelada: null,
            idOrdenV1: '9876',
            lineas: [{ color: 'MARINO', talla: 'M', cantidad: 300 }],
            procesos: [
              {
                tipo: 'corte',
                fecha: '2019-05-06',
                tercero: 'Oscar Aragón',
                cantidad: 1200,
                observaciones: null,
              },
            ],
          },
    isPending: false,
  }),
}));

vi.mock('@/api/calidad', () => ({
  useTiposProductoActivos: () => ({ data: { datos: [{ id: 3, nombre: 'Sudadera' }] } }),
}));

describe('<ArchivoOrdenesPagina> (§Post-F9.26)', () => {
  const sesion = estadoSesionDePrueba(['ordenes.ver']);

  it('lista las órdenes viejas y NO ofrece crear ni editar (es solo consulta)', () => {
    renderConProveedores(<ArchivoOrdenesPagina />, { sesion });

    expect(screen.getByText('12345')).toBeInTheDocument();
    expect(screen.getByText('Taller Montaño')).toBeInTheDocument();
    // Nada de alta: el archivo se llena con el ETL, no desde la aplicación.
    expect(screen.queryByRole('button', { name: /nuev/i })).toBeNull();
  });

  it('el número de orden abre la ficha con la matriz y quién la trabajó', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ArchivoOrdenesPagina />, { sesion });

    await usuario.click(screen.getByTestId('abrir-orden-historica'));

    await waitFor(() => {
      expect(screen.getByText('Colores y tallas')).toBeInTheDocument();
    });
    expect(screen.getByText('MARINO')).toBeInTheDocument();
    // El taller que cortó viene como TEXTO del archivo, no de un catálogo.
    expect(screen.getByText('Oscar Aragón')).toBeInTheDocument();
    expect(screen.getByText(/Orden 9876 del sistema anterior/)).toBeInTheDocument();
  });

  it('filtrar por maquilero llega al servidor y regresa a la página 1', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ArchivoOrdenesPagina />, { sesion });

    await usuario.type(screen.getByTestId('hist-maquilero'), 'Montaño');

    await waitFor(() => {
      expect(espiaQuery).toHaveBeenCalledWith(
        expect.objectContaining({ maquilero: 'Montaño', pagina: 1 }),
      );
    });
  });
});
