import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MesaCuerpo, SimulacionMesa } from '@/api/negociacion';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { MesaNegociacion } from './MesaNegociacion';

/**
 * ⭐⭐ EL NEGOCIADOR EN VIVO (§Post-F9.138) — pruebas de PANTALLA.
 *
 * 🔴 Lo que Daniel pidió **VER** se prueba que **SE VE**: no basta con que el endpoint conteste. La
 * prueba central mueve un costo con el teclado y exige que **el margen cambie en la pantalla**, que
 * es literalmente el requisito (*"ir viendo como se va moviendo el margen si modifico cada
 * elemento"*).
 *
 * El "servidor" de estas pruebas calcula con la MISMA cascada del dominio (margen 50 / descuentos 10
 * / regalías 5 / costo de ventas 5 ⇒ los factores del cliente de ejemplo), así que los números que se
 * aseveran son los de verdad; la aritmética en sí la prueban `precio-lista.test.ts` y la integración.
 */

const cuerposVistos: MesaCuerpo[] = [];

/** La cascada D2, igual que `calcularPrecioLista`/`simularMargenNegociacion` (factores 50/10/5/5). */
function servidorFalso(cuerpo: MesaCuerpo): SimulacionMesa {
  const costoSimulado = Math.round(cuerpo.renglones.reduce((s, r) => s + r.importe, 0) * 100) / 100;
  const precioNeto = cuerpo.precioObjetivo * 0.8;
  const margenBrutoPct = precioNeto > 0 ? ((precioNeto - costoSimulado) / precioNeto) * 100 : 0;
  return {
    costoVigente: 40,
    costoSimulado,
    deltaCosto: Math.round((costoSimulado - 40) * 100) / 100,
    precioObjetivo: cuerpo.precioObjetivo,
    precioSugerido: Math.ceil(costoSimulado / 0.5 / 0.8),
    precioNeto,
    margenBrutoPct,
    margenObjetivoPct: 50,
    cumpleObjetivo: margenBrutoPct >= 50,
  };
}

/** Sin `listas.aprobar` el servidor devuelve los CINCO derivados en null (§Post-F9.125(b)). */
let conPermisoDeMargen = true;

// ⚠️ El resultado del desglose se declara UNA vez y se devuelve SIEMPRE el mismo objeto, porque eso
// es lo que hace TanStack Query de verdad (`data` es estable entre renders mientras no cambie). Un
// mock que fabrica un objeto nuevo en cada render no es "más estricto": es OTRO componente el que se
// prueba, con un `useEffect` disparándose sin parar.
const DESGLOSE = {
  data: {
    idPrecosto: 11,
    versionPrecosto: 1,
    grupos: [
      { codigo: 'tela', nombre: 'Tela', subtotal: 30 },
      { codigo: 'avios', nombre: 'Avíos', subtotal: 0 },
      { codigo: 'maquila', nombre: 'Maquila', subtotal: 10 },
    ],
    costoTotal: 40,
  },
  isPending: false,
  isError: false,
  error: null,
};

vi.mock('@/api/listas-precios', () => ({
  useDesgloseCostoLinea: () => DESGLOSE,
}));

vi.mock('@/api/negociacion', () => ({
  useSimularMesa: (
    _idLinea: number | null,
    cuerpo: MesaCuerpo,
    opciones?: { habilitado?: boolean },
  ) => {
    if (opciones?.habilitado === false || cuerpo.renglones.length === 0) {
      return { data: undefined, isFetching: false, isError: false, error: null };
    }
    cuerposVistos.push(cuerpo);
    const base = servidorFalso(cuerpo);
    const data: SimulacionMesa = conPermisoDeMargen
      ? base
      : {
          ...base,
          precioSugerido: null,
          precioNeto: null,
          margenBrutoPct: null,
          margenObjetivoPct: null,
          cumpleObjetivo: null,
        };
    return { data, isFetching: false, isError: false, error: null };
  },
}));

const CON_MARGEN = estadoSesionDePrueba(['listas.ver', 'listas.negociar', 'listas.aprobar']);
const SIN_MARGEN = estadoSesionDePrueba(['listas.ver', 'listas.negociar']);

beforeEach(() => {
  cuerposVistos.length = 0;
  conPermisoDeMargen = true;
});

