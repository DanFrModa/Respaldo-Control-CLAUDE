import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { TraspasoTelaColorPagina } from './TraspasoTelaColorPagina';

/**
 * Pruebas del TRASPASO de telas por color — la pantalla del flujo que describió Daniel
 * (§Post-F9.13): recibir la tela en el almacén principal y mandarla al del cortador antes de
 * descargarla. Cubre lo que se le agregó: solo almacenes de TELA, la etiqueta que dice de qué
 * cortador es cada bodega, y el deep-link que llega con el destino puesto.
 *
 * ⭐ Fila 0.172 — y el MOTIVO obligatorio: sin él la pantalla no deja guardar (antes eran unas
 * observaciones opcionales, así que mandar tela al cortador no exigía una palabra).
 */

const mutate = vi.fn();
const almacenesQuery = vi.fn();

vi.mock('@/api/inventario-materiales', () => ({
  useTraspasarTelaColor: () => ({ mutate, isPending: false }),
  urlImpresoTraspasoTela: (id: number) => `/api/inventarios/telas/traspasos/${String(id)}/impreso`,
}));
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: (query: unknown) => {
    almacenesQuery(query);
    return {
      data: {
        datos: [
          { id: 5, nombre: 'Naucalpan', idCortador: null, cortador: null },
          { id: 8, nombre: 'Bodega Montaño', idCortador: 99, cortador: 'Taller Montaño' },
        ],
      },
    };
  },
}));
// La captura de renglones se simula: un botón que emite un renglón ya armado.
vi.mock('./CapturaRenglonesTelaColor', () => ({
  CapturaRenglonesTelaColor: ({ onChange }: { onChange: (r: unknown[]) => void }) => (
    <button
      type="button"
      data-testid="captura-color-simulada"
      onClick={() =>
        onChange([
          {
            idTelaColor: 11,
            tela: 'Felpa',
            color: 'Negro',
            nombreComplemento: 'Cardigan',
            cantidad: 60,
            cantidadComplemento: 25,
          },
        ])
      }
    >
      capturar
    </button>
  ),
}));

const SESION = () => estadoSesionDePrueba(['inventario-telas.mover']);

