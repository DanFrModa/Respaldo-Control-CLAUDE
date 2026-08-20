import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecetaPorLiberar } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { RecetasPorLiberarPagina, textoFalta } from './RecetasPorLiberarPagina';

const useRecetasPorLiberarMock = vi.fn();
const liberarMutateMock = vi.fn();

vi.mock('@/api/receta-orden', () => ({
  useRecetasPorLiberar: (filtros: unknown) => useRecetasPorLiberarMock(filtros) as unknown,
  useLiberarReceta: () => ({ mutate: liberarMutateMock, isPending: false }),
}));

/** El destino de la navegación, que DELATA a qué orden llegó (nunca un rótulo fijo). */
function DestinoReceta(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  return <p>RECETA COMPLETA de la OP con id {id}</p>;
}

/** Una fila de la bandeja (por default: 1 tela y 2 avíos pendientes, sin OC). */
function fila(over: Partial<RecetaPorLiberar> = {}): RecetaPorLiberar {
  return {
    idOrden: 50,
    folio: 101,
    idModelo: 9,
    modelo: 'A-100',
    cliente: 'C&A',
    fechaEntrega: '2026-09-01',
    telas: 1,
    avios: 2,
    artes: 0,
    porLiberar: 3,
    conOrdenCompra: false,
    ...over,
  };
}

function render(
  filas: RecetaPorLiberar[],
  permisos = ['desarrollo.ver', 'desarrollo.administrar', 'ordenes.ver'],
): void {
  useRecetasPorLiberarMock.mockReturnValue({
    data: { datos: filas, total: filas.length, pagina: 1, porPagina: 20, totalPaginas: 1 },
    isPending: false,
    isError: false,
    isFetching: false,
  });
  renderConProveedores(
    <Routes>
      <Route path="/desarrollo/recetas-por-liberar" element={<RecetasPorLiberarPagina />} />
      {/* El destino real de la fila (V1-E3j): la pantalla propia de la receta de ESA orden.
          ⚠️ El destino PINTA EL ID de la ruta a propósito (hallazgo del reviewer): con un texto fijo,
          `path="…/:id/receta"` matchea CUALQUIER id y la prueba solo comprobaba que *alguna*
          pantalla montó — un refactor que perdiera el id mandaría a firmar la receta de OTRA OP y
          las pruebas seguirían verdes. */}
      <Route path="/produccion/ordenes/:id/receta" element={<DestinoReceta />} />
    </Routes>,
    {
      sesion: estadoSesionDePrueba(permisos as never),
      rutaInicial: '/desarrollo/recetas-por-liberar',
    },
  );
}

/**
 * BANDEJA «Recetas por liberar» (V1-E3h, §Post-F9.72 — DANIEL: *"está buenísima"*).
 *
 * Lo que estas pruebas fijan es lo que la bandeja existe para hacer: que se pueda VER de un vistazo
 * qué falta firmar y CUÁL está frenando dinero, y que se pueda firmar SIN dar la vuelta por el
 * Centro de Órdenes. Si algo de eso se pierde, la bandeja deja de servir para lo que se pidió.
 */
