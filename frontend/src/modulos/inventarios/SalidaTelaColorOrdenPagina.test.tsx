import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import type { RenglonTelaColor } from './CapturaRenglonesTelaColor';
import { SalidaTelaColorOrdenPagina } from './SalidaTelaColorOrdenPagina';

const mutate = vi.fn();

/**
 * La PREVIA (fila 0.101) la decide el SERVIDOR: aquí se simula su respuesta para comprobar que la
 * pantalla pinta EXACTAMENTE su veredicto —y que no inventa ninguno—. `previaArgs` captura con qué
 * se le pregunta, que es la otra mitad: un aviso correcto sobre la captura equivocada no sirve.
 */
type RespuestaPrevia = {
  idOrden: number;
  folioOrden: number;
  idAlmacen: number;
  tieneExplosion: boolean;
  telas: {
    idTela: number;
    tela: string;
    unidad: string | null;
    requerido: number | null;
    yaSalido: number;
    aSacar: number;
    excedente: number;
    sobreSalida: boolean;
    colores: string[];
  }[];
  colores: {
    idTelaColor: number;
    telaColor: string;
    idTela: number;
    tela: string;
    estadoTono: 'sin-riesgo' | 'varias-partidas' | 'origen-desconocido';
    existencia: number;
    entradoConocido: number;
    sinNombrar: number;
    partidas: {
      id: number;
      folio: number;
      loteProveedor: string | null;
      factura: string | null;
      fecha: string | null;
      entrado: number;
    }[];
  }[];
  haySobreSalida: boolean;
  hayRiesgoTono: boolean;
};
const previaArgs = vi.fn();
let respuestaPrevia: RespuestaPrevia | undefined;

vi.mock('@/api/inventario-materiales', () => ({
  useSalidaTelaColorAOrden: () => ({ mutate, isPending: false }),
  usePreviaSalidaTelaColor: (cuerpo: unknown) => {
    previaArgs(cuerpo);
    return { data: cuerpo === undefined ? undefined : respuestaPrevia };
  },
}));

/** Atajo: la respuesta de la previa con los veredictos que cada prueba quiere probar. */
function previa(parcial: Partial<RespuestaPrevia>): RespuestaPrevia {
  const base: RespuestaPrevia = {
    idOrden: 9,
    folioOrden: 123,
    idAlmacen: 5,
    tieneExplosion: true,
    telas: [],
    colores: [],
    haySobreSalida: false,
    hayRiesgoTono: false,
  };
  return { ...base, ...parcial };
}

/** Una partida de la lista del aviso de tono. */
function partida(
  id: number,
  folio: number,
  lote: string | null,
  entrado = 100,
): RespuestaPrevia['colores'][number]['partidas'][number] {
  return { id, folio, loteProveedor: lote, factura: null, fecha: null, entrado };
}

/** El renglón (b) de un color: el ESTADO lo decide el SERVIDOR, así que aquí se dicta. */
function color(
  estadoTono: RespuestaPrevia['colores'][number]['estadoTono'],
  partidas: RespuestaPrevia['colores'][number]['partidas'],
  existencia = partidas.reduce((suma, p) => suma + p.entrado, 0),
  identidad: { idTelaColor: number; telaColor: string } = {
    idTelaColor: 11,
    telaColor: 'Marino',
  },
): RespuestaPrevia['colores'][number] {
  return {
    ...identidad,
    idTela: 1,
    tela: 'Felpa Suiza',
    estadoTono,
    existencia,
    entradoConocido: partidas.reduce((suma, p) => suma + p.entrado, 0),
    sinNombrar: Math.max(0, existencia - partidas.reduce((suma, p) => suma + p.entrado, 0)),
    partidas,
  };
}

