import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DirectorioTercerosPagina } from './DirectorioTercerosPagina';

const { espiaQuery } = vi.hoisted(() => ({ espiaQuery: vi.fn() }));

vi.mock('@/api/directorio-terceros', () => ({
  useDirectorioTerceros: (query: unknown) => {
    espiaQuery(query);
    return {
      data: {
        datos: [
          {
            id: 1,
            fuente: 'Maquileros',
            nombre: 'Taller Montaño',
            corto: 'MONT',
            razonSocial: null,
            telefono: '55-1234-5678',
            contacto: 'Sra. Montaño',
            direccion: 'Calle 5 #12, Naucalpan',
            notas: 'Paga los viernes',
            servicios: 'Costura',
            ultimaActividad: '2021-08-14',
            documentos: 47,
            enCatalogo: false,
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
}));

describe('<DirectorioTercerosPagina> (§Post-F9.28)', () => {
  const sesion = estadoSesionDePrueba(['proveedores.ver']);

  it('muestra el teléfono y la dirección del taller depurado', () => {
    renderConProveedores(<DirectorioTercerosPagina />, { sesion });

    expect(screen.getByText('Taller Montaño')).toBeInTheDocument();
    expect(screen.getByText('55-1234-5678')).toBeInTheDocument();
    expect(screen.getByText('Calle 5 #12, Naucalpan')).toBeInTheDocument();
    // Cuándo fue la última vez que se trabajó con él: es lo que decide si sigue sirviendo.
    expect(screen.getByText('2021-08-14')).toBeInTheDocument();
  });

  it('NO deja crear ni pasar nada al catálogo (esa puerta queda cerrada a propósito)', () => {
    renderConProveedores(<DirectorioTercerosPagina />, { sesion });

    expect(screen.queryByRole('button', { name: /nuev/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /catálogo|catalogo/i })).toBeNull();
  });

  it('se puede buscar por teléfono, no solo por nombre', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DirectorioTercerosPagina />, { sesion });

    const buscador = screen.getByRole('searchbox');
    await usuario.type(buscador, '55-1234');

    await waitFor(() => {
      expect(espiaQuery).toHaveBeenCalledWith(
        expect.objectContaining({ busqueda: '55-1234', pagina: 1 }),
      );
    });
  });
});
