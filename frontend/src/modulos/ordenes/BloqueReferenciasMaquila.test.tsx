import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

/**
 * ⭐ Fila 0.242 — el bloque de REFERENCIAS DE MAQUILA del panel de precios: enseña lo que el servidor
 * manda (montos tapados ⇒ •••••), marca los procesos sin referencia, y arma el cuerpo correcto al
 * capturar (costura por `idTipoProceso`, arte por `idOrdenArte`). La capa de datos va simulada.
 */
const estado = vi.hoisted(() => ({
  ocultas: false,
  mutate: vi.fn(),
}));

const procesos = () => [
  {
    idTipoProceso: 1,
    codigo: 'costura',
    nombre: 'Costura',
    esArte: false,
    estado: 'lista',
    referencia: estado.ocultas ? null : 10,
    tope: estado.ocultas ? null : 10.5,
    origen: 'precosto',
    renglones: [],
    ultimoCambio: { capturadoPor: 'Daniel Masri', capturadoEn: '2026-10-01T12:00:00.000Z' },
  },
  {
    idTipoProceso: 2,
    codigo: 'estampado',
    nombre: 'Estampado',
    esArte: true,
    estado: 'arte-sin-precio',
    referencia: null,
    tope: null,
    origen: null,
    renglones: [
      {
        idOrdenArte: 7,
        descripcion: 'Logo pecho',
        posicion: null,
        precio: estado.ocultas ? null : 3,
      },
      { idOrdenArte: 8, descripcion: 'Logo espalda', posicion: 'espalda', precio: null },
    ],
    ultimoCambio: null,
  },
];

vi.mock('@/api/referencias-maquila', () => ({
  useReferenciasMaquila: () => ({
    data: { idOrden: 50, folioOrden: 1515, ocultas: estado.ocultas, procesos: procesos() },
    isPending: false,
    isError: false,
  }),
  useCapturarReferencia: () => ({ mutate: estado.mutate, isPending: false }),
}));

const { BloqueReferenciasMaquila } = await import('./BloqueReferenciasMaquila');

const CAPTURA = ['ordenes.ver', 'ordenes.precio-maquila'] as const;

describe('BloqueReferenciasMaquila (fila 0.242)', () => {
  beforeEach(() => {
    estado.ocultas = false;
    estado.mutate.mockReset();
  });

  it('pinta la referencia y su tope, el origen, y marca el arte al que le falta precio', () => {
    renderConProveedores(<BloqueReferenciasMaquila idOrden={50} ordenCerrada={false} />, {
      sesion: estadoSesionDePrueba([...CAPTURA]),
    });
    const costura = screen.getByTestId('referencia-costura');
    expect(costura).toHaveTextContent('$10.00');
    expect(costura).toHaveTextContent('$10.50');
    expect(costura).toHaveTextContent('del precosto');
    expect(screen.getByTestId('referencia-estampado-falta')).toHaveTextContent(
      'falta precio de un arte',
    );
  });

  it('tapadas: ••••• en vez de montos, sin un solo «$»', () => {
    estado.ocultas = true;
    renderConProveedores(<BloqueReferenciasMaquila idOrden={50} ordenCerrada={false} />, {
      sesion: estadoSesionDePrueba(['ordenes.ver']),
    });
    expect(screen.getByTestId('referencias-maquila')).not.toHaveTextContent('$');
    expect(screen.getByTestId('referencias-maquila')).toHaveTextContent('•••••');
  });

  it('sin `ordenes.precio-maquila` no ofrece editar; con la orden cerrada tampoco', () => {
    const { unmount } = renderConProveedores(
      <BloqueReferenciasMaquila idOrden={50} ordenCerrada={false} />,
      { sesion: estadoSesionDePrueba(['ordenes.ver']) },
    );
    expect(screen.queryByTestId('referencia-costura-editar')).not.toBeInTheDocument();
    unmount();
    renderConProveedores(<BloqueReferenciasMaquila idOrden={50} ordenCerrada />, {
      sesion: estadoSesionDePrueba([...CAPTURA]),
    });
    expect(screen.queryByTestId('referencia-costura-editar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('referencia-arte-7-editar')).not.toBeInTheDocument();
  });

  it('costura se captura por `idTipoProceso`; el arte, por `idOrdenArte` (nunca al revés)', () => {
    renderConProveedores(<BloqueReferenciasMaquila idOrden={50} ordenCerrada={false} />, {
      sesion: estadoSesionDePrueba([...CAPTURA]),
    });
    fireEvent.click(screen.getByTestId('referencia-costura-editar'));
    fireEvent.change(screen.getByTestId('referencia-precio-input'), { target: { value: '11' } });
    fireEvent.click(screen.getByTestId('referencia-guardar'));
    expect(estado.mutate).toHaveBeenLastCalledWith(
      { idOrden: 50, cuerpo: { idTipoProceso: 1, precio: 11 } },
      expect.anything(),
    );

    fireEvent.click(screen.getByTestId('referencia-arte-8-editar'));
    fireEvent.change(screen.getByTestId('referencia-precio-input'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('referencia-guardar'));
    expect(estado.mutate).toHaveBeenLastCalledWith(
      { idOrden: 50, cuerpo: { idOrdenArte: 8, precio: 4 } },
      expect.anything(),
    );
  });
});