const almacenesQuery = vi.fn();
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: (query: unknown) => {
    almacenesQuery(query);
    return {
      data: {
        datos: [
          { id: 5, nombre: 'Bodega A', idCortador: null, cortador: null },
          { id: 8, nombre: 'Taller Montaño', idCortador: 99, cortador: 'Montaño' },
        ],
      },
    };
  },
}));
// SelectorOrden emite una orden al hacer click.
vi.mock('@/modulos/produccion/SelectorOrden', () => ({
  SelectorOrden: ({
    alSeleccionar,
  }: {
    alSeleccionar: (o: {
      id: number;
      folio: number;
      codigoModelo: string;
      cliente: string;
    }) => void;
  }) => (
    <button
      type="button"
      data-testid="sel-orden"
      onClick={() =>
        alSeleccionar({ id: 9, folio: 123, codigoModelo: 'M-1', cliente: 'Cliente X' })
      }
    >
      elegir orden
    </button>
  ),
}));
// La captura por color se simula: un botón agrega un renglón felpa+cardigan.
vi.mock('./CapturaRenglonesTelaColor', () => ({
  CapturaRenglonesTelaColor: ({ onChange }: { onChange: (r: RenglonTelaColor[]) => void }) => (
    <button
      type="button"
      data-testid="captura-color-simulada"
      onClick={() =>
        onChange([
          {
            idTelaColor: 11,
            tela: 'Felpa Suiza',
            color: 'Marino',
            nombreComplemento: 'Cardigan',
            cantidad: 60,
            cantidadComplemento: 25,
          },
        ])
      }
    >
      agregar renglón
    </button>
  ),
}));
// La orden del deep-link (enlace "Descargar tela" del avance de producción) se carga por su id.
const useOrden = vi.fn<(id?: number) => unknown>();
vi.mock('@/api/ordenes', () => ({ useOrden: (id?: number) => useOrden(id) }));

