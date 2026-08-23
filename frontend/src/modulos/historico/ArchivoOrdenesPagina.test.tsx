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
            cortadores: 'Oscar Aragón',
            maquileros: 'Taller Montaño · Taller Sosa',
            estampadores: 'Serigrafía López',
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
            cortadores: 'Oscar Aragón',
            maquileros: 'Taller Montaño · Taller Sosa',
            estampadores: 'Serigrafía López',
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
            // V1-E3d (§Post-F9.43(e)): lo que la orden llevó de verdad, con su precio de ESE día.
            habilitacion: [
              { avio: 'Etiqueta de lavado', claveV1: 'E01', cantidad: 1, precio: 0.15 },
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
    // §Post-F9.27: la columna muestra TODOS los talleres de costura, no solo el de la cabecera.
    expect(screen.getByText('Taller Montaño · Taller Sosa')).toBeInTheDocument();
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
    // Los tres roles completos, en campo abierto: quién cortó, quién cosió y quién estampó.
    expect(screen.getByText('Cortaron')).toBeInTheDocument();
    expect(screen.getByText('Estamparon')).toBeInTheDocument();
    expect(screen.getByText('Serigrafía López')).toBeInTheDocument();
    // Y el taller que cortó viene como TEXTO del archivo, no de un catálogo.
    expect(screen.getAllByText('Oscar Aragón').length).toBeGreaterThan(0);
    expect(screen.getByText(/Orden 9876 del sistema anterior/)).toBeInTheDocument();
    // V1-E3d: la habilitación del viejo se ve (con su precio del día) y se dice que es SOLO texto.
    expect(screen.getByText('Etiqueta de lavado')).toBeInTheDocument();
    expect(screen.getByText('$0.15')).toBeInTheDocument();
    expect(screen.getByText(/no forman parte del catálogo de avíos/)).toBeInTheDocument();
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
