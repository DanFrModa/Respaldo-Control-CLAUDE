import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesgloseCostoLinea } from '@/api/listas-precios';
import type { GuardarMesaCuerpo, MesaCuerpo, SimulacionMesa } from '@/api/negociacion';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { MesaNegociacion } from './MesaNegociacion';

/**
 * ⭐⭐ EL NEGOCIADOR EN VIVO (§Post-F9.138 + V1-E8w) — pruebas de PANTALLA.
 *
 * 🔴 Lo que Daniel pidió **VER** se prueba que **SE VE**: no basta con que el endpoint conteste. La
 * prueba central mueve un costo con el teclado y exige que **el margen cambie en la pantalla**, que
 * es literalmente el requisito (*"ir viendo como se va moviendo el margen si modifico cada
 * elemento"*). Lo mismo con la foto, el target, el desglose de avíos y el guardado: **a nivel de
 * render**, porque probar el helper no demuestra que la tarjeta lo use.
 *
 * El "servidor" de estas pruebas calcula con la MISMA cascada del dominio (margen 50 / descuentos 10
 * / regalías 5 / costo de ventas 5 ⇒ los factores del cliente de ejemplo) y hace el MISMO producto
 * `consumo × precio`, así que los números que se aseveran son los de verdad; la aritmética en sí la
 * prueban `precio-lista.test.ts` y la integración.
 */

const cuerposVistos: MesaCuerpo[] = [];
const guardados: GuardarMesaCuerpo[] = [];

/** Importe de un renglón, igual que `resolverRenglonesMesa` del dominio. */
function importeDe(r: MesaCuerpo['renglones'][number]): number {
  return Math.round((r.consumo === null ? r.precioUnit : r.consumo * r.precioUnit) * 100) / 100;
}

/** La cascada D2, igual que `calcularPrecioLista`/`simularMargenNegociacion` (factores 50/10/5/5). */
function servidorFalso(cuerpo: MesaCuerpo): SimulacionMesa {
  const renglones = cuerpo.renglones.map((r) => ({ etiqueta: r.etiqueta, importe: importeDe(r) }));
  const costoSimulado = Math.round(renglones.reduce((s, r) => s + r.importe, 0) * 100) / 100;
  const porConcepto = new Map<string, { codigo: string; nombre: string; subtotal: number }>();
  cuerpo.renglones.forEach((r, i) => {
    const acc = porConcepto.get(r.conceptoCodigo) ?? {
      codigo: r.conceptoCodigo,
      nombre: r.conceptoNombre,
      subtotal: 0,
    };
    acc.subtotal += renglones[i]?.importe ?? 0;
    porConcepto.set(r.conceptoCodigo, acc);
  });
  const precioNeto = cuerpo.precioObjetivo * 0.8;
  const margenBrutoPct = precioNeto > 0 ? ((precioNeto - costoSimulado) / precioNeto) * 100 : 0;
  return {
    costoVigente: 42.2,
    costoSimulado,
    deltaCosto: Math.round((costoSimulado - 42.2) * 100) / 100,
    precioObjetivo: cuerpo.precioObjetivo,
    precioSugerido: Math.ceil(costoSimulado / 0.5 / 0.8),
    precioNeto,
    margenBrutoPct,
    margenObjetivoPct: 50,
    cumpleObjetivo: margenBrutoPct >= 50,
    renglones,
    grupos: [...porConcepto.values()].map((g) => ({
      ...g,
      subtotal: Math.round(g.subtotal * 100) / 100,
    })),
    precioTarget: targetDelCliente,
    cumpleTarget: targetDelCliente === null ? null : cuerpo.precioObjetivo >= targetDelCliente,
  };
}

/** Sin `listas.aprobar` el servidor devuelve los CINCO derivados en null (§Post-F9.125(b)). */
let conPermisoDeMargen = true;
/** Simula "el servidor todavía no contesta" (primer pintado: rebote + ida y vuelta). */
let servidorMudo = false;
/** El target que el cliente dio para este renglón (§Post-F9.150); null = no dio ninguno. */
let targetDelCliente: number | null = null;
/** La foto principal del modelo, si la tiene (V1-E8w). */
let urlFoto: string | null = null;