describe('TraspasoTelaColorPagina (§Post-F9.13)', () => {
  it('solo ofrece almacenes de TELA y dice de qué cortador es cada uno', () => {
    renderConProveedores(<TraspasoTelaColorPagina />, { sesion: SESION() });

    // El filtro lo aplica el SERVIDOR: la pantalla pide la lista ya acotada.
    expect(almacenesQuery).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'TELA' }));
    const destino = screen.getByTestId('traspaso-color-destino');
    expect(within(destino).getByRole('option', { name: 'Naucalpan' })).toBeInTheDocument();
    expect(
      within(destino).getByRole('option', { name: 'Bodega Montaño · Taller Montaño' }),
    ).toBeInTheDocument();
  });

  it('con el deep-link del cortador llega con el DESTINO puesto y el origen libre', async () => {
    renderConProveedores(<TraspasoTelaColorPagina />, {
      sesion: SESION(),
      rutaInicial: { pathname: '/inventarios/telas/traspaso', state: { idCortador: 99 } },
    });

    await waitFor(() => {
      expect(screen.getByTestId('traspaso-color-destino')).toHaveValue('8');
    });
    // El origen NO se adivina: de dónde sale la tela lo decide quien captura.
    expect(screen.getByTestId('traspaso-color-origen')).toHaveValue('');
  });

  it('exige almacenes distintos y manda las dos cantidades del renglón', () => {
    renderConProveedores(<TraspasoTelaColorPagina />, { sesion: SESION() });

    // Mismo origen y destino: avisa y no deja guardar.
    fireEvent.change(screen.getByTestId('traspaso-color-origen'), { target: { value: '5' } });
    fireEvent.change(screen.getByTestId('traspaso-color-destino'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('captura-color-simulada'));
    fireEvent.change(screen.getByTestId('traspaso-color-motivo'), {
      target: { value: 'Va al cortador Pérez' },
    });
    expect(screen.getByTestId('traspaso-color-iguales')).toBeInTheDocument();
    expect(screen.getByTestId('traspaso-color-guardar')).toBeDisabled();

    // Con destino distinto sí guarda, con cuerpo y complemento juntos.
    fireEvent.change(screen.getByTestId('traspaso-color-destino'), { target: { value: '8' } });
    fireEvent.click(screen.getByTestId('traspaso-color-guardar'));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        idAlmacenOrigen: 5,
        idAlmacenDestino: 8,
        motivo: 'Va al cortador Pérez',
        lineas: [{ idTelaColor: 11, cantidad: 60, cantidadComplemento: 25 }],
      }),
      expect.anything(),
    );
  });

  /**
   * ⭐ Fila 0.172 — LA GUARDA. Con todo lo demás listo (almacenes distintos y renglón capturado) el
   * botón sigue muerto hasta que hay motivo, y el campo se marca en rojo. Si alguien quitara el
   * `motivoOk` del gate, esta prueba muere en el primer `toBeDisabled`.
   */
  it('sin MOTIVO no deja guardar, aunque todo lo demás esté listo (fila 0.172)', () => {
    mutate.mockReset();
    renderConProveedores(<TraspasoTelaColorPagina />, { sesion: SESION() });

    fireEvent.change(screen.getByTestId('traspaso-color-origen'), { target: { value: '5' } });
    fireEvent.change(screen.getByTestId('traspaso-color-destino'), { target: { value: '8' } });
    fireEvent.click(screen.getByTestId('captura-color-simulada'));

    const motivo = screen.getByTestId('traspaso-color-motivo');
    const guardar = screen.getByTestId('traspaso-color-guardar');
    expect(guardar).toBeDisabled();
    expect(motivo.closest('[data-invalid="true"]')).not.toBeNull();

    // Dos caracteres NO bastan: el mínimo es el mismo que exige el contrato (3, ya recortado).
    fireEvent.change(motivo, { target: { value: ' ab ' } });
    expect(guardar).toBeDisabled();

    fireEvent.change(motivo, { target: { value: 'Reacomodo' } });
    expect(guardar).toBeEnabled();
    expect(motivo.closest('[data-invalid="true"]')).toBeNull();
    fireEvent.click(guardar);
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: 'Reacomodo' }),
      expect.anything(),
    );
    mutate.mockReset();
  });

  // §Post-F9.38 — el papel que va con la tela: se imprime el folio QUE YA EXISTE (el de la pata de
  // salida), no se genera documento nuevo.
  it('tras guardar ofrece la HOJA del traspaso, con el folio de la pata de salida', () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null);
    mutate.mockImplementation((_cuerpo: unknown, opciones: { onSuccess: (t: unknown) => void }) => {
      opciones.onSuccess({
        salida: { id: 700, folio: 4321 },
        entrada: { id: 701, folio: 4322 },
      });
    });
    renderConProveedores(<TraspasoTelaColorPagina />, { sesion: SESION() });

    fireEvent.change(screen.getByTestId('traspaso-color-origen'), { target: { value: '5' } });
    fireEvent.change(screen.getByTestId('traspaso-color-destino'), { target: { value: '8' } });
    fireEvent.click(screen.getByTestId('captura-color-simulada'));
    fireEvent.change(screen.getByTestId('traspaso-color-motivo'), {
      target: { value: 'Va con el chofer' },
    });
    fireEvent.click(screen.getByTestId('traspaso-color-guardar'));

    expect(screen.getByTestId('traspaso-color-guardado')).toHaveTextContent('4321');
    fireEvent.click(screen.getByTestId('traspaso-color-imprimir'));
    expect(abrir).toHaveBeenCalledWith(
      '/api/inventarios/telas/traspasos/700/impreso',
      '_blank',
      'noopener',
    );
    abrir.mockRestore();
    mutate.mockReset();
  });
});
