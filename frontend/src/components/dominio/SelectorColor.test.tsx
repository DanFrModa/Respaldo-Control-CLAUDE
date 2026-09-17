import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { elegirEnCombobox, renderConProveedores } from '@/pruebas/utilidades';

import { SelectorColor } from './SelectorColor';

// ── Mock de la capa de datos: guarda la QUERY con la que la pantalla pide colores ────
const consultas: Record<string, unknown>[] = [];
const respuesta = vi.fn<() => { datos: { id: number; nombre: string }[] }>();

/** Banderas de la consulta (las manipula la prueba del anti-carrera). */
const estadoConsulta = { isPending: false, isFetching: false };

vi.mock('@/api/colores', () => ({
  useColores: (query: Record<string, unknown>) => {
    consultas.push(query);
    return { data: respuestaActual(), isError: false, ...estadoConsulta };
  },
}));

function respuestaActual(): { datos: { id: number; nombre: string }[] } {
  return respuesta();
}

/**
 * Abre el popover, teclea, y devuelve los textos de las opciones OFRECIDAS — sin elegir ninguna
 * (elegir cierra la lista y ya no habría qué leer). `findAllByTestId` absorbe el debounce de 300 ms.
 */
async function opcionesOfrecidas(testid: string, texto: string): Promise<string[]> {
  const input = screen.getByTestId(`${testid}-busqueda`);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: texto } });
  const opciones = await screen.findAllByTestId(`${testid}-opcion`);
  return opciones.map((o) => o.textContent ?? '');
}

/** La última query con la que se pidió el catálogo (la de después de teclear). */
function ultimaConsulta(): Record<string, unknown> {
  const ultima = consultas.at(-1);
  if (ultima === undefined) {
    throw new Error('El selector no consultó el catálogo de colores.');
  }
  return ultima;
}

/**
 * ⭐ FILA 0.192 — EL SELECTOR DE COLOR BUSCA EN EL SERVIDOR.
 *
 * El defecto que cierra: seis pantallas pedían `useColores({ porPagina: 100 })` y **100 es el tope
 * REAL del contrato** (`contrato/esquemas/color.ts` → `.max(100)`), así que no había forma de pedir
 * más: pasando de cien colores activos, los del final del alfabeto desaparecían del desplegable sin
 * aviso. Cada `it` de aquí abajo vigila UNA invariante del arreglo.
 */
