import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecetaPorRevisar } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { RecetasPorRevisarPagina, textoPedidoDetenido } from './RecetasPorRevisarPagina';

const useRecetasPorRevisarMock = vi.fn();
/**
 * 🔴 El mock de la FIRMA se declara **a propósito, y tiene que quedar SIN LLAMAR.** «La bandeja no
 * firma: lleva» (§Post-F9.80). Si alguien vuelve a colgar una aprobación de esta pantalla, el
 * conteo de llamadas lo delata; sin el mock, nada lo delataría.
 */
const aprobarMutateMock = vi.fn();

vi.mock('@/api/modelos', () => ({
  useRecetasPorRevisar: (filtros: unknown) => useRecetasPorRevisarMock(filtros) as unknown,
  useAprobarRevisionModelo: () => ({ mutate: aprobarMutateMock, isPending: false }),
}));

/**
 * El destino de la navegación. **PINTA el id que recibió** en el `state`, no un rótulo fijo: con un
 * texto fijo, la prueba sólo comprobaría que *alguna* pantalla montó, y un refactor que perdiera el
 * id mandaría a revisar la receta de OTRO modelo con las pruebas en verde (cicatriz de V1-E3j).
 */
function DestinoModelo(): React.JSX.Element {
  const location = useLocation();
  const estado = location.state as { idModelo?: number } | null;
  return <p>FICHA DEL MODELO con id {String(estado?.idModelo)}</p>;
}

/**
 * Una fila de la bandeja. Los datos se parecen a los REALES a propósito (`CYA-26-71-001-01` nacido
 * de `CYA-26-71-001`, C&A México): un fixture que no se parece al mundo esconde el defecto — la
 * lección de V1-E8q, donde un id con forma de nombre tapó que la pantalla pintaba un id crudo.
 */
function fila(over: Partial<RecetaPorRevisar> = {}): RecetaPorRevisar {
  return {
    idModelo: 812,
    codigo: 'CYA-26-71-001-01',
    descripcion: 'Sudadera sin cierre (negociada)',
    codigoPadre: 'CYA-26-71-001',
    versionDesarrollo: 1,
    estado: 'pendiente',
    revisionNota: null,
    // ⭐⭐ V1-E9p — LO PROMETIDO en la mesa. null = esta versión no vino de una negociación
    // registrada, que es el caso «se comporta como siempre».
    costoPrometido: null,
    creadoEn: '2026-08-20T16:00:00.000Z',
    cliente: 'C&A México',
    proyecto: 'Otoño-Invierno 26',
    fechaCompromiso: null,
    piezasPedidas: 0,
    conPedido: false,
    ...over,
  };
}

function render(filas: RecetaPorRevisar[], permisos = ['modelos.ver']): void {
  useRecetasPorRevisarMock.mockReturnValue({
    data: { datos: filas, total: filas.length, pagina: 1, porPagina: 20, totalPaginas: 1 },
    isPending: false,
    isError: false,
    isFetching: false,
  });
  renderConProveedores(
    <Routes>
      <Route path="/modelos/recetas-por-revisar" element={<RecetasPorRevisarPagina />} />
      <Route path="/modelos" element={<DestinoModelo />} />
    </Routes>,
    {
      sesion: estadoSesionDePrueba(permisos as never),
      rutaInicial: '/modelos/recetas-por-revisar',
    },
  );
}

/**
 * ⭐⭐ BANDEJA «Recetas por revisar» (V1-E8r, §Post-F9.140 — DANIEL, 29-ago-2026).
 *
 * Estas pruebas fijan lo que la bandeja existe para hacer: que **se VEA** qué se negoció, con quién
 * y qué está frenando, y que se **ENTRE** a la ficha a revisarlo — sin firmar nada desde aquí.
 */
