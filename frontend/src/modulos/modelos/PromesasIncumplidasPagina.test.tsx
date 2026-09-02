import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PromesaIncumplida } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { PromesasIncumplidasPagina, textoBrecha } from './PromesasIncumplidasPagina';

const usePromesasIncumplidasMock = vi.fn();
/**
 * 🔴 El mock de la FIRMA se declara **a propósito, y tiene que quedar SIN LLAMAR**: esta pantalla es
 * de SOLO LECTURA, igual que su hermana la bandeja. «Avisar no es bloquear» (§Post-F9.64), y avisar
 * tampoco es firmar. Si alguien cuelga aquí un botón que apruebe o corrija, el conteo lo delata.
 */
const aprobarMutateMock = vi.fn();

vi.mock('@/api/modelos', () => ({
  usePromesasIncumplidas: (filtros: unknown) => usePromesasIncumplidasMock(filtros) as unknown,
  useAprobarRevisionModelo: () => ({ mutate: aprobarMutateMock, isPending: false }),
}));

/** El destino de la navegación: PINTA el id que recibió, no un rótulo fijo (cicatriz de V1-E3j). */
function DestinoModelo(): React.JSX.Element {
  const location = useLocation();
  const estado = location.state as { idModelo?: number } | null;
  return <p>FICHA DEL MODELO con id {String(estado?.idModelo)}</p>;
}

/** Una promesa incumplida, con datos que se parecen a los REALES (V1-E8q). */
function fila(over: Partial<PromesaIncumplida> = {}): PromesaIncumplida {
  return {
    idModelo: 812,
    codigo: 'CYA-26-71-001-01',
    descripcion: 'Sudadera sin cierre (negociada)',
    codigoPadre: 'CYA-26-71-001',
    versionDesarrollo: 1,
    cliente: 'C&A México',
    proyecto: 'Otoño-Invierno 26',
    costoPrometido: 43,
    costoConseguido: 45,
    brecha: 2,
    piezasPedidas: 12_000,
    impacto: 24_000,
    nota: 'ninguna maquila bajó de $18 con la jareta nueva',
    revisadoPor: 'Aurora',
    revisadoEn: '2026-09-01T16:00:00.000Z',
    ...over,
  };
}

function render(filas: PromesaIncumplida[], impactoTotal = 24_000): void {
  usePromesasIncumplidasMock.mockReturnValue({
    data: {
      datos: filas,
      total: filas.length,
      impactoTotal,
      pagina: 1,
      porPagina: 20,
      totalPaginas: 1,
    },
    isPending: false,
    isError: false,
    isFetching: false,
  });
  renderConProveedores(
    <Routes>
      <Route path="/modelos/promesas-incumplidas" element={<PromesasIncumplidasPagina />} />
      <Route path="/modelos" element={<DestinoModelo />} />
    </Routes>,
    {
      sesion: estadoSesionDePrueba(['modelos.ver', 'consultas.ver-importes']),
      rutaInicial: '/modelos/promesas-incumplidas',
    },
  );
}

/**
 * ⭐⭐ «PROMESAS INCUMPLIDAS» — V1-E9p (§Post-F9.144(b), DANIEL 29-ago-2026).
 *
 * *«Desarrollo cuadra la receta con la maquila que sí consiguió, el renglón se va de la bandeja como
 * "resuelto", y **nadie se entera de que el margen que Daniel vendió ya no existe**»*. Estas pruebas
 * fijan que ese *«nadie se entera»* ya no puede pasar: la brecha se ve, con nombre y con importe.
 */