// ⚠️ El resultado del desglose se declara UNA vez y se devuelve SIEMPRE el mismo objeto, porque eso
// es lo que hace TanStack Query de verdad (`data` es estable entre renders mientras no cambie). Un
// mock que fabrica un objeto nuevo en cada render no es "más estricto": es OTRO componente el que se
// prueba, con un `useEffect` disparándose sin parar.
//
// ⭐ V1-E8w: el desglose ya NO trae sólo subtotales — trae los RENGLONES, con consumo y precio
// separados. La tela lleva consumo (1.5 × 20 = 30) y DOS avíos, para poder abrirlos desglosados.
const GRUPOS: DesgloseCostoLinea['grupos'] = [
  {
    codigo: 'tela',
    nombre: 'Tela',
    subtotal: 30,
    lineas: [{ id: 1, descripcion: 'Felpa algodón', consumo: 1.5, precioUnit: 20, importe: 30 }],
  },
  {
    codigo: 'avios',
    nombre: 'Avíos',
    subtotal: 2.8,
    lineas: [
      { id: 2, descripcion: 'Cierre #5', consumo: null, precioUnit: 1.8, importe: 1.8 },
      { id: 3, descripcion: 'Etiqueta talla', consumo: null, precioUnit: 1, importe: 1 },
    ],
  },
  {
    codigo: 'maquila',
    nombre: 'Maquila',
    subtotal: 10,
    lineas: [{ id: 4, descripcion: 'Maquila', consumo: null, precioUnit: 10, importe: 10 }],
  },
  {
    codigo: 'empaque',
    nombre: 'Empaque',
    subtotal: 2.2,
    lineas: [{ id: 5, descripcion: 'Empaque', consumo: null, precioUnit: 2.2, importe: 2.2 }],
  },
];

function desgloseFalso(): { data: DesgloseCostoLinea } {
  return {
    data: {
      idPrecosto: 11,
      versionPrecosto: 1,
      grupos: GRUPOS,
      costoTotal: 45,
      codigoModelo: 'MOD-A',
      urlFotoModelo: urlFoto,
    },
  };
}
let DESGLOSE = { ...desgloseFalso(), isPending: false, isError: false, error: null };

vi.mock('@/api/listas-precios', () => ({
  useDesgloseCostoLinea: () => DESGLOSE,
}));