describe('<RecetasPorRevisarPagina> (V1-E8r)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('🔴 lo que Daniel pidió VER, se ve: la versión, de qué receta original salió y con quién se negoció', () => {
    render([fila()]);

    const f = screen.getByTestId('rpr-fila');
    expect(within(f).getByText('CYA-26-71-001-01')).toBeInTheDocument();
    expect(within(f).getByText('CYA-26-71-001')).toBeInTheDocument();
    expect(within(f).getByText('C&A México')).toBeInTheDocument();
    expect(within(f).getByText('Sin revisar')).toBeInTheDocument();
  });

  it('⭐ marca la que YA FRENA DINERO, con las piezas que trae detenidas', () => {
    render([
      fila({ conPedido: true, piezasPedidas: 1200, fechaCompromiso: '2026-09-01' }),
      fila({ idModelo: 813, codigo: 'CYA-26-71-002-01' }),
    ]);

    const marcadas = screen.getAllByTestId('rpr-frena-dinero');
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0]).toHaveTextContent('Frena 1,200 pzas');
    expect(screen.getByText('2026-09-01')).toBeInTheDocument();
  });

  it('la RECHAZADA se distingue y enseña su motivo sin tener que abrirla', () => {
    render([
      fila({
        estado: 'rechazada',
        revisionNota: 'El forro negociado no lo teje ningún proveedor con ese gramaje.',
      }),
    ]);

    const f = screen.getByTestId('rpr-fila');
    expect(within(f).getByText('Rechazada')).toBeInTheDocument();
    expect(within(f).getByTestId('rpr-nota')).toHaveTextContent('gramaje');
  });

  it('🔴 LA BANDEJA NO FIRMA: la fila ofrece EXACTAMENTE dos controles y los dos llevan a la ficha', () => {
    render([fila()]);

    // El número es la aserción: con un tercer botón (el de aprobar) se pone roja.
    const botones = within(screen.getByTestId('rpr-fila')).getAllByRole('button');
    expect(botones).toHaveLength(2);
    expect(botones.map((b) => b.getAttribute('data-testid'))).toEqual([
      'rpr-abrir-812', // el código
      'rpr-ver-812', // «Ver la receta»
    ]);
    expect(within(screen.getByTestId('rpr-fila')).queryByText(/Aprobar/)).toBeNull();
  });

  it('🔴 «Ver la receta» LLEVA al modelo correcto y NO firma nada de paso', async () => {
    const usuario = userEvent.setup();
    render([fila()]);

    await usuario.click(screen.getByTestId('rpr-ver-812'));

    expect(await screen.findByText('FICHA DEL MODELO con id 812')).toBeInTheDocument();
    expect(aprobarMutateMock).not.toHaveBeenCalled();
  });

  it('el filtro «solo las que ya frenan un pedido» viaja al SERVIDOR (no se filtra aquí)', async () => {
    const usuario = userEvent.setup();
    render([fila()]);

    await usuario.click(screen.getByTestId('rpr-solo-con-pedido'));

    expect(useRecetasPorRevisarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ soloConPedido: true }),
    );
  });

  it('sin nada que revisar, lo dice', () => {
    render([]);

    expect(screen.getByTestId('rpr-vacio')).toBeInTheDocument();
  });
});

describe('textoPedidoDetenido', () => {
  it('enuncia las piezas que YA vienen agregadas del servidor (aquí no se suma nada)', () => {
    expect(textoPedidoDetenido({ piezasPedidas: 1200 })).toBe('Frena 1,200 pzas');
    expect(textoPedidoDetenido({ piezasPedidas: 80 })).toBe('Frena 80 pzas');
  });
});

/**
 * ⭐⭐ V1-E9p (§Post-F9.144(b)) — **LA META A LA VISTA.** La bandeja preguntaba *«¿ya capturaste?»*;
 * la pregunta buena es *«¿se logró lo prometido?»*, y **no se puede contestar sin ver contra qué**.
 */
describe('<RecetasPorRevisarPagina> — «Prometido» (V1-E9p)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('⭐ enseña el costo con el que se cerró la mesa, formateado como dinero', () => {
    render([fila({ costoPrometido: 43 })]);
    expect(screen.getByTestId('rpr-prometido')).toHaveTextContent('$43.00');
  });

  it('⭐ con la meta en null la fila se comporta como siempre (sin mesa, o sin ver importes)', () => {
    // 🔴 La aserción en NEGATIVO: sin meta no se pinta un 0 —que diría «se prometió gratis»— ni se
    // rompe la fila. Se pinta un guion, y todo lo demás sigue exactamente igual.
    //
    // ⚠️ El null llega por DOS caminos y aquí se prueban los dos de una vez, porque la pantalla no
    // los distingue: la versión no vino de una mesa, o quien mira no tiene `consultas.ver-importes`
    // y el SERVIDOR le ocultó el importe (la reja la fija `recetas-por-revisar.test.ts`).
    render([fila({ costoPrometido: null })]);

    expect(screen.queryByTestId('rpr-prometido')).toBeNull();
    const f = screen.getByTestId('rpr-fila');
    expect(within(f).getByText('CYA-26-71-001-01')).toBeInTheDocument();
    expect(within(f).getByText('C&A México')).toBeInTheDocument();
    expect(within(f).getByText('Sin revisar')).toBeInTheDocument();
  });

  it('la bandeja SIGUE sin firmar: enseñar la meta no le da un botón de aprobar', () => {
    // «NO FIRMA, LLEVA» (§Post-F9.140 punto 4). Que ahora muestre dinero no la convierte en una
    // segunda autoridad: el desenlace se declara al firmar, en la ficha del modelo.
    render([fila({ costoPrometido: 43 })]);
    expect(aprobarMutateMock).not.toHaveBeenCalled();
  });
});