describe('<RecetasPorLiberarPagina> (V1-E3h)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('una fila por ORDEN, con el conteo por tipo redactado', () => {
    render([fila()]);

    const f = screen.getByTestId('rpl-fila');
    expect(within(f).getByText('101')).toBeInTheDocument();
    expect(within(f).getByText('A-100')).toBeInTheDocument();
    expect(within(f).getByText('2026-09-01')).toBeInTheDocument();
    expect(within(f).getByText('1 tela, 2 avíos')).toBeInTheDocument();
  });

  it('⭐ marca la que YA FRENA DINERO (tiene OC por otra parte de su receta)', () => {
    render([fila({ conOrdenCompra: true }), fila({ idOrden: 51, folio: 102 })]);

    const marcadas = screen.getAllByTestId('rpl-frena-dinero');
    expect(marcadas).toHaveLength(1);
  });

  /**
   * ⭐ EL BOTÓN TIENE QUE FUNCIONAR EN EL CASO NORMAL. La receta se copia del modelo al crear la
   * orden y sus renglones nacen `sin_revisar`; sin `revisarPendientes` el servidor contesta
   * *"quedan 3 renglones sin revisar"* y obliga a ir al Centro de Órdenes a marcarlos y volver —
   * **la vuelta que esta bandeja existe para evitar**, y para el 100 % de las órdenes que nadie ha
   * tocado, que son justo las que la llenan.
   */
  it('⭐ se REVISA Y LIBERA desde aquí, sin dar la vuelta por el Centro de Órdenes', async () => {
    const usuario = userEvent.setup();
    render([fila()]);

    await usuario.click(screen.getByTestId('rpl-liberar-50'));

    expect(liberarMutateMock.mock.calls[0]?.[0]).toMatchObject({
      idOrden: 50,
      cuerpo: { alcance: 'todo', revisarPendientes: true },
    });
  });

  it('el botón dice lo que hace (revisa además de firmar), no solo "liberar"', () => {
    render([fila()]);
    expect(screen.getByTestId('rpl-liberar-50')).toHaveTextContent(/Revisar y liberar/);
  });

  it('sin `desarrollo.administrar` se VE pero no se libera (§Post-F9.68)', () => {
    render([fila()], ['desarrollo.ver', 'ordenes.ver']);

    expect(screen.getByTestId('rpl-fila')).toBeInTheDocument();
    expect(screen.queryByTestId('rpl-liberar-50')).toBeNull();
  });

  /**
   * ⭐⭐ V1-E3j — EL HUECO QUE REPORTÓ DANIEL (19-ago-2026): *"solo está la OC con un botón para
   * liberar todas juntas («Revisar y liberar»). No veo dónde pueda ver todo completo e ir liberando
   * una por una."* La bandeja sabía QUÉ falta pero no llevaba a NINGÚN lado a resolverlo con detalle.
   */
  it('⭐ V1-E3j: «Ver la receta» lleva a la pantalla completa de ESA orden', async () => {
    const usuario = userEvent.setup();
    render([fila()]);

    await usuario.click(screen.getByTestId('rpl-ver-50'));

    // Y a la de ESA orden: el id viaja en la URL, no es "alguna" pantalla de receta.
    expect(screen.getByText('RECETA COMPLETA de la OP con id 50')).toBeInTheDocument();
  });

  it('⭐ V1-E3j: el FOLIO también entra a la receta (antes se iba al Centro de Órdenes)', async () => {
    const usuario = userEvent.setup();
    render([fila()]);

    await usuario.click(screen.getByTestId('rpl-abrir-50'));

    expect(screen.getByText('RECETA COMPLETA de la OP con id 50')).toBeInTheDocument();
  });

  it('⭐ V1-E3j: el camino al detalle existe SIN `ordenes.ver` (la receta es de Desarrollo)', () => {
    // Antes el folio se gateaba con `ordenes.ver` porque llevaba al panel de la OP. Su destino de
    // hoy —la receta— lo gobierna `desarrollo.ver`, el mismo permiso que abre esta bandeja: un
    // usuario de Desarrollo puro ya no se queda sin manera de entrar (§Post-F9.72).
    render([fila()], ['desarrollo.ver']);

    expect(screen.getByTestId('rpl-abrir-50')).toBeInTheDocument();
    expect(screen.getByTestId('rpl-ver-50')).toBeInTheDocument();
  });

  it('⭐ V1-E3j: «Revisar y liberar» NO se pierde — sigue siendo el atajo (§Post-F9.75)', () => {
    render([fila()]);
    const f = screen.getByTestId('rpl-fila');
    expect(within(f).getByTestId('rpl-liberar-50')).toBeInTheDocument();
    expect(within(f).getByTestId('rpl-ver-50')).toBeInTheDocument();
  });

  it('el filtro "solo las que ya frenan compras" viaja al SERVIDOR (no se filtra aquí)', async () => {
    const usuario = userEvent.setup();
    render([fila()]);

    await usuario.click(screen.getByTestId('rpl-solo-con-oc'));

    const ultima = useRecetasPorLiberarMock.mock.calls.at(-1)?.[0] as {
      soloConOrdenCompra: boolean;
    };
    expect(ultima.soloConOrdenCompra).toBe(true);
  });

  it('sin pendientes lo dice en positivo (no un vacío mudo)', () => {
    render([]);
    expect(screen.getByTestId('rpl-vacio')).toHaveTextContent(
      /Todo lo que se puede comprar, está autorizado/,
    );
  });
});

describe('textoFalta — el conteo por tipo, redactado', () => {
  it('singular y plural por tipo, y omite los tipos en cero', () => {
    expect(textoFalta({ telas: 1, avios: 0, artes: 0, porLiberar: 1 })).toBe('1 tela');
    expect(textoFalta({ telas: 2, avios: 3, artes: 1, porLiberar: 6 })).toBe(
      '2 telas, 3 avíos, 1 arte',
    );
  });

  it('si el servidor no desglosa, se enuncia el total (nunca una cadena vacía)', () => {
    expect(textoFalta({ telas: 0, avios: 0, artes: 0, porLiberar: 4 })).toBe('4 renglones');
  });
});
