import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Color } from '@/api/tipos';
import { renderConProveedores } from '@/pruebas/utilidades';

import { AgregarColorMatriz } from './AgregarColorMatriz';

/**
 * Pruebas del alta de color AL VUELO en la matriz de la OP (§Post-F9.11): búsqueda
 * SERVER-SIDE (H4 — se captura la query con que se llama `useColores`), crear solo si la
 * búsqueda resuelta no lo encuentra, y NUNCA sin el permiso del endpoint.
 */

// Se controla la capa de datos (mock de los hooks): las pruebas no tocan la red.
const crearMutate = vi.fn();
const useColoresMock = vi.fn<(query: Record<string, unknown>) => unknown>();
let ultimaQueryColores: Record<string, unknown> | undefined;

vi.mock('@/api/colores', () => ({
  useCrearColor: () => ({ mutate: crearMutate, isPending: false }),
  useColores: (query: Record<string, unknown>) => {
    ultimaQueryColores = query;
    return useColoresMock(query);
  },
}));

// El debounce se vuelve identidad: el "texto resuelto" es lo tecleado al instante (sin
// timers falsos) — lo que se prueba es la QUERY server-side y la lógica del crear.
vi.mock('@/lib/useDebounce', () => ({ useDebounce: (valor: string) => valor }));

/** Color de PRENDA de ejemplo. */
function color(id: number, nombre: string): Color {
  return {
    id,
    nombre,
    activo: true,
    creadoEn: '',
    creadoPorId: null,
    modificadoEn: '',
    modificadoPorId: null,
  };
}

/** Respuesta del catálogo con esos colores (consulta resuelta, sin cargar). */
function consultaConDatos(datos: Color[]): unknown {
  return {
    data: { datos, total: datos.length, pagina: 1, porPagina: 10, totalPaginas: 1 },
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
  };
}

describe('<AgregarColorMatriz> (alta de color al vuelo en la matriz de la OP, §Post-F9.11)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    useColoresMock.mockReset();
    ultimaQueryColores = undefined;
  });

  it('busca EN EL SERVIDOR lo tecleado y agrega la fila del color elegido', async () => {
    const usuario = userEvent.setup();
    const alAgregar = vi.fn();
    useColoresMock.mockReturnValue(consultaConDatos([color(1, 'Negro'), color(2, 'Negro Mate')]));
    renderConProveedores(
      <AgregarColorMatriz idsUsados={new Set()} alAgregar={alAgregar} puedeCrear />,
    );

    await usuario.type(screen.getByTestId('matriz-color-al-vuelo-input'), 'negro');
    // La búsqueda viaja al SERVIDOR (H4): no es un filtro sobre la página 1 del catálogo.
    expect(ultimaQueryColores).toMatchObject({ busqueda: 'negro', porPagina: 10 });

    await usuario.click(screen.getByRole('option', { name: /^Negro$/ }));
    expect(alAgregar).toHaveBeenCalledWith(1, 'Negro');
    expect(crearMutate).not.toHaveBeenCalled();
  });

  it('un color YA usado en la matriz no se vuelve a ofrecer (ni dispara "crear")', async () => {
    const usuario = userEvent.setup();
    useColoresMock.mockReturnValue(consultaConDatos([color(1, 'Negro')]));
    renderConProveedores(
      <AgregarColorMatriz idsUsados={new Set([1])} alAgregar={vi.fn()} puedeCrear />,
    );

    await usuario.type(screen.getByTestId('matriz-color-al-vuelo-input'), 'Negro');
    expect(screen.queryByRole('option', { name: /^Negro$/ })).not.toBeInTheDocument();
    // El color EXISTE (la búsqueda resuelta lo encontró): crear no se ofrece.
    expect(screen.queryByTestId('matriz-color-al-vuelo-crear')).not.toBeInTheDocument();
  });

  it('con permiso y sin coincidencia resuelta, ofrece crear: crea por el API y agrega la fila', async () => {
    const usuario = userEvent.setup();
    const alAgregar = vi.fn();
    useColoresMock.mockReturnValue(consultaConDatos([]));
    crearMutate.mockImplementation(
      (cuerpo: { nombre: string }, opciones?: { onSuccess?: (c: Color) => void }) => {
        opciones?.onSuccess?.(color(33, cuerpo.nombre));
      },
    );
    renderConProveedores(
      <AgregarColorMatriz idsUsados={new Set()} alAgregar={alAgregar} puedeCrear />,
    );

    await usuario.type(screen.getByTestId('matriz-color-al-vuelo-input'), 'Verde botella');
    await usuario.click(screen.getByTestId('matriz-color-al-vuelo-crear'));

    // Llamó el endpoint EXISTENTE de colores y agregó la fila con el creado.
    expect(crearMutate).toHaveBeenCalledWith(
      { nombre: 'Verde botella' },
      expect.objectContaining({ onSuccess: expect.any(Function) as unknown }),
    );
    expect(alAgregar).toHaveBeenCalledWith(33, 'Verde botella');
  });

  it('mientras la búsqueda NO está resuelta, la opción de crear NO se ofrece (anti-duplicado)', async () => {
    const usuario = userEvent.setup();
    useColoresMock.mockReturnValue({
      data: undefined,
      isPending: true,
      isFetching: true,
      isError: false,
      error: null,
    });
    renderConProveedores(
      <AgregarColorMatriz idsUsados={new Set()} alAgregar={vi.fn()} puedeCrear />,
    );

    await usuario.type(screen.getByTestId('matriz-color-al-vuelo-input'), 'Verde botella');
    expect(screen.queryByTestId('matriz-color-al-vuelo-crear')).not.toBeInTheDocument();
  });

  it('SIN permiso de crear color, la opción de crear NO aparece', async () => {
    const usuario = userEvent.setup();
    useColoresMock.mockReturnValue(consultaConDatos([]));
    renderConProveedores(
      <AgregarColorMatriz idsUsados={new Set()} alAgregar={vi.fn()} puedeCrear={false} />,
    );

    await usuario.type(screen.getByTestId('matriz-color-al-vuelo-input'), 'Verde botella');
    expect(screen.queryByTestId('matriz-color-al-vuelo-crear')).not.toBeInTheDocument();
    expect(screen.getByText('Sin coincidencias.')).toBeInTheDocument();
  });
});
