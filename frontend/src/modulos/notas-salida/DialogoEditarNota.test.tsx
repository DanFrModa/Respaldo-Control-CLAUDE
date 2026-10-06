import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { elegirEnCombobox, estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoEditarNota } from './DialogoEditarNota';
import { notaDePrueba } from './fixtures';

// ── Mocks de la capa de datos (sin red) ──────────────────────────────────────
const crearMutate = vi.fn();
const actualizarMutate = vi.fn();
// ⭐ Fila 0.216 — los avisos de «no hay stock» son TOASTS: si no se capturan, la prueba no puede
// distinguir «no lo trajo y lo dijo» de «no lo trajo y se calló».
const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: (mensaje: string): void => {
      toastWarning(mensaje);
    },
    error: (mensaje: string): void => {
      toastError(mensaje);
    },
  },
}));

vi.mock('@/api/notas-salida', () => ({
  useCrearNota: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarNota: () => ({ mutate: actualizarMutate, isPending: false }),
}));

// V1-E7g: el maquilero se elige en un combobox con búsqueda en SERVIDOR. El mock filtra por
// «contiene», igual que el servidor (`idsPorNombreSinAcentos` hace `LIKE %texto%`).
vi.mock('@/api/proveedores', () => ({
  useProveedoresPorRol: (_rol: string | undefined, filtros?: { busqueda?: string }) => {
    const todos = [{ id: 9, nombre: 'Costuras del Bajío' }];
    const busqueda = (filtros?.busqueda ?? '').toLowerCase();
    return {
      data: {
        datos:
          busqueda === '' ? todos : todos.filter((p) => p.nombre.toLowerCase().includes(busqueda)),
      },
      isPending: false,
    };
  },
}));
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({
    data: { datos: [{ id: 2, nombre: 'Almacén central' }] },
    isPending: false,
  }),
}));
/**
 * El renglón elige el avío con el COMBOBOX de búsqueda server-side (V1-E3c). ⭐ Fila 0.216 — el
 * catálogo trae DOS: 'BOT-01', que sí tiene existencia en el almacén 2, y 'CIE-02', que NO. El
 * segundo es el que mide la puerta nueva: el servidor busca en todo el catálogo (no puede filtrar por
 * existencia), así que lo va a ofrecer — y la pantalla no debe dejar que se ponga en el renglón.
 */
vi.mock('@/api/avios', () => ({
  useAvios: () => ({
    data: {
      datos: [
        { id: 3, clave: 'BOT-01', descripcion: 'Botón', esGenerico: false },
        { id: 4, clave: 'CIE-02', descripcion: 'Cierre', esGenerico: false },
      ],
    },
    isPending: false,
    isError: false,
    error: null,
  }),
}));
vi.mock('@/api/telas', () => ({
  useTelas: () => ({ data: { datos: [{ id: 7, nombre: 'Felpa francesa' }] } }),
}));
/**
 * Las órdenes del selector. ⭐ 0.226b: la 51 está CERRADA (`estado: 'cerrada'`): la nota no se
 * guarda con un renglón suyo. ⭐ 0.227: el mock respeta `cerradas` como el SERVIDOR —con `ocultar`
 * (el default de la pantalla) la 51 no viene; sólo con «Mostrar cerradas» (`incluir`)—.
 */
