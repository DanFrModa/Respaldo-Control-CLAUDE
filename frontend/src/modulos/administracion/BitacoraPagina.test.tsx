import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BitacoraPagina as TipoPagina, BitacoraQuery } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { BitacoraPagina, datosLegibles } from './BitacoraPagina';

// El mock captura la `query` con la que la pantalla llama a `useBitacora`, para poder verificar
// que el filtro de fechas manda ISO date-time COMPLETO (el contrato exige format: date-time).
const useBitacoraMock = vi.fn((query: BitacoraQuery) => {
  ultimaQuery = query;
  return bitacoraResult;
});

vi.mock('@/api/bitacora', () => ({
  useBitacora: (query: BitacoraQuery) => useBitacoraMock(query),
}));

let ultimaQuery: BitacoraQuery;

let bitacoraResult: {
  data: TipoPagina | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
};

const sesion = estadoSesionDePrueba(['admin.ver-bitacora']);

function crearPagina(): TipoPagina {
  return {
    datos: [
      {
        id: 'abc-123',
        entidad: 'Almacen',
        idEntidad: '1',
        accion: 'CREAR',
        idUsuario: 'u-1',
        nombreUsuario: 'admin',
        datos: { nombre: 'Bodega A' },
        datosOcultos: 0,
        fecha: '2026-06-01T10:00:00Z',
      },
    ],
    total: 1,
    pagina: 1,
    totalPaginas: 1,
    porPagina: 20,
  };
}

beforeEach(() => {
  bitacoraResult = {
    data: crearPagina(),
    isPending: false,
    isError: false,
    isFetching: false,
  };
});

describe('BitacoraPagina', () => {
  it('muestra el título Bitácora', () => {
    renderConProveedores(<BitacoraPagina />, { sesion });
    expect(screen.getByText('Bitácora')).toBeDefined();
  });

  it('muestra la entidad y el usuario de un registro', () => {
    renderConProveedores(<BitacoraPagina />, { sesion });
    // El dato aparece en la tabla (≥lg) y en la tarjeta móvil (<lg); se afirma sobre la tabla
    // (ambas viven en el DOM en JSDOM, sin media queries).
    const tabla = within(screen.getByTestId('bitacora-tabla'));
    expect(tabla.getByText('Almacen')).toBeDefined();
    expect(tabla.getByText('admin')).toBeDefined();
  });

  it('muestra mensaje de vacía cuando no hay registros', () => {
    bitacoraResult.data = { datos: [], total: 0, pagina: 1, totalPaginas: 0, porPagina: 20 };
    renderConProveedores(<BitacoraPagina />, { sesion });
    expect(screen.getByTestId('bitacora-vacia')).toBeDefined();
  });

  it('renderiza los filtros de entidad, acción, desde y hasta', () => {
    renderConProveedores(<BitacoraPagina />, { sesion });
    expect(screen.getByTestId('filtro-entidad')).toBeDefined();
    expect(screen.getByTestId('filtro-accion')).toBeDefined();
    expect(screen.getByTestId('filtro-desde')).toBeDefined();
    expect(screen.getByTestId('filtro-hasta')).toBeDefined();
  });

  it('al capturar fechas, la query lleva ISO date-time completo y rango inclusivo de día', async () => {
    const user = userEvent.setup();
    renderConProveedores(<BitacoraPagina />, { sesion });

    // El <input type="date"> entrega "YYYY-MM-DD"; la pantalla debe convertirlo a ISO date-time.
    await user.type(screen.getByTestId('filtro-desde'), '2026-06-01');
    await user.type(screen.getByTestId('filtro-hasta'), '2026-06-30');

    // `desde` = inicio del día; `hasta` = fin del día (rango inclusivo). El contrato exige el
    // formato date-time completo; mandar solo "YYYY-MM-DD" daba 400.
    expect(ultimaQuery.desde).toBe('2026-06-01T00:00:00.000Z');
    expect(ultimaQuery.hasta).toBe('2026-06-30T23:59:59.999Z');
  });

  // ⭐ Fila 0.249 parte D: el servidor tapa los importes que tu usuario no puede ver.
  describe('importes ocultos', () => {
    function conOcultos(): void {
      bitacoraResult.data = {
        ...crearPagina(),
        datos: [
          {
            id: 'x-9',
            entidad: 'Tela',
            idEntidad: '7',
            accion: 'MODIFICAR',
            idUsuario: 'u-1',
            nombreUsuario: 'admin',
            datos: {
              nombre: 'Felpa',
              precioSugerido: { oculto: true },
              colores: [{ precio: { oculto: true } }],
            },
            datosOcultos: 2,
            fecha: '2026-06-01T10:00:00Z',
          },
        ],
      };
    }

    it('la fila dice cuántos importes se taparon (tabla y tarjeta)', () => {
      conOcultos();
      renderConProveedores(<BitacoraPagina />, { sesion });
      const tabla = within(screen.getByTestId('bitacora-tabla'));
      expect(tabla.getByTestId('bitacora-ocultos').textContent).toBe('2 importes ocultos');
      expect(screen.getAllByTestId('bitacora-ocultos')).toHaveLength(2);
    });

    it('sin importes ocultos no hay marca', () => {
      renderConProveedores(<BitacoraPagina />, { sesion });
      expect(screen.queryByTestId('bitacora-ocultos')).toBeNull();
    });

    it('el cajón avisa y pinta «oculto», nunca [object Object] ni el centinela crudo', async () => {
      conOcultos();
      const user = userEvent.setup();
      renderConProveedores(<BitacoraPagina />, { sesion });
      await user.click(within(screen.getByTestId('bitacora-tabla')).getByText('Ver datos'));
      expect(screen.getByTestId('bitacora-aviso-ocultos').textContent).toContain(
        '2 importes ocultos',
      );
      const json = screen.getByTestId('bitacora-json').textContent ?? '';
      expect(json).toContain('"precioSugerido": «oculto»');
      expect(json).toContain('"precio": «oculto»');
      expect(json).toContain('"nombre": "Felpa"');
      expect(json).not.toContain('[object Object]');
      expect(json).not.toContain('"oculto"');
    });

    it('datosLegibles sólo sustituye el centinela exacto (un objeto con más claves queda igual)', () => {
      expect(datosLegibles({ a: { oculto: true, b: 1 }, c: { oculto: false } })).toBe(
        JSON.stringify({ a: { oculto: true, b: 1 }, c: { oculto: false } }, null, 2),
      );
      expect(datosLegibles(null)).toBe('null');
    });
  });
});
