import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PedidoMesFila, PedidoMesRenglon } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { PanelGenerarOP } from './PanelGenerarOP';

/**
 * GENERAR OP — la confirmación del nº de producción (§Post-F9.34 punto 4 + §Post-F9.46).
 *
 * Nace del hallazgo de Daniel probando la OP 5558: *"heredó el modelo de desarrollo… habíamos
 * acordado que el sistema iba a proponer un modelo de producción y yo solo lo confirmaría"*. Estas
 * pruebas fijan que (a) con un modelo de desarrollo el panel enseña el número PRECARGADO y lo manda
 * al generar, y (b) con un modelo que ya es de producción no estorba con un campo que no aplica.
 */
const generarMutate = vi.fn();
const propuestaMock = vi.fn<(id: number | undefined) => unknown>();

vi.mock('@/api/clientes', () => ({ useCamposCliente: () => ({ data: [] }) }));
vi.mock('@/api/tallas', () => ({
  useTallasActivas: () => ({ data: { datos: [{ id: 5, etiqueta: 'CH' }] } }),
}));
vi.mock('@/api/pedidos-mes', () => ({
  useSalidaProduccion: () => ({ mutate: generarMutate, isPending: false }),
}));
vi.mock('@/api/modelos', () => ({
  usePropuestaProduccion: (id: number | undefined): unknown => propuestaMock(id),
}));
vi.mock('@/modulos/ordenes/AgregarColorMatriz', () => ({
  AgregarColorMatriz: () => null,
}));

// La matriz se sustituye por un stub que siembra UNA celda al montar: lo que se prueba aquí es el
// número de producción, no la captura color×talla (que tiene sus propias pruebas).
vi.mock('@/componentes/matriz-color-talla/MatrizColorTalla', () => ({
  MatrizColorTalla: ({
    onLineasChange,
    onTallasChange,
  }: {
    onLineasChange: (l: unknown[]) => void;
    onTallasChange: (t: unknown[]) => void;
  }) => {
    useEffect(() => {
      onTallasChange([{ idTalla: 5, etiqueta: 'CH' }]);
      onLineasChange([{ idColor: 3, color: 'Negro', cantidades: { 5: 100 } }]);
    }, [onLineasChange, onTallasChange]);
    return <div data-testid="matriz-stub" />;
  },
}));

const pedido = {
  idCliente: 1,
  cliente: 'C&A',
  folio: 90,
  ocCliente: null,
} as unknown as PedidoMesFila;

function renglon(origenModelo: 'desarrollo' | 'produccion'): PedidoMesRenglon {
  return {
    id: 11,
    idModelo: 42,
    codigoModelo: origenModelo === 'desarrollo' ? 'CYA-26-71-003' : '71050',
    origenModelo,
    descripcionModelo: 'Jogger felpa',
    idDesarrollo: origenModelo === 'desarrollo' ? 5 : null,
    numeroCliente: null,
    numeroProduccion: origenModelo === 'desarrollo' ? null : 71_050,
    cantidad: 100,
  } as unknown as PedidoMesRenglon;
}

const propuestaLista = {
  data: {
    numero: 71_003,
    codigo: '71003',
    serie: { par: '71', libre: 3, usados: 4, libres: 995 },
    serieContinuada: false,
    avisos: [],
    yaEnProduccion: false,
  },
  isPending: false,
  isError: false,
  error: null,
};

describe('<PanelGenerarOP> · confirmación del nº de producción', () => {
  beforeEach(() => {
    generarMutate.mockReset();
    propuestaMock.mockReset();
    propuestaMock.mockReturnValue(propuestaLista);
  });

  it('con un modelo de DESARROLLO precarga el número y lo manda al generar la OP', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <PanelGenerarOP
        pedido={pedido}
        renglon={renglon('desarrollo')}
        alCerrar={() => {}}
        alCreada={() => {}}
      />,
      { sesion: estadoSesionDePrueba(['ordenes.administrar']) },
    );

    // Precargado con el propuesto: si llegara vacío, Daniel volvería a quedarse con el de desarrollo.
    expect(await screen.findByTestId('numero-produccion-op')).toHaveValue('71003');

    await usuario.click(screen.getByRole('button', { name: /Generar OP/ }));
    expect(generarMutate).toHaveBeenCalledTimes(1);
    const [args] = generarMutate.mock.calls[0] as [
      { idLinea: number; cuerpo: Record<string, unknown> },
    ];
    expect(args.idLinea).toBe(11);
    expect(args.cuerpo.numeroProduccion).toBe(71_003);
  });

  it('el número se puede cambiar antes de generar', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <PanelGenerarOP
        pedido={pedido}
        renglon={renglon('desarrollo')}
        alCerrar={() => {}}
        alCreada={() => {}}
      />,
      { sesion: estadoSesionDePrueba(['ordenes.administrar']) },
    );

    const campo = await screen.findByTestId('numero-produccion-op');
    await usuario.clear(campo);
    await usuario.type(campo, '71777');
    await usuario.click(screen.getByRole('button', { name: /Generar OP/ }));

    const [args] = generarMutate.mock.calls[0] as [{ cuerpo: Record<string, unknown> }];
    expect(args.cuerpo.numeroProduccion).toBe(71_777);
  });

  it('un modelo YA de producción no pide número (la OP hereda el suyo)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <PanelGenerarOP
        pedido={pedido}
        renglon={renglon('produccion')}
        alCerrar={() => {}}
        alCreada={() => {}}
      />,
      { sesion: estadoSesionDePrueba(['ordenes.administrar']) },
    );

    expect(screen.queryByTestId('confirmar-numero-produccion')).toBeNull();
    // Y no se consulta una propuesta que no aplica.
    expect(propuestaMock).toHaveBeenCalledWith(undefined);

    await usuario.click(screen.getByRole('button', { name: /Generar OP/ }));
    const [args] = generarMutate.mock.calls[0] as [{ cuerpo: Record<string, unknown> }];
    expect(args.cuerpo.numeroProduccion).toBeUndefined();
  });

  it('no genera la OP si el número de un modelo de desarrollo quedó incompleto', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <PanelGenerarOP
        pedido={pedido}
        renglon={renglon('desarrollo')}
        alCerrar={() => {}}
        alCreada={() => {}}
      />,
      { sesion: estadoSesionDePrueba(['ordenes.administrar']) },
    );

    const campo = await screen.findByTestId('numero-produccion-op');
    await usuario.clear(campo);
    await usuario.type(campo, '710');
    await usuario.click(screen.getByRole('button', { name: /Generar OP/ }));
    expect(generarMutate).not.toHaveBeenCalled();
  });
});
