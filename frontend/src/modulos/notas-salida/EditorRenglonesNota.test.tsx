import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorRenglonesNota, type ExistenciaAvioNota } from './EditorRenglonesNota';
import { renglonVacio, type RenglonNotaCaptura } from './captura';

// El editor lee el kardex de la tela elegida para listar las salidas-a-orden (renglones legacy).
const useKardexTelaMock = vi.fn();
vi.mock('@/api/inventario-materiales', () => ({
  useKardexTela: (q: unknown) => useKardexTelaMock(q) as unknown,
}));

const AVIOS = [{ id: 3, clave: 'BOT-01', descripcion: 'Botón' }] as never;
const TELAS = [{ id: 7, nombre: 'Felpa francesa' }] as never;
const ORDENES = [{ id: 50, folio: 1001, codigoModelo: 'MOD-1', cliente: 'Cliente A' }] as never;

/** Renderiza el editor controlado y devuelve el último estado que emitió. */
function renderEditor(
  inicial: RenglonNotaCaptura[],
  extra?: {
    recetaPorOrden?: Map<number, Set<number>>;
    existenciaPorAvio?: Map<number, ExistenciaAvioNota>;
  },
) {
  const estado = { renglones: inicial };
  const alCambiar = vi.fn((r: RenglonNotaCaptura[]) => {
    estado.renglones = r;
  });
  render(
    <EditorRenglonesNota
      renglones={estado.renglones}
      alCambiar={alCambiar}
      avios={AVIOS}
      telas={TELAS}
      ordenes={ORDENES}
      recetaPorOrden={extra?.recetaPorOrden}
      existenciaPorAvio={extra?.existenciaPorAvio}
    />,
  );
  return { estado, alCambiar };
}

describe('EditorRenglonesNota (F4-E5 · rediseño R6 §4.6 — solo-avíos)', () => {
  beforeEach(() => {
    useKardexTelaMock.mockReset();
    useKardexTelaMock.mockReturnValue({ data: { renglones: [] }, isPending: false });
  });

  it('el constructor es SOLO-AVÍOS: no hay selector de "Tipo de material" y "Agregar" da un avío', () => {
    const { alCambiar } = renderEditor([renglonVacio()]);

    // Ya NO existe el selector de tipo de material (§4.6 dec. 2).
    expect(screen.queryByTestId('tipo-material-nota')).toBeNull();

    // "Agregar renglón" añade un renglón de avío (nunca de tela).
    screen.getByTestId('agregar-renglon-nota').click();
    const emitido = alCambiar.mock.calls.at(-1)?.[0] as RenglonNotaCaptura[];
    expect(emitido).toHaveLength(2);
    expect(emitido[1]?.tipo).toBe('avio');
  });

  it('el renglón de avío marca ✓/⚠ receta y la existencia del almacén origen', () => {
    const renglon: RenglonNotaCaptura = {
      ...renglonVacio(),
      tipo: 'avio',
      idOrden: 50,
      idAvio: 3,
      cantidad: '5',
    };
    renderEditor([renglon], {
      recetaPorOrden: new Map([[50, new Set([3])]]),
      existenciaPorAvio: new Map([[3, { existencia: 100, unidad: 'pza' }]]),
    });

    expect(screen.getByTestId('flag-receta-nota')).toHaveTextContent('en la receta');
    expect(screen.getByTestId('existencia-nota')).toHaveTextContent('100');
  });

  it('un avío FUERA de la receta se marca ⚠ (la nota propone, no limita) y la existencia excedida en rojo', () => {
    const renglon: RenglonNotaCaptura = {
      ...renglonVacio(),
      tipo: 'avio',
      idOrden: 50,
      idAvio: 3,
      cantidad: '150',
    };
    renderEditor([renglon], {
      recetaPorOrden: new Map([[50, new Set([99])]]),
      existenciaPorAvio: new Map([[3, { existencia: 100, unidad: 'pza' }]]),
    });

    expect(screen.getByTestId('flag-receta-nota')).toHaveTextContent('fuera de la receta');
    // 150 solicitado > 100 en existencia → aviso "Excede".
    expect(screen.getByTestId('existencia-nota')).toHaveTextContent('Excede');
  });

  it('un renglón de TELA legacy/migrado se lista pero es SOLO LECTURA (no editable)', () => {
    useKardexTelaMock.mockReturnValue({
      data: {
        renglones: [
          // De la orden 50: válida.
          {
            idMovimiento: 300,
            folio: 300,
            origenTipo: 'salida-tela-orden',
            origenId: '50',
            idLote: 11,
            loteClave: 'L-09',
            salida: 30,
            fecha: '2026-06-19',
            cancelado: false,
          },
          // De OTRA orden: se descarta.
          {
            idMovimiento: 301,
            folio: 301,
            origenTipo: 'salida-tela-orden',
            origenId: '99',
            idLote: 12,
            loteClave: 'L-10',
            salida: 5,
            fecha: '2026-06-19',
            cancelado: false,
          },
          // Cancelada: se descarta.
          {
            idMovimiento: 302,
            folio: 302,
            origenTipo: 'salida-tela-orden',
            origenId: '50',
            idLote: 13,
            loteClave: 'L-11',
            salida: 9,
            fecha: '2026-06-19',
            cancelado: true,
          },
        ],
      },
      isPending: false,
    });

    const renglon: RenglonNotaCaptura = {
      ...renglonVacio(),
      tipo: 'tela',
      idOrden: 50,
      idTela: 7,
      idLote: 11,
      idMovimientoSalidaTela: 300,
      cantidad: '30',
    };
    renderEditor([renglon]);

    // Sigue listando solo la salida válida (orden 50, no cancelada) — pero en modo lectura.
    const selectorSalida = screen.getByTestId('selector-salida-tela-nota');
    const valores = within(selectorSalida)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== '');
    expect(valores).toEqual(['300']);

    // TODO editable del renglón de tela queda deshabilitado (no se puede editar desde el constructor).
    expect(screen.getByTestId('selector-orden-nota')).toBeDisabled();
    expect(screen.getByTestId('selector-tela-nota')).toBeDisabled();
    expect(selectorSalida).toBeDisabled();
    // La cantidad documentada por la salida-a-orden se muestra.
    expect(screen.getByTestId('cantidad-tela-nota')).toHaveTextContent('30');
  });
});
