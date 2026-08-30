import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListaLinea } from '@/api/listas-precios';
import type { NegociacionEvento } from '@/api/negociacion';
import type { PrecostoResumen } from '@/api/precostos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoNegociacionRenglon } from './DialogoNegociacionRenglon';

// ── Estado controlado de la capa de datos (sin red) ──────────────────────────────
let eventos: { data: NegociacionEvento[]; isPending: boolean; isError: boolean; error: null };
let versiones: { data: PrecostoResumen[] };
const rondaMutate = vi.fn();
const acuerdoMutate = vi.fn();

vi.mock('@/api/negociacion', () => ({
  useEventosLinea: () => eventos,
  useRegistrarRonda: () => ({ mutate: rondaMutate, isPending: false }),
  useRegistrarAcuerdo: () => ({ mutate: acuerdoMutate, isPending: false }),
  // La calculadora en vivo: el hook devuelve una simulación fija (no golpea red) para poder aseverar
  // que el margen se pinta. Los valores exactos los prueban los tests del dominio/CalculadoraNegociacion.
  useSimularNegociacion: () => ({
    data: {
      costo: 40,
      precioObjetivo: 205,
      precioNeto: 164,
      margenBrutoPct: 75.6,
      margenObjetivoPct: 50,
      cumpleObjetivo: true,
    },
    isPending: false,
    isError: false,
    error: null,
  }),
}));
vi.mock('@/api/precostos', () => ({
  usePrecostosDesarrollo: () => versiones,
  CLAVE_PRECOSTOS: ['precostos'],
}));
vi.mock('@/api/desarrollos', () => ({
  useDesarrollo: () => ({ data: undefined }),
}));
// El editor de precosto y el comparador se prueban por separado: aquí se estampan.
vi.mock('@/modulos/desarrollo/DialogoPrecosto', () => ({
  DialogoPrecosto: () => <div data-testid="stub-precosto" />,
}));
vi.mock('./ComparadorVersiones', () => ({
  ComparadorVersiones: () => <div data-testid="stub-comparador" />,
}));
// La MESA (§Post-F9.138) tiene su propio archivo de pruebas (`MesaNegociacion.test.tsx`), donde se
// prueba que al mover un costo el margen cambia en pantalla. Aquí sólo se estampa, para aseverar que
// el diálogo la MONTA (y sólo con los dos permisos que su endpoint exige).
vi.mock('./MesaNegociacion', () => ({
  MesaNegociacion: () => <div data-testid="stub-mesa" />,
}));

function linea(): ListaLinea {
  return {
    id: 7,
    idDesarrollo: 3,
    idPrecosto: 11,
    versionPrecosto: 1,
    avisoCostoViejo: null,
    codigoModelo: 'MOD-X',
    descripcionModelo: null,
    numeroCliente: null,
    costoUnit: 40,
    precioCalculado: 100,
    precioAprobado: null,
    precioTarget: null, // ⭐ V1-E8w (§Post-F9.150): este renglón no trae target del cliente.
    tieneTarget: false,
    aprobado: false,
    aprobadoPorId: null,
    aprobadoEn: null,
  };
}

function evento(
  over: Partial<NegociacionEvento> & Pick<NegociacionEvento, 'id'>,
): NegociacionEvento {
  return {
    idListaLinea: 7,
    idPrecostoAnterior: 11,
    idPrecostoNuevo: 12,
    versionAnterior: 1,
    versionNueva: 2,
    precioAnterior: 100,
    precioNuevo: 120,
    acuerdo: 'Se quitan bolsas',
    registradoPorId: 'u1',
    nombreRegistradoPor: 'Daniel Masri',
    registradoEn: '2026-07-06T10:00:00.000Z',
    // ⭐ V1-E8w (§Post-F9.149): una RONDA no trae desglose de mesa. El caso con desglose lo pone
    // su propia prueba, con importes ≠ 0.
    costoEstimado: null,
    costos: [],
    ...over,
  };
}

function resumen(
  over: Partial<PrecostoResumen> & Pick<PrecostoResumen, 'id' | 'version'>,
): PrecostoResumen {
  return {
    estado: 'congelado',
    congelado: true,
    costoTotal: 40,
    congeladoEn: '2026-07-06T00:00:00.000Z',
    congeladoPorId: null,
    creadoEn: '2026-07-06T00:00:00.000Z',
    ...over,
  };
}