describe('SelectorColor (fila 0.192)', () => {
  beforeEach(() => {
    consultas.length = 0;
    estadoConsulta.isPending = false;
    estadoConsulta.isFetching = false;
    respuesta.mockReturnValue({ datos: [{ id: 7, nombre: 'Rojo' }] });
  });

  /**
   * 🔴 LA INVARIANTE CENTRAL: lo tecleado viaja al SERVIDOR. Sin esto el combobox sólo filtraría la
   * página que ya tiene cargada, que es exactamente el defecto que la fila vino a matar.
   */
  it('manda al servidor lo que se teclea (búsqueda server-side)', async () => {
    renderConProveedores(
      <SelectorColor idSeleccionado={undefined} alSeleccionar={vi.fn()} testid="sc" />,
    );
    await elegirEnCombobox('sc', 'Rojo');

    expect(ultimaConsulta()['busqueda']).toBe('Rojo');
  });

  /**
   * 🔴 Y NUNCA pide más de lo que el contrato acepta. Pedir 200 no es «traer más»: es un **400** del
   * backend y un desplegable VACÍO — le pasaba de verdad al conteo cíclico antes de esta fila.
   */
  it('pide una página CHICA, nunca por encima del tope del contrato (100)', () => {
    renderConProveedores(
      <SelectorColor idSeleccionado={undefined} alSeleccionar={vi.fn()} testid="sc" />,
    );

    const porPagina = ultimaConsulta()['porPagina'];
    expect(typeof porPagina).toBe('number');
    expect(porPagina as number).toBeLessThanOrEqual(100);
  });

  /** Sólo el catálogo VIVO: una pantalla de captura no debe invitar a usar un color retirado. */
  it('pide sólo los colores activos', () => {
    renderConProveedores(
      <SelectorColor idSeleccionado={undefined} alSeleccionar={vi.fn()} testid="sc" />,
    );

    expect(ultimaConsulta()['incluirInactivos']).toBe('false');
  });

  /** `excluirIds` = lo que la pantalla ya usa (una fila de la matriz): no se vuelve a ofrecer. */
  it('no ofrece los colores que la pantalla ya está usando', async () => {
    respuesta.mockReturnValue({
      datos: [
        { id: 7, nombre: 'Rojo' },
        { id: 8, nombre: 'Marino' },
      ],
    });
    renderConProveedores(
      <SelectorColor
        idSeleccionado={undefined}
        alSeleccionar={vi.fn()}
        excluirIds={new Set([7])}
        testid="sc"
      />,
    );
    expect(await opcionesOfrecidas('sc', 'Marino')).toEqual(['Marino']);
  });

  /**
   * ⭐ Fila 0.164 — los colores RETIRADOS con mercancía. El servidor NO puede devolverlos (la
   * consulta va por los activos), así que los pone la pantalla: si el selector los ignorara, las
   * piezas de un color fusionado se quedarían otra vez sin puerta para ajustarse o traspasarse.
   */
  it('ofrece también las opciones EXTRA de la pantalla (los colores retirados con mercancía)', async () => {
    renderConProveedores(
      <SelectorColor
        idSeleccionado={undefined}
        alSeleccionar={vi.fn()}
        opcionesExtra={[{ id: 9, nombre: 'Blanco Hueso (retirado)' }]}
        testid="sc"
      />,
    );
    expect(await opcionesOfrecidas('sc', 'Blanco')).toContain('Blanco Hueso (retirado)');
  });

  /**
   * Y los extras se FILTRAN por lo tecleado: si no, teclear «Rojo» seguiría enseñando todos los
   * retirados del contexto y el buscador dejaría de buscar justo en la lista que él mismo añade.
   */
  it('filtra las opciones EXTRA por lo tecleado', async () => {
    renderConProveedores(
      <SelectorColor
        idSeleccionado={undefined}
        alSeleccionar={vi.fn()}
        opcionesExtra={[{ id: 9, nombre: 'Blanco Hueso (retirado)' }]}
        testid="sc"
      />,
    );
    expect(await opcionesOfrecidas('sc', 'Rojo')).not.toContain('Blanco Hueso (retirado)');
  });

  /**
   * 🔴 EL COLOR YA ELEGIDO SE SIGUE VIENDO AUNQUE NO CAIGA EN LA PÁGINA QUE TRAE LA BÚSQUEDA.
   *
   * Con búsqueda en el servidor el combobox sólo conoce los diez colores de la página cargada, así
   * que la ETIQUETA de lo seleccionado la tiene que poner la pantalla (`nombreSeleccionado`) — el
   * mismo cuidado que documenta `FiltroCliente`.
   *
   * ⚠️ **Y es alcanzable por camino real, no por deducción:** el `DialogContent` de radix DESMONTA a
   * sus hijos al cerrar (`components/ui/dialog.tsx`, sin `forceMount`) mientras el estado del color
   * elegido sobrevive en la pantalla. Cerrar el diálogo de «Agregar artículo» con Esc y reabrirlo
   * remonta el selector desde cero: sin esta línea el campo saldría VACÍO con el color puesto por
   * dentro, que es justo lo contrario de lo que promete.
   */
  it('muestra el color ya elegido aunque NO venga en la página de la búsqueda', () => {
    // La página 1 sólo trae "Rojo": el 900 no está por ningún lado.
    renderConProveedores(
      <SelectorColor
        idSeleccionado={900}
        nombreSeleccionado="Zafiro"
        alSeleccionar={vi.fn()}
        testid="sc"
      />,
    );

    expect(screen.getByTestId('sc-busqueda')).toHaveValue('Zafiro');
  });

  /**
   * 🔴 ANTI-CARRERA: mientras la búsqueda NUEVA viaja al servidor, la página ANTERIOR no se puede
   * clickear.
   *
   * `useColores` va con `placeholderData: keepPreviousData`: en cuanto el debounce dispara la
   * consulta nueva, `isPending` se apaga —hay datos, los viejos— y sólo `isFetching` sigue diciendo
   * la verdad. Sin mirarlo, el popover deja elegibles los colores de la búsqueda anterior y se
   * selecciona el color EQUIVOCADO (la carrera que el kit documenta y que cazó el e2e de inventario
   * PT en su día).
   */
  it('mientras la consulta viaja NO ofrece las opciones viejas (anti-carrera)', async () => {
    estadoConsulta.isFetching = true;
    renderConProveedores(
      <SelectorColor idSeleccionado={undefined} alSeleccionar={vi.fn()} testid="sc" />,
    );

    fireEvent.focus(screen.getByTestId('sc-busqueda'));
    expect(await screen.findByText('Buscando…')).toBeInTheDocument();
    expect(screen.queryAllByTestId('sc-opcion')).toHaveLength(0);
  });

  /** Emite el color completo (id + nombre), que es lo que la pantalla necesita para pintar la fila. */
  it('emite el color elegido con su nombre', async () => {
    const alSeleccionar = vi.fn();
    renderConProveedores(
      <SelectorColor idSeleccionado={undefined} alSeleccionar={alSeleccionar} testid="sc" />,
    );
    await elegirEnCombobox('sc', 'Rojo');

    expect(alSeleccionar).toHaveBeenCalledWith({ id: 7, nombre: 'Rojo' });
  });
});
