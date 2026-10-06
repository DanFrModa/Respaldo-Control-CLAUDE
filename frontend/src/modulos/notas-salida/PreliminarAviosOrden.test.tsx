import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { HabilitacionAvio } from '@/api/tipos';
import { renderConProveedores } from '@/pruebas/utilidades';
import type { StockDeAvios } from '../inventarios/stock-avios';

import { PreliminarAviosOrden } from './PreliminarAviosOrden';
import type { FilaPreliminarAvio } from './preliminar-avios';

function avio(
  over: Partial<HabilitacionAvio> & { idAvio: number; clave: string },
): HabilitacionAvio {
  return {
    descripcion: `Desc ${over.clave}`,
    unidad: 'pza',
    esGenerico: false,
    requerido: 10,
    enviado: 0,
    falta: 10,
    porcentaje: 0,
    esExtra: false,
    estado: 'pendiente',
    consumoPorTalla: false,
    tallasSinMedida: [],
    ...over,
  };
}

/** BOT-01 y ETQ-03 hay; CIE-02 no (ni aparece en el stock = cero). */
const RECETA = [
  avio({ idAvio: 3, clave: 'BOT-01', descripcion: 'Botón', requerido: 180, falta: 180 }),
  avio({ idAvio: 4, clave: 'CIE-02', descripcion: 'Cierre', requerido: 60, falta: 60 }),
  avio({ idAvio: 5, clave: 'ETQ-03', descripcion: 'Etiqueta', requerido: 30, falta: 30 }),
];
const STOCK: StockDeAvios = new Map([
  [3, { existencia: 500 }],
  [5, { existencia: 12 }],
]);

/**
 * Pinta el preliminar. ⚠️ Sin parámetro por omisión a propósito: `abrir(undefined)` —«no se sabe la
 * existencia»— caería en el default y mediría el stock conocido sin que nadie lo notara.
 */
/** La nota todavía no lleva nada de la orden. */
const SIN_NADA_EN_NOTA: ReadonlyMap<number, number> = new Map();

function abrir(...args: [] | [StockDeAvios]): {
  alConfirmar: ReturnType<typeof vi.fn<(s: FilaPreliminarAvio[]) => void>>;
} {
  const stock = args.length === 0 ? STOCK : args[0];
  const alConfirmar = vi.fn<(s: FilaPreliminarAvio[]) => void>();
  renderConProveedores(
    <PreliminarAviosOrden
      folioOrden={1001}
      avios={RECETA}
      stock={stock}
      enNota={SIN_NADA_EN_NOTA}
      alConfirmar={alConfirmar}
      alCancelar={() => undefined}
    />,
  );
  return { alConfirmar };
}

function fila(clave: string): HTMLElement {
  const encontrada = screen
    .getAllByTestId('preliminar-fila')
    .find((f) => within(f).queryByText(clave) !== null);
  if (encontrada === undefined) throw new Error(`No hay fila para ${clave}`);
  return encontrada;
}

function casilla(clave: string): HTMLInputElement {
  return within(fila(clave)).getByTestId('preliminar-chk');
}

function confirmados(alConfirmar: { mock: { calls: FilaPreliminarAvio[][][] } }): number[] {
  return (alConfirmar.mock.calls.at(-1)?.[0] ?? []).map((f) => f.idAvio);
}

