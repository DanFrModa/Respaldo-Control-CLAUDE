import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AviosFavoritosSugerencia } from '@/api/modelos';
import { renderConProveedores } from '@/pruebas/utilidades';

import { SugerenciaAviosFavoritos } from './SugerenciaAviosFavoritos';

/**
 * Pruebas de la SUGERENCIA de avíos favoritos (V1-E3v, §Post-F9.90).
 *
 * 🔴 Lo que defienden, más allá de que pinte: que la cantidad que se ofrece sea la que manda el
 * servidor (`cantidadSugerida` = `Avio.cantFav`) y **no un 1 cableado en la pantalla**; que UN solo
 * clic los acepte todos (no ocho palomitas); que un favorito ya puesto no se vuelva a ofrecer; y
 * que con captura sin guardar el botón se bloquee CON la razón a la vista, en vez de tragarse en
 * silencio lo que la persona acaba de teclear.
 */
const aceptarMutate = vi.fn();
let sugerencia: AviosFavoritosSugerencia | undefined;
let aceptando = false;

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/api/modelos', () => ({
  useAviosFavoritosBom: () => ({ data: sugerencia }),
  useAceptarAviosFavoritos: () => ({ mutate: aceptarMutate, isPending: aceptando }),
}));

const VACIA: AviosFavoritosSugerencia = { sugeridos: [], yaEnLaReceta: [], sinCantidad: [] };

beforeEach(() => {
  aceptarMutate.mockClear();
  aceptando = false;
  sugerencia = VACIA;
});

