import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EsMaRecibosSemanales } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { RecibosSemanalesEsMaPagina } from './RecibosSemanalesEsMaPagina';
import { EstadoCuentaPagina } from './EstadoCuentaPagina';

/**
 * ⭐ 0.114 — QUÉ TIPOS OFRECE EL FILTRO DE CADA PANTALLA DE EsMa.
 *
 * Al poner el corte y el empaque del lado de la maquila (*«corte es parte de maquilas… y una
 * maquila de empaque también»*), los dos entraron a `ROLES_MAQUILA_ESMA` y por tanto al selector de
 * maquileros. Pero **no todas las pantallas que usan ese selector leen lo mismo**:
 *
 *  • **Recibos semanales** arma su reporte leyendo `EtapaMovimiento` de tipo `recibo_maquila`
 *    (`esma/semanales.ts`). El corte y el empaque **no generan recibos** —ésa es su definición:
 *    *«no va y viene»*—, así que elegir «Corte» ahí devolvía SIEMPRE un reporte vacío, sin decir
 *    por qué. Su filtro se acota a los servicios de IDA Y VUELTA.
 *  • **Estado de cuenta** (y el desglosado) leen CARGOS, y los de corte/empaque son justo lo que la
 *    0.114 vino a hacer visible ahí. Ésos SÍ los ofrecen.
 *
 * Las dos mitades se fijan aquí juntas a propósito: si mañana alguien "unifica" los selectores,
 * una de las dos pruebas se pone roja y explica cuál de las dos pantallas se rompió.
 */

const reporteVacio: EsMaRecibosSemanales = {
  desde: null,
  hasta: null,
  filas: [],
  totalCantidad: 0,
  totalImporte: 0,
};

vi.mock('@/api/esma', () => ({
  useRecibosSemanalesEsMa: () => ({
    data: reporteVacio,
    isPending: false,
    isError: false,
    error: null,
  }),
  useMaquilerosEsMa: () => ({
    data: { filas: [{ id: 5, nombre: 'Taller Ejemplo Uno', nombreCorto: null }] },
    isPending: false,
    isFetching: false,
    isError: false,
  }),
  // Los que necesita `EstadoCuentaPagina` (la otra mitad del contraste).
  useEstadoCuenta: () => ({ data: undefined, isPending: false, isError: false, error: null }),
  useRevisarMovimiento: () => ({ mutate: vi.fn(), isPending: false }),
  useSaldoMaquilero: () => ({ data: undefined, isPending: false, isError: false, error: null }),
  imprimirEstadoCuenta: vi.fn(),
  descargarExcelEstadoCuenta: vi.fn(),
}));
vi.mock('@/api/wip', () => ({
  useExistenciaMaquilero: () => ({
    data: { filas: [], totalEnPoder: 0 },
    isPending: false,
    isError: false,
  }),
}));

/** Los `value` de las opciones de un `<select>`, en orden. */
function valoresDe(idTestid: string): string[] {
  const select = screen.getByTestId(idTestid);
  return within(select)
    .getAllByRole('option')
    .map((o) => (o as HTMLOptionElement).value);
}

describe('RecibosSemanalesEsMaPagina · el filtro de tipo (0.114)', () => {
  it('🔴 NO ofrece Corte ni Empaque: este reporte sale de los RECIBOS, y esos no tienen', () => {
    renderConProveedores(<RecibosSemanalesEsMaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
    });
    // «Todos» sigue existiendo, y significa "cualquier rol de maquila" — el backend resuelve ese
    // conjunto (`ROLES_MAQUILA_ESMA`), así que acotar el filtro NO esconde a nadie de «Todos».
    expect(valoresDe('recsem-tipo')).toEqual(['', 'costura', 'estampado']);
    expect(screen.queryByRole('option', { name: 'Corte' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Empaque' })).not.toBeInTheDocument();
  });
});

describe('EstadoCuentaPagina · el filtro de tipo (0.114)', () => {
  it('⭐ SÍ ofrece Corte y Empaque: aquí se leen CARGOS, y los servicios sí los generan', () => {
    renderConProveedores(<EstadoCuentaPagina />, {
      sesion: estadoSesionDePrueba(['esma.ver-pagos']),
    });
    expect(valoresDe('edc-tipo')).toEqual(['', 'costura', 'estampado', 'corte', 'empaque']);
  });
});