describe('SalidaTelaColorOrdenPagina (A2 — salida por color)', () => {
  beforeEach(() => {
    mutate.mockReset();
    previaArgs.mockReset();
    respuestaPrevia = undefined;
    useOrden.mockReset();
    useOrden.mockReturnValue({ data: undefined, isError: false });
  });

  it('pide elegir una orden antes de capturar', () => {
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    expect(screen.getByText('Sin orden seleccionada.')).toBeInTheDocument();
  });

  /** Deja la pantalla con orden + almacén + un renglón capturado (la captura completa). */
  function capturar(): void {
    fireEvent.click(screen.getByTestId('sel-orden'));
    fireEvent.click(screen.getByTestId('captura-color-simulada'));
    fireEvent.change(screen.getByTestId('salida-color-almacen'), { target: { value: '5' } });
  }

  it('guarda la salida con ambas cantidades (y sin avisos no pinta ninguno)', () => {
    respuestaPrevia = previa({});
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    fireEvent.click(screen.getByTestId('sel-orden'));
    // Sin renglones: no hay avisos y no se puede guardar.
    expect(screen.queryByTestId('salida-color-aviso-tono')).not.toBeInTheDocument();
    expect(screen.queryByTestId('salida-color-aviso-sobre-salida')).not.toBeInTheDocument();
    expect(screen.getByTestId('salida-color-guardar')).toBeDisabled();

    fireEvent.click(screen.getByTestId('captura-color-simulada'));
    fireEvent.change(screen.getByTestId('salida-color-almacen'), { target: { value: '5' } });
    const guardar = screen.getByTestId('salida-color-guardar');
    expect(guardar).toBeEnabled();
    fireEvent.click(guardar);
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        idOrden: 9,
        idAlmacen: 5,
        lineas: [{ idTelaColor: 11, cantidad: 60, cantidadComplemento: 25 }],
      }),
      expect.anything(),
    );
  });

  // ⭐ La PREGUNTA que se le hace al servidor: un veredicto correcto sobre una captura equivocada
  // no sirve de nada. Y sin almacén no se pregunta: es lo que acota las partidas del tono.
  it('le pregunta al servidor por la CAPTURA EN CURSO (orden + almacén + renglones)', () => {
    respuestaPrevia = previa({});
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    fireEvent.click(screen.getByTestId('sel-orden'));
    fireEvent.click(screen.getByTestId('captura-color-simulada'));
    // Con renglones pero SIN almacén todavía no hay nada que preguntar.
    expect(previaArgs).toHaveBeenLastCalledWith(undefined);

    fireEvent.change(screen.getByTestId('salida-color-almacen'), { target: { value: '5' } });
    expect(previaArgs).toHaveBeenLastCalledWith({
      idOrden: 9,
      idAlmacen: 5,
      lineas: [{ idTelaColor: 11, cantidad: 60, cantidadComplemento: 25 }],
    });
  });

  // ═══ AVISO (b) — RIESGO DE TONO: tres estados, tres conductas ═══
  //
  // 🔴 Hasta la v0.100 este aviso salía SIEMPRE que hubiera un renglón, y por eso nadie lo leía.
  // Esta aserción EN NEGATIVO es la que vigila que no vuelva a pasar.
  it('con UNA sola partida que explica la existencia NO enseña el aviso de tono', () => {
    respuestaPrevia = previa({
      colores: [color('sin-riesgo', [partida(1, 501, 'L-A', 500)], 500)],
      hayRiesgoTono: false,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    expect(screen.queryByTestId('salida-color-aviso-tono')).not.toBeInTheDocument();
    expect(screen.queryByTestId('salida-color-tono-sin-partidas')).not.toBeInTheDocument();
    // Y la captura sigue viva: callarse no apaga nada.
    expect(screen.getByTestId('salida-color-guardar')).toBeEnabled();
  });

  it('con DOS partidas SÍ enseña el aviso de tono Y LAS LISTA', () => {
    respuestaPrevia = previa({
      colores: [
        color('varias-partidas', [partida(1, 501, 'L-A', 500), partida(2, 502, 'L-B', 300)]),
      ],
      hayRiesgoTono: true,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    const aviso = screen.getByTestId('salida-color-aviso-tono');
    expect(aviso).toHaveTextContent('Riesgo de tono');
    // La LISTA de partidas a la vista: es lo que Daniel pidió para poder escoger a conciencia.
    const lista = screen.getByTestId('salida-color-partidas-11');
    expect(lista).toHaveTextContent('Felpa Suiza · Marino');
    expect(lista).toHaveTextContent('#501 (lote L-A)');
    expect(lista).toHaveTextContent('#502 (lote L-B)');
    // 🔴 Y NO se pinta la línea neutra: éste es el estado que SÍ interrumpe.
    expect(screen.queryByTestId('salida-color-tono-sin-partidas')).not.toBeInTheDocument();
    // Y NO bloquea.
    expect(screen.getByTestId('salida-color-guardar')).toBeEnabled();
  });

  // ⭐⭐ EL TERCER ESTADO: tela que ninguna partida explica (llegó traspasada al almacén del
  // cortador). El aviso tiene que DECIR que no se sabe, no callar — callar sería presentar la
  // ignorancia como tranquilidad, justo enfrente de quien está escogiendo el rollo.
  // ⭐⭐ LA LISTA NO ES TODO LO QUE HAY, y la pantalla tiene que decirlo. Con dos lotes conocidos y
  // 200 más llegados por traspaso, enseñar sólo «#501 · #502» haría creer que ésos son el anaquel
  // entero — presentar como completo lo que no lo es.
  it('con varias partidas Y tela sin nombrar, la lista lo DICE (no se presenta como completa)', () => {
    respuestaPrevia = previa({
      colores: [
        color('varias-partidas', [partida(1, 501, 'L-A', 500), partida(2, 502, 'L-B', 300)], 1000),
      ],
      hayRiesgoTono: true,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    const lista = screen.getByTestId('salida-color-partidas-11');
    expect(lista).toHaveTextContent('#501 (lote L-A)');
    expect(lista).toHaveTextContent('y hay 200 más cuyo origen no se puede nombrar');
    // Sigue siendo la ALARMA (la lista es lo accionable), no la línea neutra.
    expect(screen.queryByTestId('salida-color-tono-sin-partidas')).not.toBeInTheDocument();
  });

  it('si las partidas explican todo, la lista NO lleva coletilla', () => {
    respuestaPrevia = previa({
      colores: [
        color('varias-partidas', [partida(1, 501, 'L-A', 500), partida(2, 502, 'L-B', 300)]),
      ],
      hayRiesgoTono: true,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    expect(screen.getByTestId('salida-color-partidas-11')).not.toHaveTextContent(
      'cuyo origen no se puede nombrar',
    );
  });

  // ⭐⭐ Y NO COMO ALARMA. En el almacén del cortador este estado sale en TODAS las capturas (la
  // partida no viaja en el traspaso), así que pintarlo en ámbar devolvería el «aviso que sale
  // siempre» que esta fila vino a matar — y quemaría la alarma de arriba.
  it('ORIGEN DESCONOCIDO se dice en LÍNEA NEUTRA, no en el bloque de alarma', () => {
    respuestaPrevia = previa({
      colores: [color('origen-desconocido', [], 800)],
      hayRiesgoTono: true,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    const neutra = screen.getByTestId('salida-color-tono-sin-partidas');
    expect(neutra).toHaveTextContent('no sabe de qué partidas');
    expect(neutra).toHaveTextContent('Verifícalo físicamente antes de cortar');
    expect(neutra).toHaveClass('text-muted-foreground');
    expect(screen.getByTestId('salida-color-sin-partidas-11')).toHaveTextContent(
      'hay 800 en este almacén y sólo se puede nombrar el origen de 0',
    );
    // 🔴 NO se enciende el ámbar, y no hay lista de partidas que enseñar.
    expect(screen.queryByTestId('salida-color-aviso-tono')).not.toBeInTheDocument();
    expect(screen.queryByTestId('salida-color-partidas-11')).not.toBeInTheDocument();
    expect(screen.getByTestId('salida-color-guardar')).toBeEnabled();
  });

  // La distinción que persigue la fila: «ojo, hay varios lotes, escoge» (interrumpe) frente a
  // «aquí no llevamos partidas, míralo tú» (acompaña). Si mañana alguien los unifica, esto truena.
  it('los DOS estados se pintan DISTINTO y conviven sin mezclarse', () => {
    respuestaPrevia = previa({
      colores: [
        color('varias-partidas', [partida(1, 501, 'L-A', 500), partida(2, 502, 'L-B', 300)]),
        color('origen-desconocido', [], 800, { idTelaColor: 21, telaColor: 'Blanco' }),
      ],
      hayRiesgoTono: true,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    const alarma = screen.getByTestId('salida-color-aviso-tono');
    const neutra = screen.getByTestId('salida-color-tono-sin-partidas');
    // Dos bloques separados, con PESOS distintos: uno grita (ámbar), el otro acompaña (apagado).
    expect(alarma).toHaveClass('bg-amber-500/10');
    expect(neutra).toHaveClass('text-muted-foreground');
    expect(neutra).not.toHaveClass('bg-amber-500/10');
    expect(alarma).not.toContainElement(neutra);
    // Cada color en el suyo, y ninguno en el otro.
    expect(alarma).toContainElement(screen.getByTestId('salida-color-partidas-11'));
    expect(neutra).toContainElement(screen.getByTestId('salida-color-sin-partidas-21'));
    expect(screen.queryByTestId('salida-color-partidas-21')).not.toBeInTheDocument();
  });

  // ═══ AVISO (a) — SOBRE-SALIDA: avisa y DEJA PASAR ═══
  it('sacar MÁS de lo que la orden pide avisa con los números, y deja guardar igual', () => {
    respuestaPrevia = previa({
      telas: [
        {
          idTela: 1,
          tela: 'Felpa Suiza',
          unidad: 'KG',
          requerido: 1000,
          yaSalido: 0,
          aSacar: 1200,
          excedente: 200,
          sobreSalida: true,
          colores: ['Marino'],
        },
      ],
      haySobreSalida: true,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    const aviso = screen.getByTestId('salida-color-aviso-sobre-salida');
    expect(aviso).toHaveTextContent('Sacas más de lo que la orden pide');
    expect(screen.getByTestId('salida-color-aviso-sobre-salida-1')).toHaveTextContent(
      'la orden pide 1,000 KG y ahora sacas 1,200 de cuerpo → te pasas por 200',
    );
    // 🔴 H4: la frase NO puede decir «sacas 1,200» a secas — del anaquel salen cuerpo Y
    // complemento, y la comparación es sólo del cuerpo.
    expect(aviso).toHaveTextContent('Se compara el cuerpo');
    // 🔴 AVISA, NO BLOQUEA: el botón sigue vivo y la salida se registra.
    const guardar = screen.getByTestId('salida-color-guardar');
    expect(guardar).toBeEnabled();
    fireEvent.click(guardar);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  // La segunda tanda: por sí sola cabría, pero sumada a la anterior se pasa. El servidor lo decide;
  // la pantalla tiene que ENSEÑAR lo que ya había salido para que el aviso se entienda.
  it('en la SEGUNDA tanda el aviso dice cuánto había salido ya', () => {
    respuestaPrevia = previa({
      telas: [
        {
          idTela: 1,
          tela: 'Felpa Suiza',
          unidad: 'KG',
          requerido: 1000,
          yaSalido: 700,
          aSacar: 400,
          excedente: 100,
          sobreSalida: true,
          colores: ['Marino'],
        },
      ],
      haySobreSalida: true,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    expect(screen.getByTestId('salida-color-aviso-sobre-salida-1')).toHaveTextContent(
      'la orden pide 1,000 KG, ya habían salido 700 de cuerpo y ahora sacas 400 de cuerpo → te pasas por 100',
    );
  });

  // ⭐ H3 — EL SILENCIO QUE MIENTE. El aviso (a) es silencio o alarma: con una orden SIN explosión
  // el silencio significa «no sé» y quien surte lo lee como «voy bien». Se dice, en tono neutro.
  it('una orden SIN explosión lo DICE en vez de callar (no hay contra qué comparar)', () => {
    respuestaPrevia = previa({ tieneExplosion: false, telas: [], haySobreSalida: false });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    expect(screen.getByTestId('salida-color-aviso-sobre-salida-sin-explosion')).toHaveTextContent(
      'no hay contra qué comparar',
    );
    // No es una alarma: no se pinta el bloque ámbar ni se apaga el botón.
    expect(screen.queryByTestId('salida-color-aviso-sobre-salida')).not.toBeInTheDocument();
    expect(screen.getByTestId('salida-color-guardar')).toBeEnabled();
  });

  it('con explosión y sin exceso NO dice nada de la explosión (ni alarma ni nota)', () => {
    respuestaPrevia = previa({ tieneExplosion: true, telas: [], haySobreSalida: false });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    expect(
      screen.queryByTestId('salida-color-aviso-sobre-salida-sin-explosion'),
    ).not.toBeInTheDocument();
  });

  it('cuando la salida CABE en lo que la orden pide no enseña el aviso de sobre-salida', () => {
    respuestaPrevia = previa({
      telas: [
        {
          idTela: 1,
          tela: 'Felpa Suiza',
          unidad: 'KG',
          requerido: 1000,
          yaSalido: 0,
          aSacar: 60,
          excedente: 0,
          sobreSalida: false,
          colores: ['Marino'],
        },
      ],
      haySobreSalida: false,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    capturar();
    expect(screen.queryByTestId('salida-color-aviso-sobre-salida')).not.toBeInTheDocument();
  });

  // Enlace "Descargar tela del inventario" del avance de producción: la ruta es la MISMA que
  // servía la pantalla por lote, así que el deep-link sigue funcionando en la pantalla nueva.
  it('con deep-link llega con la ORDEN ya puesta (sin tener que buscarla)', async () => {
    useOrden.mockReturnValue({
      data: { id: 42, folio: 5424, codigoModelo: 'M-9', cliente: 'C&A' },
      isError: false,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
      rutaInicial: { pathname: '/inventarios/telas/salida-orden', state: { idOrden: 42 } },
    });

    await waitFor(() => {
      expect(screen.queryByText('Sin orden seleccionada.')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('salida-color-almacen')).toBeInTheDocument();
    expect(useOrden).toHaveBeenCalledWith(42);
  });
  it('solo ofrece almacenes de TELA (no bodegas de PT ni de avíos)', () => {
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
    });
    // El filtro lo aplica el SERVIDOR: la pantalla pide la lista ya acotada.
    expect(almacenesQuery).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'TELA' }));
  });

  it('con el CORTADOR en el deep-link arranca en SU almacén (§Post-F9.13)', async () => {
    useOrden.mockReturnValue({
      data: { id: 42, folio: 5424, codigoModelo: 'M-9', cliente: 'C&A' },
      isError: false,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
      rutaInicial: {
        pathname: '/inventarios/telas/salida-orden',
        state: { idOrden: 42, idCortador: 99 },
      },
    });

    await waitFor(() => {
      // El almacén ligado a ese cortador queda elegido sin que el usuario lo busque.
      expect(screen.getByTestId('salida-color-almacen')).toHaveValue('8');
    });
  });

  it('un cortador SIN almacén ligado no rompe nada: el campo queda vacío', async () => {
    useOrden.mockReturnValue({
      data: { id: 42, folio: 5424, codigoModelo: 'M-9', cliente: 'C&A' },
      isError: false,
    });
    renderConProveedores(<SalidaTelaColorOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover']),
      rutaInicial: {
        pathname: '/inventarios/telas/salida-orden',
        state: { idOrden: 42, idCortador: 12345 },
      },
    });

    await waitFor(() => {
      expect(screen.queryByText('Sin orden seleccionada.')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('salida-color-almacen')).toHaveValue('');
  });
});
