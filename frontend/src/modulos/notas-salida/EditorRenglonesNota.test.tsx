import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorRenglonesNota } from './EditorRenglonesNota';
import { renglonVacio, type RenglonNotaCaptura } from './captura';

// El editor lee el kardex de la tela elegida para listar las salidas-a-orden.
const useKardexTelaMock = vi.fn();
vi.mock('@/api/inventario-materiales', () => ({
  useKardexTela: (q: unknown) => useKardexTelaMock(q) as unknown,
}));

const AVIOS = [{ id: 3, clave: 'BOT-01', descripcion: 'Botón' }] as never;
const TELAS = [{ id: 7, nombre: 'Felpa francesa' }] as never;
const ORDENES = [{ id: 50, folio: 1001, codigoModelo: 'MOD-1', cliente: 'Cliente A' }] as never;

/** Renderiza el editor controlado y devuelve el último estado que emitió. */
function renderEditor(inicial: RenglonNotaCaptura[]) {
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
    />,
  );
  return { estado, alCambiar };
}

describe('EditorRenglonesNota (F4-E5)', () => {
  beforeEach(() => {
    useKardexTelaMock.mockReset();
    useKardexTelaMock.mockReturnValue({ data: { renglones: [] }, isPending: false });
  });

  it('lista solo las salidas-a-orden de ESA orden/tela, no canceladas (decisión e)', () => {
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
          // Otro origen (ajuste): se descarta.
          {
            idMovimiento: 303,
            folio: 303,
            origenTipo: 'ajuste-entrada',
            origenId: '50',
            idLote: 14,
            loteClave: 'L-12',
            salida: 0,
            fecha: '2026-06-19',
            cancelado: false,
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
    };
    renderEditor([renglon]);

    const selector = screen.getByTestId('selector-salida-tela-nota');
    // Solo el movimiento 300 (orden 50, no cancelado, salida-tela-orden) está disponible.
    const opciones = within(selector).getAllByRole('option');
    const valores = opciones.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== '');
    expect(valores).toEqual(['300']);
  });

  it('al elegir una salida-a-orden, fija lote + movimiento + cantidad de la salida', () => {
    useKardexTelaMock.mockReturnValue({
      data: {
        renglones: [
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
        ],
      },
      isPending: false,
    });

    const renglon: RenglonNotaCaptura = {
      ...renglonVacio(),
      tipo: 'tela',
      idOrden: 50,
      idTela: 7,
    };
    const { alCambiar } = renderEditor([renglon]);

    fireEvent.change(screen.getByTestId('selector-salida-tela-nota'), { target: { value: '300' } });
    const emitido = alCambiar.mock.calls.at(-1)?.[0] as RenglonNotaCaptura[];
    expect(emitido[0]).toMatchObject({
      idMovimientoSalidaTela: 300,
      idLote: 11,
      cantidad: '30',
    });
  });
});