describe('<PromesasIncumplidasPagina> (V1-E9p)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('⭐⭐ «prometí 43, conseguí 45»: se ve la brecha, con quién se negoció y lo que cuesta', () => {
    render([fila()]);

    const f = screen.getByTestId('pi-fila');
    expect(within(f).getByText('CYA-26-71-001-01')).toBeInTheDocument();
    expect(within(f).getByText('C&A México')).toBeInTheDocument();
    expect(within(f).getByText('$43.00')).toBeInTheDocument();
    expect(within(f).getByText('$45.00')).toBeInTheDocument();
    expect(within(f).getByTestId('pi-brecha')).toHaveTextContent('+$2.00');
    expect(within(f).getByTestId('pi-impacto')).toHaveTextContent('$24,000.00');
    // El porqué, que es lo que convierte el número en algo accionable.
    expect(within(f).getByTestId('pi-nota')).toHaveTextContent('ninguna maquila bajó de $18');
  });

  it('⭐⭐ el MARGEN COMPROMETIDO del encabezado es el del SERVIDOR, no la suma de la página', () => {
    // 🔴 Esta pantalla NO suma nada (A1). Se le pasan DOS filas cuyos impactos suman 26,000 y un
    // `impactoTotal` de 99,000 (el de toda la cartera, con más páginas detrás): tiene que pintar el
    // del servidor. Si alguien "simplificara" sumando aquí, el total cambiaría con cada página.
    render([fila(), fila({ idModelo: 813, codigo: 'CYA-26-71-002-01', impacto: 2_000 })], 99_000);

    expect(screen.getByTestId('pi-impacto-total')).toHaveTextContent('$99,000.00');
    expect(screen.getByTestId('pi-total')).toHaveTextContent('2 modelos');
  });

  it('⭐ SIN meta guardada no inventa una brecha: pinta un guion, no un cero', () => {
    // Un 0 diría «se cumplió exacto» justo cuando no se sabe nada — la mentira más cara de aquí.
    render([fila({ costoPrometido: null, brecha: null, impacto: null })], 0);

    const f = screen.getByTestId('pi-fila');
    expect(within(f).queryByTestId('pi-brecha')).toBeNull();
    expect(within(f).queryByTestId('pi-impacto')).toBeNull();
    // Y lo que SÍ se sabe se sigue viendo: lo conseguido y el porqué.
    expect(within(f).getByText('$45.00')).toBeInTheDocument();
    expect(within(f).getByTestId('pi-nota')).toBeInTheDocument();
  });

  it('sin pedido todavía: hay brecha, y el margen comprometido es $0 (no le cuesta a nadie… aún)', () => {
    render([fila({ piezasPedidas: 0, impacto: 0 })], 0);

    const f = screen.getByTestId('pi-fila');
    expect(within(f).getByTestId('pi-brecha')).toHaveTextContent('+$2.00');
    expect(within(f).getByTestId('pi-impacto')).toHaveTextContent('$0.00');
  });

  it('⭐ lleva a la ficha del modelo CON SU ID (no a una pantalla cualquiera)', async () => {
    const usuario = userEvent.setup();
    render([fila()]);

    await usuario.click(screen.getByTestId('pi-ver-812'));
    expect(screen.getByText('FICHA DEL MODELO con id 812')).toBeInTheDocument();
  });

  it('🔴 es de SOLO LECTURA: no firma ni corrige nada desde aquí', () => {
    render([fila()]);
    expect(aprobarMutateMock).not.toHaveBeenCalled();
  });

  it('el vacío dice lo que significa: todo lo que se negoció, se consiguió', () => {
    render([], 0);
    expect(screen.getByTestId('pi-vacio')).toHaveTextContent(
      'todo lo que se negoció, se consiguió',
    );
  });
});

describe('textoBrecha — el signo, enunciado', () => {
  it('⭐ POSITIVA lleva «+»: costó MÁS de lo que se vendió', () => {
    expect(textoBrecha({ brecha: 2 })).toBe('+$2.00');
  });

  it('NEGATIVA no lleva «+»: se consiguió mejor de lo prometido', () => {
    // Sin esta pareja, un `'+' + …` fijo pasaría la de arriba y pintaría «+-$3.00».
    expect(textoBrecha({ brecha: -3 })).toBe('-$3.00');
  });

  it('sin brecha, un guion — que no es lo mismo que $0.00', () => {
    expect(textoBrecha({ brecha: null })).toBe('—');
  });
});