describe('PreliminarAviosOrden (fila 0.220)', () => {
  it('muestra TODOS los avíos de la receta con clave, descripción, cantidad y existencia', () => {
    abrir();
    expect(screen.getAllByTestId('preliminar-fila')).toHaveLength(3);
    expect(within(fila('BOT-01')).getByText('Botón')).toBeInTheDocument();
    expect(within(fila('BOT-01')).getByTestId('preliminar-cantidad')).toHaveTextContent('180 pza');
    expect(within(fila('BOT-01')).getByTestId('preliminar-existencia')).toHaveTextContent(
      '500 pza',
    );
    // El que no hay SE VE (no se esconde) y dice por qué.
    expect(within(fila('CIE-02')).getByTestId('preliminar-existencia')).toHaveTextContent(
      'Sin existencia',
    );
    expect(screen.getByTestId('preliminar-sin-existencia')).toHaveTextContent('CIE-02');
  });

  it('🔴 los que NO tienen existencia no se pueden marcar', () => {
    abrir();
    expect(casilla('CIE-02')).toBeDisabled();
    expect(casilla('CIE-02')).not.toBeChecked();
    // Ni con «marcar todos» se cuela.
    fireEvent.click(screen.getByTestId('preliminar-marcar-todos'));
    fireEvent.click(screen.getByTestId('preliminar-marcar-todos'));
    expect(casilla('CIE-02')).not.toBeChecked();
  });

  it('⭐ por omisión vienen marcados los que tienen existencia (camino rápido de un clic)', () => {
    const { alConfirmar } = abrir();
    expect(casilla('BOT-01')).toBeChecked();
    expect(casilla('ETQ-03')).toBeChecked();
    expect(screen.getByTestId('preliminar-confirmar')).toHaveTextContent('Agregar 2 avíos');
    fireEvent.click(screen.getByTestId('preliminar-confirmar'));
    expect(confirmados(alConfirmar)).toEqual([3, 5]);
  });

  it('⭐ desmarcar uno lo excluye: sólo entran los marcados', () => {
    const { alConfirmar } = abrir();
    fireEvent.click(casilla('ETQ-03'));
    expect(casilla('ETQ-03')).not.toBeChecked();
    fireEvent.click(screen.getByTestId('preliminar-confirmar'));
    expect(confirmados(alConfirmar)).toEqual([3]);
    // Y lleva lo que el padre necesita para el renglón.
    expect(alConfirmar.mock.calls.at(-1)?.[0][0]).toMatchObject({
      clave: 'BOT-01',
      cantidad: 180,
      unidad: 'pza',
    });
  });

  it('sin nada marcado no se puede confirmar', () => {
    abrir();
    fireEvent.click(screen.getByTestId('preliminar-marcar-todos'));
    expect(casilla('BOT-01')).not.toBeChecked();
    expect(screen.getByTestId('preliminar-confirmar')).toBeDisabled();
  });

  it('⭐ si NO se sabe la existencia, se deja marcar (no se inventa un cero) pero no viene marcado', () => {
    const { alConfirmar } = abrir(undefined);
    for (const clave of ['BOT-01', 'CIE-02', 'ETQ-03']) {
      expect(casilla(clave)).toBeEnabled();
      expect(casilla(clave)).not.toBeChecked();
      expect(within(fila(clave)).getByTestId('preliminar-existencia')).toHaveTextContent(
        'No se sabe',
      );
    }
    fireEvent.click(casilla('CIE-02'));
    fireEvent.click(screen.getByTestId('preliminar-confirmar'));
    expect(confirmados(alConfirmar)).toEqual([4]);
  });

  it('si NINGUNO tiene existencia los enseña igual, lo dice y no deja confirmar', () => {
    abrir(new Map());
    expect(screen.getAllByTestId('preliminar-fila')).toHaveLength(3);
    expect(screen.getByTestId('preliminar-nada-que-mandar')).toHaveTextContent(
      'no hay nada que mandar',
    );
    expect(screen.getByTestId('preliminar-confirmar')).toBeDisabled();
  });

  /**
   * 🔴 «Marcar todos» marca sólo LOS QUE HAY. Si metiera también los sin existencia en la selección,
   * hoy no se notaría (la casilla los pinta desmarcados y `aviosAEnviar` los filtra)… hasta que la
   * existencia dejara de saberse con el preliminar abierto: entonces aparecerían MARCADOS sin que
   * nadie los hubiera escogido, y entrarían a la nota. MEDIDO: esta mutación sobrevivía a las demás.
   */
  it('🔴 «marcar todos» no deja marcado lo que no hay aunque luego la existencia deje de saberse', () => {
    const alConfirmar = vi.fn<(s: FilaPreliminarAvio[]) => void>();
    const ui = (stock: StockDeAvios): React.JSX.Element => (
      <PreliminarAviosOrden
        folioOrden={1001}
        avios={RECETA}
        stock={stock}
        enNota={SIN_NADA_EN_NOTA}
        alConfirmar={alConfirmar}
        alCancelar={() => undefined}
      />
    );
    const { rerender } = render(ui(STOCK));
    // Desmarcar todo y volver a marcar todo: el gesto que podría colar a CIE-02.
    fireEvent.click(screen.getByTestId('preliminar-marcar-todos'));
    fireEvent.click(screen.getByTestId('preliminar-marcar-todos'));
    rerender(ui(undefined));
    expect(casilla('CIE-02')).toBeEnabled();
    expect(casilla('CIE-02')).not.toBeChecked();
    fireEvent.click(screen.getByTestId('preliminar-confirmar'));
    expect(confirmados(alConfirmar)).toEqual([3, 5]);
  });

  it('⭐ lo YA SURTIDO se ve como tal, no se marca y no cuenta como faltante', () => {
    const alConfirmar = vi.fn<(s: FilaPreliminarAvio[]) => void>();
    render(
      <PreliminarAviosOrden
        folioOrden={1001}
        avios={[
          avio({ idAvio: 3, clave: 'BOT-01', requerido: 180, enviado: 180, falta: 0 }),
          avio({ idAvio: 4, clave: 'CIE-02', requerido: 60, falta: 60 }),
          avio({ idAvio: 5, clave: 'ETQ-03', requerido: 30, enviado: 10, falta: 20 }),
        ]}
        stock={STOCK}
        enNota={SIN_NADA_EN_NOTA}
        alConfirmar={alConfirmar}
        alCancelar={() => undefined}
      />,
    );
    expect(within(fila('BOT-01')).getByTestId('preliminar-cantidad')).toHaveTextContent(
      'Ya surtido',
    );
    expect(casilla('BOT-01')).toBeDisabled();
    expect(casilla('BOT-01')).not.toBeChecked();
    // El aviso de «sin existencia» habla sólo de lo que falta y no hay.
    expect(screen.getByTestId('preliminar-sin-existencia')).toHaveTextContent('CIE-02');
    expect(screen.getByTestId('preliminar-sin-existencia')).not.toHaveTextContent('BOT-01');
    fireEvent.click(screen.getByTestId('preliminar-confirmar'));
    expect(confirmados(alConfirmar)).toEqual([5]);
    expect(alConfirmar.mock.calls.at(-1)?.[0][0]?.cantidad).toBe(20);
  });

  it('si la orden ya tiene TODO surtido, lo dice y no deja confirmar', () => {
    render(
      <PreliminarAviosOrden
        folioOrden={1001}
        avios={[avio({ idAvio: 3, clave: 'BOT-01', requerido: 180, enviado: 180, falta: 0 })]}
        stock={STOCK}
        enNota={SIN_NADA_EN_NOTA}
        alConfirmar={() => undefined}
        alCancelar={() => undefined}
      />,
    );
    expect(screen.getByTestId('preliminar-nada-que-mandar')).toHaveTextContent('ya tiene surtidos');
    expect(screen.getByTestId('preliminar-confirmar')).toBeDisabled();
  });
});