describe('SugerenciaAviosFavoritos', () => {
  it('sin favoritos marcados en el catálogo no pinta nada (y eso es correcto)', () => {
    renderConProveedores(
      <SugerenciaAviosFavoritos idModelo={1} puedeAdministrar hayCambiosSinGuardar={false} />,
    );
    expect(screen.queryByTestId('sugerencia-avios-favoritos')).not.toBeInTheDocument();
  });

  it('enseña cada favorito con la cantidad QUE MANDA EL SERVIDOR, no con un 1 fijo', () => {
    sugerencia = {
      ...VACIA,
      sugeridos: [
        {
          idAvio: 7,
          clave: 'ETQ-LAV',
          descripcion: 'Etiqueta de lavado',
          cantidadSugerida: 1,
          unidad: 'pza',
        },
        {
          idAvio: 9,
          clave: 'ETQ-MAR',
          descripcion: 'Etiqueta de marca',
          cantidadSugerida: 4,
          unidad: 'pza',
        },
      ],
    };
    renderConProveedores(
      <SugerenciaAviosFavoritos idModelo={1} puedeAdministrar hayCambiosSinGuardar={false} />,
    );

    expect(screen.getByTestId('avio-favorito-7')).toHaveTextContent('1 pza');
    // 🔴 Si la pantalla inventara la cantidad (un 1 por default), este 4 saldría mal.
    expect(screen.getByTestId('avio-favorito-9')).toHaveTextContent('4 pza');
    expect(screen.getByTestId('avio-favorito-9')).toHaveTextContent('Etiqueta de marca');
  });

  it('UN solo clic los acepta todos (no hay palomita por avío)', async () => {
    sugerencia = {
      ...VACIA,
      sugeridos: [
        { idAvio: 7, clave: 'ETQ-LAV', descripcion: 'Lavado', cantidadSugerida: 1, unidad: 'pza' },
        { idAvio: 9, clave: 'ETQ-MAR', descripcion: 'Marca', cantidadSugerida: 2, unidad: 'pza' },
      ],
    };
    renderConProveedores(
      <SugerenciaAviosFavoritos idModelo={42} puedeAdministrar hayCambiosSinGuardar={false} />,
    );

    // No hay una casilla por renglón: el acto es uno solo.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    const boton = screen.getByTestId('aceptar-avios-favoritos');
    expect(boton).toHaveTextContent('Aceptar los 2');
    await userEvent.click(boton);

    expect(aceptarMutate).toHaveBeenCalledTimes(1);
    expect(aceptarMutate.mock.calls[0]?.[0]).toBe(42);
  });

  it('un favorito que ya está en la receta no se vuelve a ofrecer: se dice y ya', () => {
    sugerencia = {
      ...VACIA,
      yaEnLaReceta: [
        { idAvio: 7, clave: 'ETQ-LAV', descripcion: 'Lavado', cantidadSugerida: 1, unidad: 'pza' },
      ],
    };
    renderConProveedores(
      <SugerenciaAviosFavoritos idModelo={1} puedeAdministrar hayCambiosSinGuardar={false} />,
    );

    expect(screen.getByTestId('favoritos-ya-puestos')).toBeInTheDocument();
    expect(screen.queryByTestId('aceptar-avios-favoritos')).not.toBeInTheDocument();
  });

  it('caso MIXTO (uno puesto y otro no): menciona a LOS DOS, no se calla el que ya está', () => {
    // 🔴 EL caso que se escapaba: `sugeridos` NO vacío **y** `yaEnLaReceta` NO vacío. El
    // mensaje del «ya está» colgaba de la rama `else` de `sugeridos`, así que con este `sugeridos`
    // de un elemento nunca se pintaba y la tarjeta sólo hablaba del que faltaba — dejando viva la
    // duda que la decisión (b) quería cerrar («¿y ETQ-LAV, se ignoró?»).
    sugerencia = {
      ...VACIA,
      sugeridos: [
        { idAvio: 9, clave: 'ETQ-MAR', descripcion: 'Marca', cantidadSugerida: 2, unidad: 'pza' },
      ],
      yaEnLaReceta: [
        { idAvio: 7, clave: 'ETQ-LAV', descripcion: 'Lavado', cantidadSugerida: 1, unidad: 'pza' },
      ],
    };
    renderConProveedores(
      <SugerenciaAviosFavoritos idModelo={1} puedeAdministrar hayCambiosSinGuardar={false} />,
    );

    // El que falta se sigue ofreciendo, con su cantidad y su botón.
    expect(screen.getByTestId('avio-favorito-9')).toHaveTextContent('2 pza');
    expect(screen.getByTestId('aceptar-avios-favoritos')).toBeInTheDocument();
    // ...y el que YA está se dice aparte, en la MISMA tarjeta.
    expect(screen.getByTestId('favoritos-ya-puestos')).toHaveTextContent('ya está en esta receta');
    // El que ya está NO se vuelve a ofrecer como renglón aceptable.
    expect(screen.queryByTestId('avio-favorito-7')).not.toBeInTheDocument();
  });

  it('con captura sin guardar, el botón se BLOQUEA y dice por qué', () => {
    sugerencia = {
      ...VACIA,
      sugeridos: [
        { idAvio: 7, clave: 'ETQ-LAV', descripcion: 'Lavado', cantidadSugerida: 1, unidad: 'pza' },
      ],
    };
    renderConProveedores(
      <SugerenciaAviosFavoritos idModelo={1} puedeAdministrar hayCambiosSinGuardar />,
    );

    expect(screen.getByTestId('aceptar-avios-favoritos')).toBeDisabled();
    expect(screen.getByTestId('favoritos-bloqueado-sin-guardar')).toHaveTextContent(
      'Guarda primero la receta',
    );
  });

  it('un favorito SIN cantidad preestablecida no se sugiere, pero se NOMBRA', () => {
    sugerencia = {
      ...VACIA,
      sinCantidad: [{ idAvio: 3, clave: 'AAA-SIN', descripcion: 'Favorito sin cantidad' }],
    };
    renderConProveedores(
      <SugerenciaAviosFavoritos idModelo={1} puedeAdministrar hayCambiosSinGuardar={false} />,
    );

    expect(screen.getByTestId('favoritos-sin-cantidad')).toHaveTextContent('AAA-SIN');
    expect(screen.queryByTestId('aceptar-avios-favoritos')).not.toBeInTheDocument();
  });

  it('sin permiso para administrar la receta, la tarjeta no se pinta (§Post-F9.68: esconder Y bloquear)', () => {
    sugerencia = {
      ...VACIA,
      sugeridos: [
        { idAvio: 7, clave: 'ETQ-LAV', descripcion: 'Lavado', cantidadSugerida: 1, unidad: 'pza' },
      ],
    };
    renderConProveedores(
      <SugerenciaAviosFavoritos
        idModelo={1}
        puedeAdministrar={false}
        hayCambiosSinGuardar={false}
      />,
    );

    expect(screen.queryByTestId('sugerencia-avios-favoritos')).not.toBeInTheDocument();
  });
});
