import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderConProveedores } from '@/pruebas/utilidades';

/**
 * Pruebas de la captura de renglones de TELA, con la regla que dictó Daniel el 30-jul-2026: un LOTE
 * es una partida de UN color con VARIAS telas dentro (la felpa y su cardigan al tono, decisión D5),
 * y *"normalmente se descargan las telas al mismo tiempo cuando están relacionadas"*. La pantalla
 * las OFRECE juntas; las cantidades **se teclean** (*"nada se estima, ni es un porcentaje"*).
 */

const useExistenciasTela = vi.fn<(q: unknown) => unknown>();

vi.mock('@/api/inventario-materiales', () => ({
  useExistenciasTela: (q: unknown) => useExistenciasTela(q),
}));
// El selector de tela se simula: emite la tela elegida al hacer clic.
// El selector se simula, pero REFLEJANDO lo que el padre le pasa (`idSeleccionado`/`etiquetaSeleccion`):
// sin eso, nada observaría que el chip "al tono" cambió la tela y la prueba pasaría de gratis
// (hallazgo del reviewer).
vi.mock('./SelectorTela', () => ({
  SelectorTela: ({
    idSeleccionado,
    etiquetaSeleccion,
    alSeleccionar,
  }: {
    idSeleccionado: number | undefined;
    etiquetaSeleccion?: string | undefined;
    alSeleccionar: (t: unknown) => void;
  }) => (
    <div>
      <span data-testid="tela-elegida">
        {idSeleccionado === undefined ? '' : `${idSeleccionado}:${etiquetaSeleccion ?? ''}`}
      </span>
      <button
        type="button"
        data-testid="sel-tela"
        onClick={() => alSeleccionar({ id: 1, nombre: 'Felpa 100%' })}
      >
        elegir felpa
      </button>
      <button
        type="button"
        data-testid="sel-tela-ajena"
        onClick={() => alSeleccionar({ id: 9, nombre: 'Licra' })}
      >
        elegir una tela que NO está en el lote
      </button>
    </div>
  ),
}));

const { CapturaRenglonesTela } = await import('./CapturaRenglonesTela');

/** Una fila de existencia (tela × lote × almacén). */
function fila(idTela: number, tela: string, existencia: number) {
  return {
    idTela,
    tela,
    idLote: 50,
    loteClave: 'TEÑIDO-9',
    idColor: 3,
    color: 'Negro',
    idAlmacen: 1,
    almacen: 'Telas',
    existencia,
  };
}

/** El lote 50 (negro) trae la felpa y su cardigan al tono. */
const FILAS = [fila(1, 'Felpa 100%', 120), fila(2, 'Cardigan Negro', 40)];

beforeEach(() => {
  useExistenciasTela.mockReset();
  // La consulta por tela filtra; la del lote trae los dos componentes.
  useExistenciasTela.mockImplementation((q) => {
    const filtro = q as { idTela?: number; idLote?: number };
    if (filtro.idLote !== undefined) return { data: { filas: FILAS }, isPending: false };
    if (filtro.idTela !== undefined) {
      return {
        data: { filas: FILAS.filter((f) => f.idTela === filtro.idTela) },
        isPending: false,
      };
    }
    return { data: { filas: [] }, isPending: false };
  });
});

/** Elige la felpa y su lote (el estado de partida de todas las pruebas). */
async function elegirFelpaYLote(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  await usuario.click(screen.getByTestId('sel-tela'));
  await usuario.selectOptions(screen.getByTestId('captura-lote'), '50');
}

describe('<CapturaRenglonesTela> · telas al tono del lote', () => {
  it('al elegir el lote avisa qué OTRAS telas trae esa misma partida', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaRenglonesTela idAlmacen={1} renglones={[]} onChange={vi.fn()} />);
    await elegirFelpaYLote(usuario);

    const aviso = screen.getByTestId('captura-telas-al-tono');
    expect(aviso).toHaveTextContent('Cardigan Negro');
    expect(aviso).toHaveTextContent('40');
    // La tela que ya se está capturando NO se ofrece a sí misma.
    expect(aviso).not.toHaveTextContent('Felpa 100%');
  });

  it('el chip cambia la captura a esa tela, conservando el lote y sin cantidad', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    renderConProveedores(<CapturaRenglonesTela idAlmacen={1} renglones={[]} onChange={onChange} />);
    await elegirFelpaYLote(usuario);

    await usuario.click(screen.getByTestId('captura-al-tono-2'));
    // La tela elegida es AHORA el cardigan, y el selector lo refleja (id Y nombre): si solo
    // cambiara por dentro, se capturaría un renglón distinto del que se lee en pantalla.
    expect(screen.getByTestId('tela-elegida')).toHaveTextContent('2:Cardigan Negro');
    // El lote se conserva (es la misma partida)…
    expect(screen.getByTestId('captura-lote')).toHaveValue('50');
    // …y la cantidad queda EN BLANCO: se teclea, no se estima.
    expect(screen.getByTestId('captura-cantidad')).toHaveValue(null);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('la tela al tono YA capturada deja de ofrecerse', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <CapturaRenglonesTela
        idAlmacen={1}
        renglones={[
          {
            idTela: 2,
            tela: 'Cardigan Negro',
            idLote: 50,
            loteClave: 'TEÑIDO-9',
            cantidad: 40,
            disponible: 40,
          },
        ]}
        onChange={vi.fn()}
      />,
    );
    await elegirFelpaYLote(usuario);

    expect(screen.queryByTestId('captura-telas-al-tono')).not.toBeInTheDocument();
  });

  it('tras agregar un renglón el LOTE se conserva (para seguir con su tela al tono)', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    renderConProveedores(<CapturaRenglonesTela idAlmacen={1} renglones={[]} onChange={onChange} />);
    await elegirFelpaYLote(usuario);

    await usuario.type(screen.getByTestId('captura-cantidad'), '100');
    await usuario.click(screen.getByTestId('captura-agregar'));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ idTela: 1, idLote: 50, cantidad: 100 }),
    ]);
    // El lote sigue puesto y la cantidad limpia: el siguiente renglón es el cardigan.
    expect(screen.getByTestId('captura-lote')).toHaveValue('50');
    expect(screen.getByTestId('captura-cantidad')).toHaveValue(null);
  });

  it('NO agrega una tela que no está en ese lote (combinación inválida)', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    renderConProveedores(<CapturaRenglonesTela idAlmacen={1} renglones={[]} onChange={onChange} />);
    await elegirFelpaYLote(usuario);
    // Se cambia a una tela que NO está en el lote 50 (el lote se conserva a propósito).
    await usuario.click(screen.getByTestId('sel-tela-ajena'));
    await usuario.type(screen.getByTestId('captura-cantidad'), '10');

    // El botón se deshabilita Y se explica por qué (antes se agregaba igual, con el lote llamado
    // "50" y disponible 0, y el servidor lo rechazaba al guardar — hallazgo del reviewer).
    expect(screen.getByTestId('captura-agregar')).toBeDisabled();
    expect(screen.getByTestId('captura-combinacion-invalida')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('captura-agregar'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