describe('<DialogoNegociacionRenglon>', () => {
  beforeEach(() => {
    rondaMutate.mockReset();
    acuerdoMutate.mockReset();
    eventos = { data: [], isPending: false, isError: false, error: null };
    versiones = { data: [] };
  });

  it('muestra el historial de eventos y permite comparar una ronda', async () => {
    const usuario = userEvent.setup();
    eventos = { data: [evento({ id: 1 })], isPending: false, isError: false, error: null };
    renderConProveedores(
      <DialogoNegociacionRenglon
        abierto
        alCambiarAbierto={() => {}}
        linea={linea()}
        verImportes
        puedeNegociar
      />,
      { sesion: estadoSesionDePrueba(['listas.ver', 'listas.negociar']) },
    );

    const panel = screen.getByTestId('panel-negociacion');
    expect(within(panel).getByTestId('fila-evento-negociacion')).toBeInTheDocument();
    expect(within(panel).getByText('Se quitan bolsas')).toBeInTheDocument();

    await usuario.click(within(panel).getByTestId('comparar-evento'));
    expect(screen.getByTestId('stub-comparador')).toBeInTheDocument();
  });

  /**
   * ⭐ V1-E8q (§Post-F9.141) — lo que Daniel pidió VER, se prueba que SE VE.
   *
   * El hilo es "el porqué de cada número": dentro de seis meses se lee "estampado 9.00" y la
   * pregunta no es cuánto sino POR QUÉ ése, y de quién salió. Por eso no basta con que el endpoint
   * responda: hay que probar que el hilo se PINTA, con sus tres piezas —autor, fecha y texto— y en
   * ORDEN cronológico. Antes de esta etapa la columna de autor no existía: se leía el qué y el
   * cuándo, nunca el quién.
   */
  it('🔴 pinta el hilo completo: autor, fecha y texto de cada comentario, en orden', () => {
    eventos = {
      data: [
        evento({ id: 1, acuerdo: 'Le bajaron dos colores', nombreRegistradoPor: 'Daniel Masri' }),
        evento({
          id: 2,
          acuerdo: 'Le quitaron una costura al costado',
          nombreRegistradoPor: 'Gabriel',
        }),
      ],
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(
      <DialogoNegociacionRenglon
        abierto
        alCambiarAbierto={() => {}}
        linea={linea()}
        verImportes
        puedeNegociar
      />,
      { sesion: estadoSesionDePrueba(['listas.ver', 'listas.negociar']) },
    );

    const panel = screen.getByTestId('panel-negociacion');
    const filas = within(panel).getAllByTestId('fila-evento-negociacion');
    expect(filas).toHaveLength(2);

    // Cada renglón trae SU autor, SU fecha y SU texto (no basta con que estén sueltos en la página).
    expect(within(filas[0] as HTMLElement).getByTestId('autor-evento')).toHaveTextContent(
      'Daniel Masri',
    );
    expect(within(filas[0] as HTMLElement).getByText('Le bajaron dos colores')).toBeInTheDocument();
    expect(within(filas[0] as HTMLElement).getByText(/2026/)).toBeInTheDocument();

    expect(within(filas[1] as HTMLElement).getByTestId('autor-evento')).toHaveTextContent(
      'Gabriel',
    );
    expect(
      within(filas[1] as HTMLElement).getByText('Le quitaron una costura al costado'),
    ).toBeInTheDocument();

    // ORDEN cronológico: el hilo se lee de arriba abajo, como se negoció.
    const autores = within(panel)
      .getAllByTestId('autor-evento')
      .map((n) => n.textContent);
    expect(autores).toEqual(['Daniel Masri', 'Gabriel']);
  });

  /**
   * 🔴 V1-E8q (H3) — los TRES casos de `autorDeEvento`, que NO se pueden colapsar en dos.
   *
   * «Sistema» sólo cuando NADIE lo escribió (`registradoPorId === null`). Si hay id pero el nombre no
   * resuelve, lo escribió una PERSONA: decir «Sistema» ahí **le atribuiría al sistema lo que dijo
   * alguien en una mesa de negociación**. El backend distingue los dos casos; la pantalla también.
   */
  it('«Sistema» sólo si NADIE lo escribió; con id sin nombre dice que fue una persona', () => {
    eventos = {
      data: [
        evento({
          id: 1,
          registradoPorId: null,
          nombreRegistradoPor: null,
          acuerdo: 'asiento auto',
        }),
        evento({
          id: 2,
          registradoPorId: 'cm3x9k2q0000abcd1234efgh',
          nombreRegistradoPor: null,
          acuerdo: 'lo escribió alguien',
        }),
      ],
      isPending: false,
      isError: false,
      error: null,
    };
    renderConProveedores(
      <DialogoNegociacionRenglon
        abierto
        alCambiarAbierto={() => {}}
        linea={linea()}
        verImportes
        puedeNegociar
      />,
      { sesion: estadoSesionDePrueba(['listas.ver', 'listas.negociar']) },
    );

    const filas = screen.getAllByTestId('fila-evento-negociacion');
    // (1) sin autor → Sistema
    expect(within(filas[0] as HTMLElement).getByTestId('autor-evento')).toHaveTextContent(
      'Sistema',
    );
    expect(within(filas[0] as HTMLElement).getByText('asiento auto')).toBeInTheDocument();
    // (2) con id y sin nombre → NO es «Sistema», y NUNCA el id crudo
    const autor2 = within(filas[1] as HTMLElement).getByTestId('autor-evento');
    expect(autor2).toHaveTextContent('Usuario dado de baja');
    expect(autor2.textContent).not.toContain('cm3x9k2q0000abcd1234efgh');
    expect(within(filas[1] as HTMLElement).getByText('lo escribió alguien')).toBeInTheDocument();
  });

  it('sin listas.negociar NO ofrece las acciones de negociar', () => {
    eventos = { data: [], isPending: false, isError: false, error: null };
    renderConProveedores(
      <DialogoNegociacionRenglon
        abierto
        alCambiarAbierto={() => {}}
        linea={linea()}
        verImportes
        puedeNegociar={false}
      />,
      { sesion: estadoSesionDePrueba(['listas.ver']) },
    );
    expect(screen.queryByTestId('abrir-nueva-ronda')).not.toBeInTheDocument();
    expect(screen.queryByTestId('abrir-acuerdo')).not.toBeInTheDocument();
    expect(screen.getByTestId('negociacion-vacia')).toBeInTheDocument();
    // Y tampoco la MESA: su endpoint exige `listas.negociar` (§Post-F9.138).
    expect(screen.queryByTestId('stub-mesa')).not.toBeInTheDocument();
  });

  /**
   * ⭐⭐ La MESA (§Post-F9.138) es lo PRIMERO del panel: es lo que se usa con el cliente enfrente,
   * mientras que el historial cuenta lo que ya pasó. Se monta con los DOS permisos que su endpoint
   * exige (`listas.negociar` + `consultas.ver-importes`) y con ninguno menos.
   */
  it('monta la MESA con listas.negociar + importes, y no sin importes', () => {
    eventos = { data: [], isPending: false, isError: false, error: null };
    const { unmount } = renderConProveedores(
      <DialogoNegociacionRenglon
        abierto
        alCambiarAbierto={() => {}}
        linea={linea()}
        verImportes
        puedeNegociar
      />,
      { sesion: estadoSesionDePrueba(['listas.ver', 'listas.negociar']) },
    );
    expect(screen.getByTestId('stub-mesa')).toBeInTheDocument();
    unmount();

    renderConProveedores(
      <DialogoNegociacionRenglon
        abierto
        alCambiarAbierto={() => {}}
        linea={linea()}
        verImportes={false}
        puedeNegociar
      />,
      { sesion: estadoSesionDePrueba(['listas.ver', 'listas.negociar']) },
    );
    expect(screen.queryByTestId('stub-mesa')).not.toBeInTheDocument();
  });

  it('la nueva ronda exige elegir versión + acuerdo y llama a registrarRonda', async () => {
    const usuario = userEvent.setup();
    // Una versión congelada distinta de la actual (id 12 ≠ idPrecosto 11) para poder elegirla.
    versiones = { data: [resumen({ id: 12, version: 2 })] };
    renderConProveedores(
      <DialogoNegociacionRenglon
        abierto
        alCambiarAbierto={() => {}}
        linea={linea()}
        verImportes
        puedeNegociar
      />,
      { sesion: estadoSesionDePrueba(['listas.ver', 'listas.negociar', 'desarrollo.precostear']) },
    );

    await usuario.click(screen.getByTestId('abrir-nueva-ronda'));
    await usuario.selectOptions(screen.getByTestId('ronda-version'), '12');
    await usuario.type(screen.getByTestId('ronda-acuerdo'), 'Quitamos bolsas');
    // Con versión elegida + verImportes, el precio se captura en la CALCULADORA (§4.8), no en un input llano.
    await usuario.type(screen.getByTestId('calculadora-precio-objetivo'), '150');
    await usuario.click(screen.getByTestId('confirmar-ronda'));

    expect(rondaMutate).toHaveBeenCalledTimes(1);
    expect(rondaMutate).toHaveBeenCalledWith(
      {
        idLinea: 7,
        cuerpo: { idPrecostoNuevo: 12, acuerdo: 'Quitamos bolsas', precioAcordado: 150 },
      },
      expect.anything(),
    );
  });

  it('la calculadora muestra el margen a COSTO VIGENTE sin elegir versión nueva (§4.8)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoNegociacionRenglon
        abierto
        alCambiarAbierto={() => {}}
        linea={linea()}
        verImportes
        puedeNegociar
      />,
      // ⭐ V1-E8b: el margen sólo lo enseña el sistema a quien puede APROBAR precios
      // (§Post-F9.125(b)), así que esta sesión lleva `listas.aprobar`. Antes bastaba negociar.
      { sesion: estadoSesionDePrueba(['listas.ver', 'listas.negociar', 'listas.aprobar']) },
    );

    await usuario.click(screen.getByTestId('abrir-nueva-ronda'));
    const form = screen.getByTestId('form-nueva-ronda');
    // Sin seleccionar versión (idVersion === ''): la calculadora ya está y, al capturar el objetivo,
    // muestra el margen contra el costo VIGENTE del renglón (no exige congelar una versión nueva).
    await usuario.type(within(form).getByTestId('calculadora-precio-objetivo'), '205');
    expect(within(form).getByTestId('margen-bruto')).toBeInTheDocument();
    expect(within(form).getByTestId('badge-cumple-objetivo')).toBeInTheDocument();
  });

  // ⭐ V1-E8b (§Post-F9.125(b)) — la calculadora era la TERCERA puerta a los factores, y la más
  // ancha: enseñaba `obj. 44.4%`, que ES el margen del cliente servido tal cual. Quien negocia sin
  // aprobar precios sigue capturando el precio acordado —eso es su trabajo— pero el sistema ya no
  // le entrega el veredicto. Daniel: *"puede hacer sus cálculos, pero el sistema no le muestra
  // información digerida"*.
  it('🔴 SIN `listas.aprobar` no se pinta el margen, y se dice por qué', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoNegociacionRenglon
        abierto
        alCambiarAbierto={() => {}}
        linea={linea()}
        verImportes
        puedeNegociar
      />,
      { sesion: estadoSesionDePrueba(['listas.ver', 'listas.negociar']) },
    );

    await usuario.click(screen.getByTestId('abrir-nueva-ronda'));
    const form = screen.getByTestId('form-nueva-ronda');
    await usuario.type(within(form).getByTestId('calculadora-precio-objetivo'), '205');

    expect(within(form).queryByTestId('margen-bruto')).toBeNull();
    expect(within(form).queryByTestId('badge-cumple-objetivo')).toBeNull();
    // Y el input SIGUE ahí: es el «precio acordado» de la ronda, que sí es trabajo de quien negocia.
    expect(within(form).getByTestId('calculadora-precio-objetivo')).toBeInTheDocument();
    // No se esconde en silencio: se dice a quién le toca (§Post-F9.68).
    expect(within(form).getByTestId('calculadora-negociacion').textContent).toMatch(/dueño/i);
  });

  it('el acuerdo sin re-costeo llama a registrarAcuerdo', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoNegociacionRenglon
        abierto
        alCambiarAbierto={() => {}}
        linea={linea()}
        verImportes
        puedeNegociar
      />,
      { sesion: estadoSesionDePrueba(['listas.ver', 'listas.negociar']) },
    );

    await usuario.click(screen.getByTestId('abrir-acuerdo'));
    await usuario.type(screen.getByTestId('acuerdo-texto'), 'Cliente pide muestra');
    await usuario.click(screen.getByTestId('confirmar-acuerdo'));

    expect(acuerdoMutate).toHaveBeenCalledTimes(1);
    expect(acuerdoMutate).toHaveBeenCalledWith(
      { idLinea: 7, cuerpo: { acuerdo: 'Cliente pide muestra' } },
      expect.anything(),
    );
  });
});
