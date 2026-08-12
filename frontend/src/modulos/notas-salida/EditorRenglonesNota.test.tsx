import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EditorRenglonesNota, type ExistenciaAvioNota } from './EditorRenglonesNota';
import { renglonVacio, type RenglonNotaCaptura } from './captura';

const AVIOS = [{ id: 3, clave: 'BOT-01', descripcion: 'Botón' }] as never;
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
      ordenes={ORDENES}
      recetaPorOrden={extra?.recetaPorOrden}
      existenciaPorAvio={extra?.existenciaPorAvio}
    />,
  );
  return { estado, alCambiar };
}

describe('EditorRenglonesNota (F4-E5 · rediseño R6 §4.6 — solo-avíos)', () => {
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

  // §Post-F9.38 — la tela ya no se captura en la nota; los renglones viejos solo se MUESTRAN.
  it('un renglón de TELA viejo se muestra en SOLO LECTURA, sin selectores que capturar', () => {
    const renglon: RenglonNotaCaptura = {
      ...renglonVacio(),
      tipo: 'tela',
      idOrden: 50,
      idTela: 7,
      telaNombre: 'Felpa francesa',
      idLote: 11,
      loteClave: 'L-09',
      idMovimientoSalidaTela: 300,
      cantidad: '30',
      unidad: 'kg',
    };
    renderEditor([renglon]);

    // Ya NO hay captura de tela: ni selector de tela ni de salida-a-orden (era incapturable).
    expect(screen.queryByTestId('selector-tela-nota')).toBeNull();
    expect(screen.queryByTestId('selector-salida-tela-nota')).toBeNull();

    // Pero el renglón se ve tal cual (no se oculta: al guardar se re-envía completo).
    const historico = screen.getByTestId('renglon-tela-historico');
    expect(historico).toHaveTextContent('Felpa francesa');
    expect(historico).toHaveTextContent('L-09');
    expect(historico).toHaveTextContent('30');
    // Y su orden destino queda fija (no editable).
    expect(screen.getByTestId('selector-orden-nota')).toBeDisabled();
  });

  // §Post-F9.38 / V1-E3b — el renglón MIGRADO (solo texto libre) también se muestra, y no se
  // disfraza de tela: antes caía en la rama de tela y quedaba en blanco.
  it('un renglón MIGRADO muestra su texto libre, en solo lectura', () => {
    const renglon: RenglonNotaCaptura = {
      ...renglonVacio(),
      tipo: 'historico',
      idOrden: 50,
      cantidad: '0',
      descripcionLegacy: '3 conos hilo negro y etiquetas',
    };
    renderEditor([renglon]);

    const migrado = screen.getByTestId('renglon-migrado');
    expect(migrado).toHaveTextContent('3 conos hilo negro y etiquetas');
    expect(migrado).toHaveTextContent('no editable');
    expect(screen.queryByTestId('selector-avio-nota')).toBeNull();
    expect(screen.getByTestId('selector-orden-nota')).toBeDisabled();
  });
});