vi.mock('@/api/negociacion', () => ({
  useSimularMesa: (
    _idLinea: number | null,
    cuerpo: MesaCuerpo,
    opciones?: { habilitado?: boolean },
  ) => {
    if (opciones?.habilitado === false || cuerpo.renglones.length === 0 || servidorMudo) {
      return { data: undefined, isFetching: servidorMudo, isError: false, error: null };
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
  useGuardarMesa: () => ({
    isPending: false,
    mutate: (
      args: { idLinea: number; cuerpo: GuardarMesaCuerpo },
      opciones?: { onSuccess?: () => void },
    ) => {
      guardados.push(args.cuerpo);
      opciones?.onSuccess?.();
    },
  }),
}));

const CON_MARGEN = estadoSesionDePrueba(['listas.ver', 'listas.negociar', 'listas.aprobar']);
const SIN_MARGEN = estadoSesionDePrueba(['listas.ver', 'listas.negociar']);

/** Renderiza la mesa con los props que le pasa `DialogoNegociacionRenglon`. */
function renderMesa(sesion: ReturnType<typeof estadoSesionDePrueba>): void {
  renderConProveedores(<MesaNegociacion idLinea={7} precioInicial={106} codigoModelo="MOD-A" />, {
    sesion,
  });
}

beforeEach(() => {
  cuerposVistos.length = 0;
  guardados.length = 0;
  conPermisoDeMargen = true;
  servidorMudo = false;
  targetDelCliente = null;
  urlFoto = null;
  DESGLOSE = { ...desgloseFalso(), isPending: false, isError: false, error: null };
});

describe('MesaNegociacion — el renglón en vivo', () => {
  it('los campos NACEN cargados con los costos de la receta (§Post-F9.138 punto 4)', async () => {
    renderMesa(CON_MARGEN);

    // ⭐ V1-E8w: ya no hay un campo por CONCEPTO con su subtotal — hay uno por RENGLÓN.
    expect(await screen.findByLabelText('Precio de Felpa algodón')).toHaveValue(20);
    expect(screen.getByLabelText('Consumo de Felpa algodón')).toHaveValue(1.5);
    expect(screen.getByLabelText('Maquila')).toHaveValue(10);
    expect(screen.getByLabelText('Empaque')).toHaveValue(2.2);
    // …y el precio parte del que hoy vale ese modelo, no de cero.
    expect(screen.getByTestId('celda-precio')).toHaveValue(106);
    await waitFor(() => {
      expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('45');
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
    renderMesa(CON_MARGEN);

    await waitFor(() => {
      // (84.8 − 45) / 84.8 = 46.9 %
      expect(screen.getByTestId('mesa-margen')).toHaveTextContent('46.9%');
    });

    // "la maquila costará 5 pesos menos": 10 → 5.
    const maquila = screen.getByLabelText('Maquila');
    await usuario.clear(maquila);
    await usuario.type(maquila, '5');

    await waitFor(() => {
      // (84.8 − 40) / 84.8 = 52.8 %
      expect(screen.getByTestId('mesa-margen')).toHaveTextContent('52.8%');
    });
    expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('40');
    expect(screen.getByTestId('mesa-delta')).toHaveTextContent('-$2.20');
    // Dirección 2 completa: el precio que ese costo pediría BAJA (40/0.5/0.8 = 100).
    expect(screen.getByTestId('mesa-precio-sugerido')).toHaveTextContent('100');
  });

  /**
   * ⭐⭐ **LAS DOS PERILLAS DE LA TELA, POR SEPARADO** (§Post-F9.153, la petición literal): *«es
   * importante poner precio de la tela, y consumo…. por que muchas veces voy estimando el nuevo peso
   * en lugar del costo de multiplicar el consumo por el precio de la tela. O a veces decido meter una
   * tela mas barata, pero el consumo es el mismo.»* Se prueba EN PANTALLA que mover una no toca la
   * otra, y que el importe que se pinta es **el que resolvió el servidor** (aquí no se multiplica).
   */
  it('⭐ tela: el CONSUMO y el PRECIO se mueven por separado, y el importe lo trae el servidor', async () => {
    const usuario = userEvent.setup();
    renderMesa(CON_MARGEN);
    const consumo = await screen.findByLabelText('Consumo de Felpa algodón');
    const precio = screen.getByLabelText('Precio de Felpa algodón');
    await waitFor(() => {
      expect(screen.getByTestId('celda-importe-linea:1')).toHaveTextContent('$30.00');
    });

    // (a) "estimo el nuevo peso": baja el consumo, el precio de la tela NO se toca.
    await usuario.clear(consumo);
    await usuario.type(consumo, '1.2');
    await waitFor(() => {
      expect(screen.getByTestId('celda-importe-linea:1')).toHaveTextContent('$24.00');
    });
    expect(precio).toHaveValue(20); // ← intacto
    expect(cuerposVistos.at(-1)?.renglones[0]).toMatchObject({ consumo: 1.2, precioUnit: 20 });

    // (b) "meto una tela mas barata, pero el consumo es el mismo": mismo importe, otro camino.
    //
    // ⚠️ Aquí se espera al CUERPO, no al importe pintado: 1.2 × 20 y 1.5 × 16 dan **los dos** $24.00,
    // así que un `waitFor` sobre la celda lo satisfaría el valor viejo de (a) sin que nada hubiera
    // viajado — y la prueba pasaría con la perilla del precio muerta. Es la misma trampa del rebote
    // que ya costó una ronda: si las dos ramas cuadran en el número, hay que mirar lo que se mandó.
    await usuario.clear(consumo);
    await usuario.type(consumo, '1.5');
    await usuario.clear(precio);
    await usuario.type(precio, '16');
    await waitFor(() => {
      expect(cuerposVistos.at(-1)?.renglones[0]).toMatchObject({ consumo: 1.5, precioUnit: 16 });
    });
    expect(consumo).toHaveValue(1.5); // ← intacto
    expect(screen.getByTestId('celda-importe-linea:1')).toHaveTextContent('$24.00');
  });

  /** La otra dirección: se escribe el PRECIO y sale el MARGEN, sin tocar ningún costo. */
  it('al ESCRIBIR EL PRECIO, el margen cambia en pantalla', async () => {
    const usuario = userEvent.setup();
    renderMesa(CON_MARGEN);
    await waitFor(() => {
      expect(screen.getByTestId('mesa-margen')).toHaveTextContent('46.9%');
    });

    // "bájame 3 pesos": 106 → 103.
    const precio = screen.getByTestId('celda-precio');
    await usuario.clear(precio);
    await usuario.type(precio, '103');

    await waitFor(() => {
      // (82.4 − 45) / 82.4 = 45.4 %
      expect(screen.getByTestId('mesa-margen')).toHaveTextContent('45.4%');
    });
    expect(screen.getByTestId('mesa-badge')).toHaveAttribute('data-cumple', 'false');
  });

  /**
   * ⭐⭐ **LOS AVÍOS, DESGLOSADOS** (V1-E8w): *«me gustaria poder abrir el desglose de los costos de
   * los avios y poder mover los costos ahi. Desglosados… no solo el total, por que no se bien de que
   * elementos se compone.»* El panel tiene que traer **los avíos DE LA RECETA**, uno por uno — no
   * sólo los estimados que se agregan en la mesa, que era todo lo que había hasta la 0.059.
   */
  it('⭐ el panel de AVÍOS trae los de la RECETA desglosados, y moverlos mueve el costo', async () => {
    const usuario = userEvent.setup();
    renderMesa(CON_MARGEN);
    await screen.findByLabelText('Maquila');

    // El botón ya dice cuántos avíos hay en la mesa (los DOS de la receta), no cuántos estimados.
    expect(screen.getByTestId('abrir-avios-mesa')).toHaveTextContent('Avíos (2)');
    await usuario.click(screen.getByTestId('abrir-avios-mesa'));
    const panel = screen.getByTestId('panel-avios-mesa');
    expect(within(panel).getAllByTestId('fila-avio-mesa')).toHaveLength(2);
    expect(within(panel).getByDisplayValue('Cierre #5')).toBeInTheDocument();
    expect(within(panel).getByDisplayValue('Etiqueta talla')).toBeInTheDocument();

    // "me quitan un cierre": se mueve AHÍ y el costo de la mesa baja.
    const cierre = within(panel).getByLabelText('Costo estimado de Cierre #5');
    await usuario.clear(cierre);
    await usuario.type(cierre, '0.5');
    await waitFor(() => {
      expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('43.7');
    });
  });

  /**
   * ⭐ La excepción que Daniel concedió (§Post-F9.138 punto 3): los avíos se quitan/ponen/mueven en un
   * panel aparte — que se abre ENCIMA, sin sacar de la pantalla — y lo que se mueve ahí entra al costo
   * de la mesa al instante. 🔴 Y es un ESTIMADO: no da de alta ningún avío (§Post-F9.139).
   */
  it('el panel de AVÍOS agrega un estimado libre y el costo de la mesa lo recoge', async () => {
    const usuario = userEvent.setup();
    renderMesa(CON_MARGEN);
    await screen.findByLabelText('Maquila');

    await usuario.click(screen.getByTestId('abrir-avios-mesa'));
    await usuario.click(
      within(screen.getByTestId('panel-avios-mesa')).getByTestId('agregar-avio-mesa'),
    );

    const panel = () => screen.getByTestId('panel-avios-mesa');
    const etiqueta = within(panel()).getByLabelText('Qué avío es (Avío estimado)');
    await usuario.clear(etiqueta);
    await usuario.type(etiqueta, 'Jareta más barata');
    await usuario.type(within(panel()).getByLabelText('Costo estimado de Jareta más barata'), '3');

    await waitFor(() => {
      expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('48');
    });
    // Viaja como número LIBRE con su etiqueta: sin id de catálogo, sin dar de alta nada.
    expect(cuerposVistos.at(-1)?.renglones).toContainEqual({
      conceptoCodigo: 'avios',
      conceptoNombre: 'Avíos',
      etiqueta: 'Jareta más barata',
      consumo: null,
      precioUnit: 3,
    });
  });

  /**
   * ⭐ V1-E8w — **LA FOTO DEL MODELO, A LA VISTA.** *«Me gustaria ir viendo la foto del modelo. La
   * principal.»* Se prueba a nivel de RENDER: que la URL que manda el servidor termine en un `<img>`,
   * y que un modelo SIN fotos diga que no tiene en vez de dejar un hueco o una imagen rota.
   */
  it('⭐ pinta la FOTO principal del modelo; sin fotos lo dice', async () => {
    renderMesa(CON_MARGEN);
    await screen.findByLabelText('Maquila');
    expect(screen.getByTestId('mesa-sin-foto')).toBeInTheDocument();
    expect(screen.queryByTestId('mesa-foto-modelo')).not.toBeInTheDocument();

    urlFoto = 'https://r2.ejemplo/modelos/7/frente.jpg';
    DESGLOSE = { ...desgloseFalso(), isPending: false, isError: false, error: null };
    renderMesa(CON_MARGEN);
    const fotos = await screen.findAllByTestId('mesa-foto-modelo');
    expect(fotos[0]).toHaveAttribute('src', 'https://r2.ejemplo/modelos/7/frente.jpg');
    expect(fotos[0]).toHaveAttribute('alt', 'Foto principal de MOD-A');
  });

  /**
   * ⭐ §Post-F9.150 — **EL TARGET DEL CLIENTE, EN LA MESA.** *«y me debe de aparecer en la
   * negociacion»*. INFORMA, NO BLOQUEA: por debajo del target dice «no llega» y **no deshabilita ni
   * esconde nada** — el margen, el precio sugerido y los costos siguen ahí, exactamente igual.
   */
  it('⭐ el TARGET del cliente aparece con su veredicto, e informa sin bloquear', async () => {
    const usuario = userEvent.setup();
    targetDelCliente = 100;
    renderMesa(CON_MARGEN);
    await screen.findByLabelText('Maquila');

    await waitFor(() => {
      expect(screen.getByTestId('mesa-target')).toHaveTextContent('$100.00');
    });
    expect(screen.getByTestId('mesa-badge-target')).toHaveAttribute('data-cumple-target', 'true');

    // Se baja el precio por DEBAJO del target: avisa, y todo lo demás sigue funcionando.
    const precio = screen.getByTestId('celda-precio');
    await usuario.clear(precio);
    await usuario.type(precio, '95');
    await waitFor(() => {
      expect(screen.getByTestId('mesa-badge-target')).toHaveAttribute(
        'data-cumple-target',
        'false',
      );
    });
    expect(screen.getByTestId('mesa-margen')).not.toHaveTextContent('—');
    expect(screen.getByTestId('celda-precio')).toBeEnabled();
    expect(screen.getByTestId('abrir-guardar-mesa')).toBeEnabled();
  });

  it('sin target del cliente NO se inventa ningún veredicto', async () => {
    renderMesa(CON_MARGEN);
    await screen.findByLabelText('Maquila');
    await waitFor(() => {
      expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('45');
    });
    expect(screen.queryByTestId('mesa-target')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mesa-badge-target')).not.toBeInTheDocument();
  });

  /**
   * ⭐⭐ **EL GUARDADO** (§Post-F9.149): *«Voy jugando y al terminar la negociación guardo la última
   * información que metí.»* Se prueba EN PANTALLA que (a) **no se guarda solo** —teclear no dispara
   * nada— y (b) el botón manda **el último estado completo**, con su desglose y su comentario.
   */
  it('🔴 NO guarda solo: sólo el botón manda el ÚLTIMO estado, con desglose y comentario', async () => {
    const usuario = userEvent.setup();
    renderMesa(CON_MARGEN);
    const maquila = await screen.findByLabelText('Maquila');

    // Se juega con los números… y no se guarda NADA por el camino.
    await usuario.clear(maquila);
    await usuario.type(maquila, '5');
    await waitFor(() => {
      expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('40');
    });
    expect(guardados).toHaveLength(0);

    // Al terminar: el botón, con su comentario obligatorio.
    await usuario.click(screen.getByTestId('abrir-guardar-mesa'));
    await usuario.type(
      screen.getByTestId('guardar-mesa-acuerdo'),
      'Le quitamos el cierre; la maquila baja 5',
    );
    await usuario.click(screen.getByTestId('confirmar-guardar-mesa'));

    expect(guardados).toHaveLength(1);
    const guardado = guardados.at(0);
    expect(guardado?.acuerdo).toBe('Le quitamos el cierre; la maquila baja 5');
    expect(guardado?.precioObjetivo).toBe(106);
    // El DESGLOSE completo, con el último estado (la maquila en 5) y sus conceptos.
    expect(guardado?.renglones).toHaveLength(5);
    expect(guardado?.renglones).toContainEqual({
      conceptoCodigo: 'maquila',
      conceptoNombre: 'Maquila',
      etiqueta: 'Maquila',
      consumo: null,
      precioUnit: 5,
    });
    expect(guardado?.renglones).toContainEqual({
      conceptoCodigo: 'tela',
      conceptoNombre: 'Tela',
      etiqueta: 'Felpa algodón',
      consumo: 1.5,
      precioUnit: 20,
    });
  });

  it('🔴 el guardado exige el comentario: sin él no se manda nada', async () => {
    const usuario = userEvent.setup();
    renderMesa(CON_MARGEN);
    await screen.findByLabelText('Maquila');

    await usuario.click(screen.getByTestId('abrir-guardar-mesa'));
    await usuario.click(screen.getByTestId('confirmar-guardar-mesa'));
    expect(guardados).toHaveLength(0);
  });

  /**
   * 🔴 §Post-F9.125(b), ratificado el 29-ago-2026 (*«Nadie mas que yo ve los factores por favor….»*):
   * sin `listas.aprobar` el veredicto NO se pinta —ni el margen ni el precio sugerido, que dividido
   * entre el costo delataría el multiplicador de los factores— y se dice a quién le toca. El renglón
   * de costos se sigue jugando, y **el costo de la mesa se sigue viendo**: eso es trabajo de quien
   * negocia, y ahora lo trae el servidor (la pantalla ya no suma nada por su cuenta).
   */
  it('🔴 sin `listas.aprobar` no se pinta margen ni precio sugerido, y se dice por qué', async () => {
    conPermisoDeMargen = false;
    renderMesa(SIN_MARGEN);

    expect(await screen.findByLabelText('Maquila')).toHaveValue(10);
    expect(screen.queryByTestId('mesa-margen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mesa-precio-sugerido')).not.toBeInTheDocument();
    expect(screen.getByText(/facultad del/i)).toBeInTheDocument();
    // El costo SÍ, y viene del servidor.
    await waitFor(() => {
      expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('45');
    });
  });

  /**
   * 🔴 **H3 — un importe que se deja de contar EN SILENCIO.** Reproducido por el reviewer: agregas un
   * avío estimado, tecleas 7, y **borras la etiqueta para reescribirla** ⇒ el 7 seguía visible en su
   * celda y el costo bajaba **sin un solo aviso**. El arreglo no es quitar el filtro: es la etiqueta
   * de respaldo. El nombre sirve para acordarse; **el importe es el dato, y el importe siempre cuenta.**
   */
  it('🔴 un estimado SIN etiqueta sigue contando (no desaparece del costo en silencio)', async () => {
    const usuario = userEvent.setup();
    renderMesa(CON_MARGEN);
    await screen.findByLabelText('Maquila');

    await usuario.click(screen.getByTestId('abrir-avios-mesa'));
    await usuario.click(
      within(screen.getByTestId('panel-avios-mesa')).getByTestId('agregar-avio-mesa'),
    );
    const panel = () => screen.getByTestId('panel-avios-mesa');
    await usuario.type(within(panel()).getByLabelText('Costo estimado de Avío estimado'), '7');
    await waitFor(() => {
      expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('52');
    });

    // El usuario borra el nombre para reescribirlo. El importe NO se puede ir del total.
    await usuario.clear(within(panel()).getByLabelText('Qué avío es (Avío estimado)'));

    await waitFor(() => {
      expect(cuerposVistos.at(-1)?.renglones).toContainEqual({
        conceptoCodigo: 'avios',
        conceptoNombre: 'Avíos',
        etiqueta: 'Estimado sin nombre',
        consumo: null,
        precioUnit: 7,
      });
    });
    expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('52');
  });

  /**
   * 🔴 **H4 — «Debajo» en rojo sin tener dato.** Con la consulta en `undefined` (primer pintado: 300 ms
   * de rebote + ida y vuelta) el margen decía «—» —honesto— pero el badge decía **«Debajo»** y el número
   * iba en rojo: `?? false` colapsaba *«no sé»* con *«no cumple»* **en el mismo pixel**, en el widget
   * sobre el que se decide un precio con el cliente enfrente. Sin dato **no se emite veredicto**.
   */
  it('🔴 mientras el servidor no contesta NO dice «Debajo» ni pinta el margen en rojo', async () => {
    servidorMudo = true;
    renderMesa(CON_MARGEN);
    await screen.findByLabelText('Maquila');

    expect(screen.queryByTestId('mesa-badge')).not.toBeInTheDocument();
    expect(screen.queryByText('Debajo')).not.toBeInTheDocument();
    const margen = screen.getByTestId('mesa-margen');
    expect(margen).toHaveTextContent('—');
    expect(margen.className).not.toMatch(/destructive/);
  });

  it('«Restablecer» devuelve el renglón a los costos de la receta', async () => {
    const usuario = userEvent.setup();
    renderMesa(CON_MARGEN);
    const maquila = await screen.findByLabelText('Maquila');
    await usuario.clear(maquila);
    await usuario.type(maquila, '5');
    await waitFor(() => {
      expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('40');
    });

    await usuario.click(screen.getByTestId('restablecer-mesa'));
    expect(screen.getByLabelText('Maquila')).toHaveValue(10);
    await waitFor(() => {
      expect(screen.getByTestId('mesa-costo-simulado')).toHaveTextContent('45');
    });
  });

  /**
   * ⭐ V1-E8w — **LOS SUBTOTALES POR CONCEPTO LOS SUMA EL SERVIDOR** y se pintan. Es lo que deja ver
   * "cuánto son los avíos en total" sin que la pantalla agrupe ni sume nada (A1 / lección F5-E7).
   */
  it('⭐ pinta el subtotal por concepto que mandó el servidor', async () => {
    renderMesa(CON_MARGEN);
    await screen.findByLabelText('Maquila');
    await waitFor(() => {
      expect(screen.getByTestId('mesa-subtotal-avios')).toHaveTextContent('$2.80');
    });
    expect(screen.getByTestId('mesa-subtotal-tela')).toHaveTextContent('$30.00');
    expect(screen.getByTestId('mesa-subtotal-empaque')).toHaveTextContent('$2.20');
  });
});