const ORDEN_ABIERTA = {
  id: 50,
  folio: 1001,
  codigoModelo: 'MOD-1',
  cliente: 'Cliente A',
  estado: 'completa',
};
const ORDEN_CERRADA = {
  id: 51,
  folio: 1002,
  codigoModelo: 'MOD-2',
  cliente: 'Cliente A',
  estado: 'cerrada',
};
const SOLO_ABIERTAS = { data: { datos: [ORDEN_ABIERTA] } };
const CON_CERRADAS = { data: { datos: [ORDEN_ABIERTA, ORDEN_CERRADA] } };
const useConsultaOrdenesMock = vi.fn((query: { cerradas?: string }) =>
  query.cerradas === 'ocultar' ? SOLO_ABIERTAS : CON_CERRADAS,
);
vi.mock('@/api/ordenes-consulta', () => ({
  useConsultaOrdenes: (query: { cerradas?: string }) => useConsultaOrdenesMock(query),
}));
/**
 * El editor de renglones usa el kardex de tela (para listar las salidas-a-orden) y las existencias de
 * avío del almacén origen (aviso "excede", R6 §4.6; y desde la fila 0.216, la puerta de «sin stock»).
 *
 * ⚠️ El mock devuelve SIEMPRE el MISMO objeto: la pantalla memoriza el mapa de existencias sobre
 * `data`, y un objeto nuevo por render lo haría recalcular en cada uno.
 */
const useExistenciasAvioMock = vi.fn<() => Record<string, unknown>>();
vi.mock('@/api/inventario-materiales', () => ({
  useKardexTela: () => ({ data: { renglones: [] }, isPending: false }),
  useExistenciasAvio: () => useExistenciasAvioMock(),
}));

/** BOT-01 (id 3) con 500 pzas en el almacén 2; CIE-02 (id 4) ni aparece: nunca entró ahí. */
const EXISTENCIAS_AVIO = {
  data: { filas: [{ idAvio: 3, idAlmacen: 2, existencia: 500, unidad: 'pza' }] },
  isPending: false,
  isError: false,
  isPlaceholderData: false,
};

/** La consulta todavía en vuelo (o apagada): NO se sabe qué hay, así que no se frena nada. */
const EXISTENCIAS_AVIO_EN_VUELO = {
  data: undefined,
  isPending: true,
  isError: false,
  isPlaceholderData: false,
};

/**
 * ⭐ Lo que entrega `keepPreviousData` justo después de cambiar de almacén: los renglones del
 * almacén ANTERIOR (aquí el 99), marcados con `isPlaceholderData`. Son datos reales pero de OTRO
 * almacén: el filtro por `idAlmacen` los descarta todos ⇒ sin la condición `!isPlaceholderData` el
 * mapa quedaría VACÍO y la pantalla leería «no hay nada de nada» durante ese hueco.
 */
const EXISTENCIAS_AVIO_DEL_ANTERIOR = {
  data: { filas: [{ idAvio: 3, idAlmacen: 99, existencia: 500, unidad: 'pza' }] },
  isPending: false,
  isError: false,
  isPlaceholderData: true,
};

/**
 * ⭐ Una consulta que FALLÓ conservando el dato viejo. `data` existe (por eso `data !== undefined` no
 * la caza) pero no se puede creer: sin `!isError` el mapa se armaría vacío y todo avío pasaría por
 * «sin existencia».
 */
const EXISTENCIAS_AVIO_EN_ERROR = {
  data: { filas: [] },
  isPending: false,
  isError: true,
  isPlaceholderData: false,
};
// "Traer avíos de la orden" (R6): la habilitación de la orden elegida (mock controlable por test).
const useHabilitacionOrdenMock = vi.fn();
vi.mock('@/api/habilitacion', () => ({
  useHabilitacionOrden: () => useHabilitacionOrdenMock() as unknown,
}));

/**
 * Elige un avío en el combobox del renglón: enfocar abre la lista y se clickea SU opción (por clave,
 * que el catálogo del mock trae dos — fila 0.216).
 */
function elegirAvioBoton(clave = 'BOT-01'): void {
  fireEvent.focus(screen.getByTestId('selector-avio-nota-busqueda'));
  const opciones = screen.getAllByTestId('selector-avio-nota-opcion');
  const elegida = opciones.find((o) => (o.textContent ?? '').includes(clave));
  if (elegida === undefined) {
    throw new Error(
      `El combobox no ofreció "${clave}"; ofreció: ${opciones.map((o) => o.textContent).join(' · ')}`,
    );
  }
  fireEvent.mouseDown(elegida);
}