describe('MesaNegociacion — el renglón en vivo', () => {
  it('los campos NACEN cargados con los costos de la receta (§Post-F9.138 punto 4)', async () => {
    renderConProveedores(<MesaNegociacion idLinea={7} precioInicial={100} />, {
      sesion: CON_MARGEN,
    });

    expect(await screen.findByLabelText('Tela')).toHaveValue(30);
    expect(screen.getByLabelText('Maquila')).toHaveValue(10);
    // …y el precio parte del que hoy vale ese modelo, no de cero.
    expect(screen.getByTestId('celda-precio')).toHaveValue(100);
    await waitFor(() => {
      expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('40');
    });
  });

  /**
   * 🔴 **LA PRUEBA CENTRAL.** Textual de Daniel (§Post-F9.144(b)): *"me quitan un cierre y yo le pongo
   * que estimos que la maquila costara 5 pesos menos"*. Se teclea ese 5 en la celda de maquila y se
   * exige que **el margen de la pantalla suba** y que **el precio sugerido baje**. Si el renglón sólo
   * fuera decorativo —o si el cuerpo no se re-mandara al mover un costo— esto muere.
   */
  it('🔴 al MOVER UN COSTO, el margen cambia EN PANTALLA (y el precio sugerido también)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MesaNegociacion idLinea={7} precioInicial={100} />, {
      sesion: CON_MARGEN,
    });

    await waitFor(() => {
      expect(screen.getByTestId('mesa-margen')).toHaveTextContent('50.0%');
    });
    expect(screen.getByTestId('mesa-precio-sugerido')).toHaveTextContent('100');

    // "la maquila costará 5 pesos menos": 10 → 5.
    const maquila = screen.getByLabelText('Maquila');
    await usuario.clear(maquila);
    await usuario.type(maquila, '5');

    await waitFor(() => {
      // (80 − 35) / 80 = 56.3 %
      expect(screen.getByTestId('mesa-margen')).toHaveTextContent('56.3%');
    });
    expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('35');
    expect(screen.getByTestId('mesa-delta')).toHaveTextContent('-$5.00');
    // Dirección 2 completa: el precio que ese costo pediría BAJA (35/0.5/0.8 = 87.5 → 88 al alza).
    expect(screen.getByTestId('mesa-precio-sugerido')).toHaveTextContent('88');
  });

  /** La otra dirección: se escribe el PRECIO y sale el MARGEN, sin tocar ningún costo. */
  it('al ESCRIBIR EL PRECIO, el margen cambia en pantalla', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MesaNegociacion idLinea={7} precioInicial={100} />, {
      sesion: CON_MARGEN,
    });
    await waitFor(() => {
      expect(screen.getByTestId('mesa-margen')).toHaveTextContent('50.0%');
    });

    // "bájame 3 pesos": 100 → 97.
    const precio = screen.getByTestId('celda-precio');
    await usuario.clear(precio);
    await usuario.type(precio, '97');

    await waitFor(() => {
      // (77.6 − 40) / 77.6 = 48.5 % → ya NO cumple el objetivo de 50 %.
      expect(screen.getByTestId('mesa-margen')).toHaveTextContent('48.5%');
    });
    expect(screen.getByTestId('mesa-badge')).toHaveAttribute('data-cumple', 'false');
  });

  /**
   * ⭐ La ÚNICA excepción que Daniel concedió (§Post-F9.138 punto 3): los avíos se quitan/ponen/mueven
   * en un panel aparte — que se abre ENCIMA, sin sacar de la pantalla — y lo que se mueve ahí entra al
   * costo de la mesa al instante. 🔴 Y es un ESTIMADO: no da de alta ningún avío (§Post-F9.139).
   */
  it('el panel de AVÍOS agrega un estimado libre y el costo de la mesa lo recoge', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MesaNegociacion idLinea={7} precioInicial={100} />, {
      sesion: CON_MARGEN,
    });
    await screen.findByLabelText('Tela');

    await usuario.click(screen.getByTestId('abrir-avios-mesa'));
    const panel = screen.getByTestId('panel-avios-mesa');
    expect(within(panel).getByTestId('avios-vacio')).toBeInTheDocument();
    await usuario.click(within(panel).getByTestId('agregar-avio-mesa'));

    const etiqueta = within(screen.getByTestId('panel-avios-mesa')).getByLabelText('Qué avío es');
    await usuario.clear(etiqueta);
    await usuario.type(etiqueta, 'Jareta más barata');
    await usuario.type(
      within(screen.getByTestId('panel-avios-mesa')).getByLabelText('Costo estimado'),
      '3',
    );

    // Se espera al MARGEN, que sólo puede venir del servidor: el costo de la mesa se pinta también
    // desde la suma local, así que aseverarlo no probaría que el estimado viajó.
    await waitFor(() => {
      expect(screen.getByTestId('mesa-margen')).toHaveTextContent('46.3%'); // (80 − 43) / 80
    });
    expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('43');
    // Viaja como número LIBRE con su etiqueta: sin id de catálogo, sin dar de alta nada.
    const ultimo = cuerposVistos.at(-1);
    expect(ultimo?.renglones).toContainEqual({ etiqueta: 'Jareta más barata', importe: 3 });
  });

  /**
   * 🔴 §Post-F9.125(b), ratificado el 29-ago-2026 (*«Nadie mas que yo ve los factores por favor….»*):
   * sin `listas.aprobar` el veredicto NO se pinta —ni el margen ni el precio sugerido, que dividido
   * entre el costo delataría el multiplicador de los factores— y se dice a quién le toca. El renglón
   * de costos se sigue jugando: eso es trabajo de quien negocia.
   */
  it('🔴 sin `listas.aprobar` no se pinta margen ni precio sugerido, y se dice por qué', async () => {
    conPermisoDeMargen = false;
    renderConProveedores(<MesaNegociacion idLinea={7} precioInicial={100} />, {
      sesion: SIN_MARGEN,
    });

    expect(await screen.findByLabelText('Tela')).toHaveValue(30);
    expect(screen.queryByTestId('mesa-margen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mesa-precio-sugerido')).not.toBeInTheDocument();
    expect(screen.getByText(/facultad del/i)).toBeInTheDocument();
  });

  it('«Restablecer» devuelve el renglón a los costos de la receta', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<MesaNegociacion idLinea={7} precioInicial={100} />, {
      sesion: CON_MARGEN,
    });
    const maquila = await screen.findByLabelText('Maquila');
    await usuario.clear(maquila);
    await usuario.type(maquila, '5');
    await waitFor(() => {
      expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('35');
    });

    await usuario.click(screen.getByTestId('restablecer-mesa'));
    expect(screen.getByLabelText('Maquila')).toHaveValue(10);
    await waitFor(() => {
      expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('40');
    });
  });
});