describe('DialogoEditarNota (F4-E5)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    actualizarMutate.mockReset();
    useHabilitacionOrdenMock.mockReset();
    useHabilitacionOrdenMock.mockReturnValue({ data: undefined, isPending: false });
    useExistenciasAvioMock.mockReset();
    useExistenciasAvioMock.mockReturnValue(EXISTENCIAS_AVIO);
    toastError.mockReset();
    toastWarning.mockReset();
  });

  it('al ALTA arranca con un renglón vacío y el botón crear deshabilitado', () => {
    renderConProveedores(
      <DialogoEditarNota abierto alCambiarAbierto={() => undefined} alGuardada={() => undefined} />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    expect(screen.getByTestId('renglon-nota')).toBeInTheDocument();
    // Sin maquilero/almacén/material, no se puede guardar.
    expect(screen.getByTestId('confirmar-nota')).toBeDisabled();
  });

  it('un renglón de AVÍO sin avío deja el botón crear deshabilitado (no permite renglón sin material)', async () => {
    renderConProveedores(
      <DialogoEditarNota abierto alCambiarAbierto={() => undefined} alGuardada={() => undefined} />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    // Encabezado completo.
    // «bajío» está EN MEDIO de «Costuras del Bajío»: el `<select>` nativo no lo encontraba.
    await elegirEnCombobox('nota-maquilero', 'bajío', 'Costuras del Bajío');
    fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
    // Orden + cantidad, pero SIN elegir avío.
    fireEvent.change(screen.getByTestId('selector-orden-nota'), { target: { value: '50' } });
    fireEvent.change(screen.getByTestId('cantidad-nota'), { target: { value: '5' } });
    expect(screen.getByTestId('confirmar-nota')).toBeDisabled();
  });

  it('un renglón de AVÍO completo habilita crear y envía el cuerpo', async () => {
    renderConProveedores(
      <DialogoEditarNota abierto alCambiarAbierto={() => undefined} alGuardada={() => undefined} />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    // «bajío» está EN MEDIO de «Costuras del Bajío»: el `<select>` nativo no lo encontraba.
    await elegirEnCombobox('nota-maquilero', 'bajío', 'Costuras del Bajío');
    fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('selector-orden-nota'), { target: { value: '50' } });
    elegirAvioBoton();
    fireEvent.change(screen.getByTestId('cantidad-nota'), { target: { value: '5' } });

    const crear = screen.getByTestId('confirmar-nota');
    expect(crear).toBeEnabled();
    crear.click();
    expect(crearMutate).toHaveBeenCalledTimes(1);
    const cuerpo = crearMutate.mock.calls.at(0)?.[0] as { lineas: { idAvio?: number }[] };
    expect(cuerpo.lineas.at(0)?.idAvio).toBe(3);
  });

  it('⭐ 0.226b: un renglón para una orden CERRADA avisa y apaga crear; con la abierta, no', async () => {
    renderConProveedores(
      <DialogoEditarNota abierto alCambiarAbierto={() => undefined} alGuardada={() => undefined} />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    await elegirEnCombobox('nota-maquilero', 'bajío', 'Costuras del Bajío');
    fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
    // ⭐ 0.227: por omisión la cerrada NO se ofrece (ni en el renglón ni en «Traer avíos»)…
    expect(useConsultaOrdenesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cerradas: 'ocultar' }),
    );
    for (const testid of ['selector-orden-nota', 'nota-traer-orden']) {
      expect(
        within(screen.getByTestId(testid)).queryByRole('option', { name: /Orden 1002/ }),
      ).not.toBeInTheDocument();
    }
    // …y con «Mostrar cerradas» vuelve, MARCADA.
    fireEvent.click(screen.getByTestId('nota-mostrar-cerradas'));
    expect(useConsultaOrdenesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cerradas: 'incluir' }),
    );
    expect(
      within(screen.getByTestId('selector-orden-nota')).getByRole('option', {
        name: /Orden 1002 · MOD-2 · Cerrada/,
      }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('selector-orden-nota'), { target: { value: '51' } });
    elegirAvioBoton();
    fireEvent.change(screen.getByTestId('cantidad-nota'), { target: { value: '5' } });

    expect(screen.getByTestId('aviso-orden-cerrada')).toHaveTextContent(
      /La orden 1002 está cerrada/,
    );
    expect(screen.getByTestId('confirmar-nota')).toBeDisabled();

    // ⭐ 0.227: APAGAR el interruptor NO hace olvidar la cerrada ya elegida: el renglón la sigue
    // mostrando (marcada) y el aviso y el guardar apagado siguen ahí.
    fireEvent.click(screen.getByTestId('nota-mostrar-cerradas'));
    expect(useConsultaOrdenesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cerradas: 'ocultar' }),
    );
    expect(screen.getByTestId('selector-orden-nota')).toHaveValue('51');
    expect(
      within(screen.getByTestId('selector-orden-nota')).getByRole('option', {
        name: /Orden 1002 · MOD-2 · Cerrada/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('aviso-orden-cerrada')).toHaveTextContent(
      /La orden 1002 está cerrada/,
    );
    expect(screen.getByTestId('confirmar-nota')).toBeDisabled();

    // Mismo renglón, orden ABIERTA: el aviso se va y crear vuelve.
    fireEvent.change(screen.getByTestId('selector-orden-nota'), { target: { value: '50' } });
    expect(screen.queryByTestId('aviso-orden-cerrada')).not.toBeInTheDocument();
    expect(screen.getByTestId('confirmar-nota')).toBeEnabled();
  });

  it('⭐ 0.226b: EDITAR una nota cuyo renglón ya viene marcado `ordenCerrada` avisa y no guarda', () => {
    const nota = notaDePrueba();
    const primera = nota.lineas[0];
    if (primera === undefined) throw new Error('fixture sin renglones');
    renderConProveedores(
      <DialogoEditarNota
        abierto
        alCambiarAbierto={() => undefined}
        alGuardada={() => undefined}
        nota={{
          ...nota,
          lineas: [{ ...primera, idOrden: 77, folioOrden: 4321, ordenCerrada: true }],
        }}
      />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    expect(screen.getByTestId('aviso-orden-cerrada')).toHaveTextContent(/La orden 4321/);
    expect(screen.getByTestId('confirmar-nota')).toBeDisabled();
    // ⭐ 0.227: la orden del renglón NO viene en la lista (está cerrada) y aun así se ve ligada y
    // marcada — un `<select>` sin su opción se leería «Elige una orden…».
    expect(screen.getByTestId('selector-orden-nota')).toHaveValue('77');
    expect(
      within(screen.getByTestId('selector-orden-nota')).getByRole('option', {
        name: 'Orden 4321 · Cerrada',
      }),
    ).toBeInTheDocument();
  });

  it('⭐ 0.226b: el PREFILL dice qué orden está cerrada aunque no venga en la lista de órdenes', () => {
    renderConProveedores(
      <DialogoEditarNota
        abierto
        alCambiarAbierto={() => undefined}
        alGuardada={() => undefined}
        prefill={{
          idMaquilero: 9,
          idAlmacen: 2,
          renglones: [{ idOrden: 77, idAvio: 3, clave: 'BOT-01', cantidad: 5, unidad: 'pza' }],
          ordenesCerradas: [{ idOrden: 77, folio: 4321 }],
        }}
      />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    expect(screen.getByTestId('aviso-orden-cerrada')).toHaveTextContent(/La orden 4321/);
    expect(screen.getByTestId('confirmar-nota')).toBeDisabled();
  });

  it('⭐ 0.226b: un PREFILL sin órdenes cerradas no inventa el aviso', () => {
    renderConProveedores(
      <DialogoEditarNota
        abierto
        alCambiarAbierto={() => undefined}
        alGuardada={() => undefined}
        prefill={{
          idMaquilero: 9,
          idAlmacen: 2,
          renglones: [{ idOrden: 77, idAvio: 3, clave: 'BOT-01', cantidad: 5, unidad: 'pza' }],
          ordenesCerradas: [],
        }}
      />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    expect(screen.queryByTestId('aviso-orden-cerrada')).not.toBeInTheDocument();
  });

  it('el constructor es SOLO-AVÍOS: no ofrece renglones de tela (§4.6 dec. 2)', () => {
    renderConProveedores(
      <DialogoEditarNota abierto alCambiarAbierto={() => undefined} alGuardada={() => undefined} />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    // No hay selector de "Tipo de material" ni forma de armar un renglón de tela desde aquí:
    // la tela se registra en «Salida de tela a orden» (por color).
    expect(screen.queryByTestId('tipo-material-nota')).toBeNull();
    expect(screen.queryByTestId('selector-tela-nota')).toBeNull();
    // El único selector de material del renglón es el de avío (ahora un combobox buscable).
    expect(screen.getByTestId('selector-avio-nota-busqueda')).toBeInTheDocument();
  });

  it('"Traer avíos de la orden" carga la receta como renglones con su cantidad sugerida (R6)', () => {
    useHabilitacionOrdenMock.mockReturnValue({
      data: {
        idOrden: 50,
        folioOrden: 1001,
        idMaquilero: 9,
        avios: [
          { idAvio: 3, clave: 'BOT-01', requerido: 180, unidad: 'pza', esExtra: false },
          // Un extra NO se trae (solo la receta).
          { idAvio: 99, clave: 'EXT-99', requerido: 0, unidad: 'pza', esExtra: true },
        ],
      },
      isPending: false,
    });
    renderConProveedores(
      <DialogoEditarNota abierto alCambiarAbierto={() => undefined} alGuardada={() => undefined} />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    // ⭐ Fila 0.216 — el almacén va PRIMERO: de él sale qué avíos hay para mandar.
    fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
    // Elige la orden en el selector de "Traer avíos" y pulsa el botón.
    fireEvent.change(screen.getByTestId('nota-traer-orden'), { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('nota-traer-boton'));

    // El renglón vacío inicial se descartó y quedó el avío de la receta (cantidad = requerido).
    expect(screen.getByTestId('cantidad-nota')).toHaveValue(180);
    // La clave viaja con el renglón traído: el combobox la muestra sin depender del typeahead.
    expect(screen.getByTestId('selector-avio-nota-busqueda')).toHaveValue('BOT-01');
  });

  /**
   * ⭐⭐ FILA 0.216 — «QUE NO DEJE METER LOS AVÍOS QUE NO HAY STOCK, **ANTES** DE METERLOS».
   *
   * Textual de Daniel (§Post-F9.243, punto 07c): *«Al traer los avíos de la OP… como me jala avíos que
   * no hay stock, no me deja. Estaría bien que no deje meter los avíos que no hay stock, ANTES de
   * meterlos. Porque ahorita valida DESPUÉS de haberlos metido en la nota de salida.»*
   *
   * ⚠️ La guarda del servidor sigue intacta (A1): esto sólo evita llegar hasta ella.
   */
  describe('los avíos SIN existencia (fila 0.216)', () => {
    /** Receta con uno que hay (BOT-01, 500 pzas) y uno que no (CIE-02, sin renglón de existencia). */
    function recetaMixta(): void {
      useHabilitacionOrdenMock.mockReturnValue({
        data: {
          idOrden: 50,
          folioOrden: 1001,
          idMaquilero: 9,
          avios: [
            { idAvio: 3, clave: 'BOT-01', requerido: 180, unidad: 'pza', esExtra: false },
            { idAvio: 4, clave: 'CIE-02', requerido: 60, unidad: 'pza', esExtra: false },
          ],
        },
        isPending: false,
      });
    }

    function abrirAlta(): void {
      renderConProveedores(
        <DialogoEditarNota
          abierto
          alCambiarAbierto={() => undefined}
          alGuardada={() => undefined}
        />,
        { sesion: estadoSesionDePrueba(['notas.administrar']) },
      );
    }

    /**
     * 🔴 EL GUARDIÁN DEL FILTRO DE LA PRECARGA. Sin el `filter(hayStockDeAvio…)` de `traerAvios`, la
     * nota nace con los DOS renglones —uno de ellos imposible de confirmar— y esta prueba encuentra
     * dos. MEDIDO.
     */
    it('⭐ «Traer avíos» NO trae los que no hay, y lo DICE por su clave', () => {
      recetaMixta();
      abrirAlta();
      fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
      fireEvent.change(screen.getByTestId('nota-traer-orden'), { target: { value: '50' } });
      fireEvent.click(screen.getByTestId('nota-traer-boton'));

      // Un solo renglón: el que sí hay.
      expect(screen.getAllByTestId('renglon-nota')).toHaveLength(1);
      expect(screen.getByTestId('selector-avio-nota-busqueda')).toHaveValue('BOT-01');
      // Y el que faltó se dice con su clave: la receta lo pide y alguien tiene que ir a comprarlo.
      expect(toastWarning).toHaveBeenCalledTimes(1);
      expect(toastWarning.mock.calls[0]?.[0]).toContain('CIE-02');
    });

    it('si NINGUNO de la receta tiene existencia no trae nada y lo dice', () => {
      useHabilitacionOrdenMock.mockReturnValue({
        data: {
          idOrden: 50,
          folioOrden: 1001,
          idMaquilero: 9,
          avios: [{ idAvio: 4, clave: 'CIE-02', requerido: 60, unidad: 'pza', esExtra: false }],
        },
        isPending: false,
      });
      abrirAlta();
      fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
      fireEvent.change(screen.getByTestId('nota-traer-orden'), { target: { value: '50' } });
      fireEvent.click(screen.getByTestId('nota-traer-boton'));

      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError.mock.calls[0]?.[0]).toContain('no hay nada que mandar');
      // El renglón vacío del alta sigue ahí, sin avío: no se trajo ninguno.
      expect(screen.getByTestId('selector-avio-nota-busqueda')).toHaveValue('');
    });

    /**
     * 🔒 Y SIN ALMACÉN NO SE TRAE NADA. El stock es *de un almacén*: sin él `hayStockDeAvio` deja
     * pasar todo (no inventa ceros) y volvería el defecto entero. Quitar esta guarda hace que la
     * prueba encuentre los dos renglones.
     */
    it('⭐ sin ALMACÉN ORIGEN «Traer avíos» no trae nada (no se sabe qué hay)', () => {
      recetaMixta();
      abrirAlta();
      fireEvent.change(screen.getByTestId('nota-traer-orden'), { target: { value: '50' } });
      fireEvent.click(screen.getByTestId('nota-traer-boton'));

      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError.mock.calls[0]?.[0]).toContain('Elige primero el almacén origen');
      expect(screen.getAllByTestId('renglon-nota')).toHaveLength(1);
      expect(screen.getByTestId('selector-avio-nota-busqueda')).toHaveValue('');
    });

    /**
     * 🔴 EL GUARDIÁN DE LA PUERTA DEL RENGLÓN. El combobox SÍ ofrece 'CIE-02' (el servidor busca en
     * todo el catálogo y no sabe de existencias), así que la única defensa es no dejarlo entrar.
     * Quitando el `if (!hayStockDeAvio(...)) return` el campo se queda con 'CIE-02' puesto y esta
     * prueba falla. MEDIDO.
     */
    it('⭐ elegir a mano un avío SIN existencia NO lo pone en el renglón, y dice por qué', () => {
      abrirAlta();
      fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
      fireEvent.change(screen.getByTestId('selector-orden-nota'), { target: { value: '50' } });
      fireEvent.change(screen.getByTestId('cantidad-nota'), { target: { value: '60' } });
      elegirAvioBoton('CIE-02');

      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError.mock.calls[0]?.[0]).toContain('no tiene existencia en el almacén origen');
      // ⭐ El campo queda VACÍO: el combobox se REMONTA tras el rechazo (su `key`). Sin eso se
      // quedaba enseñando 'CIE-02' —lo escribe él al clickear, antes de saber si el padre acepta— y
      // la pantalla mentía: campo lleno, renglón sin avío. MEDIDO: quitando la `key` esto falla.
      expect(screen.getByTestId('selector-avio-nota-busqueda')).toHaveValue('');
      // Y la consecuencia que de verdad importa: un renglón sin avío no se puede crear.
      expect(screen.getByTestId('confirmar-nota')).toBeDisabled();
    });

    it('y el que SÍ hay entra normal (gemela positiva: la puerta no se cerró para todos)', () => {
      abrirAlta();
      fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
      fireEvent.change(screen.getByTestId('selector-orden-nota'), { target: { value: '50' } });
      fireEvent.change(screen.getByTestId('cantidad-nota'), { target: { value: '60' } });
      elegirAvioBoton('BOT-01');

      expect(toastError).not.toHaveBeenCalled();
      fireEvent.blur(screen.getByTestId('selector-avio-nota-busqueda'));
      expect(screen.getByTestId('selector-avio-nota-busqueda')).toHaveValue('BOT-01');
    });

    /**
     * ⭐ Y MIENTRAS NO SE SABE, NO SE FRENA NADA. Sin almacén —o con la consulta en vuelo— bloquear
     * sería inventar un cero: se deja pasar y decide el servidor al confirmar (A1). Quitar la
     * condición `stockConocido` deja la captura entera bloqueada, que es peor que el defecto que la
     * fila vino a arreglar.
     */
    /**
     * 🔴🔴 EL HUECO DE `keepPreviousData` — hallazgo del reviewer: quitando `!isPlaceholderData` de
     * `stockConocido` las 14 pruebas seguían VERDES, y es **justo la condición que separa «no se
     * sabe» de «no hay»**. La prueba de «en vuelo» no la alcanza porque corta antes, por
     * `data === undefined`.
     *
     * El escenario real: se cambia de almacén, la consulta nueva sale y mientras vuelve TanStack
     * entrega los renglones del almacén ANTERIOR. Son de otro `idAlmacen`, el filtro los descarta
     * todos y el mapa queda vacío ⇒ sin esta condición, durante ese hueco **ningún avío se puede
     * elegir** y la pantalla dice que no hay existencia de nada.
     */
    it('🔴 con los datos del almacén ANTERIOR (placeholder) NO se bloquea nada', () => {
      useExistenciasAvioMock.mockReturnValue(EXISTENCIAS_AVIO_DEL_ANTERIOR);
      abrirAlta();
      fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
      elegirAvioBoton('BOT-01');

      expect(toastError).not.toHaveBeenCalled();
      fireEvent.blur(screen.getByTestId('selector-avio-nota-busqueda'));
      expect(screen.getByTestId('selector-avio-nota-busqueda')).toHaveValue('BOT-01');
      // Y no se pinta existencia: no se sabe cuánta hay, así que no se afirma ninguna.
      expect(screen.queryByTestId('existencia-nota')).not.toBeInTheDocument();
    });

    /**
     * ⚠️ Y una consulta que FALLÓ no es un almacén vacío. `data` sigue ahí (el dato viejo), así que
     * `data !== undefined` no la caza: hace falta `!isError`. Sin él, un fallo de red convertiría
     * cada avío en «sin existencia» y dejaría la nota incapturable.
     */
    it('⚠️ con las existencias EN ERROR tampoco se bloquea (un fallo no es un cero)', () => {
      useExistenciasAvioMock.mockReturnValue(EXISTENCIAS_AVIO_EN_ERROR);
      abrirAlta();
      fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
      elegirAvioBoton('BOT-01');

      expect(toastError).not.toHaveBeenCalled();
      fireEvent.blur(screen.getByTestId('selector-avio-nota-busqueda'));
      expect(screen.getByTestId('selector-avio-nota-busqueda')).toHaveValue('BOT-01');
    });

    it('⭐ sin almacén (o con la consulta en vuelo) NO se bloquea la captura', () => {
      useExistenciasAvioMock.mockReturnValue(EXISTENCIAS_AVIO_EN_VUELO);
      abrirAlta();
      fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
      elegirAvioBoton('CIE-02');

      expect(toastError).not.toHaveBeenCalled();
      // El avío SÍ quedó en el renglón: al soltar el campo, la etiqueta de la selección sigue ahí.
      fireEvent.blur(screen.getByTestId('selector-avio-nota-busqueda'));
      expect(screen.getByTestId('selector-avio-nota-busqueda')).toHaveValue('CIE-02');
    });
  });

  /**
   * ⭐ La fecha de ELABORACIÓN del alta arranca en HOY — y «hoy» es el día DEL NEGOCIO (México), no
   * el día UTC: con `toISOString()`, de 18:00 a 23:59 de México este campo proponía **mañana**.
   *
   * 🔴 **Y la de ENVÍO arranca VACÍA, a propósito: es un ESTADO del negocio** («todavía no ha
   * salido»). El contrato la declara opcional *«cuando salga el envío»*, dos pantallas pintan
   * «pendiente» cuando es `null`, sale impresa en el papel que acompaña las prendas y el confirmar
   * NUNCA la escribe. Ponerla en «hoy» por default —como se hizo en la primera vuelta de la fila
   * 0.216— borraba ese estado para toda nota nueva; esta aserción es la que no deja que vuelva.
   */
  it('⭐ la fecha de ELABORACIÓN arranca en HOY y la de ENVÍO arranca VACÍA', () => {
    renderConProveedores(
      <DialogoEditarNota abierto alCambiarAbierto={() => undefined} alGuardada={() => undefined} />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    const hoyDelNegocio = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Mexico_City',
    });
    expect(screen.getByTestId('nota-fecha-elaboracion')).toHaveValue(hoyDelNegocio);
    expect(screen.getByTestId('nota-fecha-envio')).toHaveValue('');
  });

  it('en EDICIÓN las fechas son las de la nota, no las de hoy (no se le pisa lo guardado)', () => {
    renderConProveedores(
      <DialogoEditarNota
        abierto
        alCambiarAbierto={() => undefined}
        nota={notaDePrueba()}
        alGuardada={() => undefined}
      />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    const nota = notaDePrueba();
    expect(screen.getByTestId('nota-fecha-elaboracion')).toHaveValue(nota.fechaElaboracion);
  });

  it('en EDICIÓN precarga el encabezado de la nota', () => {
    renderConProveedores(
      <DialogoEditarNota
        abierto
        alCambiarAbierto={() => undefined}
        nota={notaDePrueba()}
        alGuardada={() => undefined}
      />,
      { sesion: estadoSesionDePrueba(['notas.administrar']) },
    );
    expect(screen.getByTestId('nota-maquilero-busqueda')).toHaveValue('Costuras del Bajío');
    expect(screen.getByTestId('nota-almacen')).toHaveValue('2');
    // Dos renglones precargados (avío + tela).
    expect(screen.getAllByTestId('renglon-nota')).toHaveLength(2);
  });
});
