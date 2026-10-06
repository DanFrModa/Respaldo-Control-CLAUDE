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
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (mensaje: string): void => {
      toastSuccess(mensaje);
    },
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
        // ⭐ Fila 0.220: un tercero FUERA de la receta de las pruebas, para medir el flag ⚠.
        { id: 5, clave: 'ETQ-03', descripcion: 'Etiqueta', esGenerico: false },
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

/** La casilla de un avío en el PRELIMINAR de «Traer avíos» (fila 0.220), por su clave. */
function casillaPreliminar(clave: string): HTMLInputElement {
  const fila = screen
    .getAllByTestId('preliminar-fila')
    .find((f) => within(f).queryByText(clave) !== null);
  if (fila === undefined) throw new Error(`El preliminar no enseña "${clave}"`);
  return within(fila).getByTestId('preliminar-chk');
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
    toastSuccess.mockReset();
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
          {
            idAvio: 3,
            clave: 'BOT-01',
            descripcion: 'Botón',
            requerido: 180,
            enviado: 0,
            falta: 180,
            unidad: 'pza',
            esExtra: false,
          },
          // Un extra NO se trae (solo la receta).
          {
            idAvio: 99,
            clave: 'EXT-99',
            descripcion: 'Extra',
            requerido: 0,
            enviado: 0,
            falta: 0,
            unidad: 'pza',
            esExtra: true,
          },
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

    // ⭐ Fila 0.220: primero el PRELIMINAR (sólo la receta: el extra no sale), y nada en la nota aún.
    expect(screen.getAllByTestId('preliminar-fila')).toHaveLength(1);
    expect(screen.getByTestId('selector-avio-nota-busqueda')).toHaveValue('');
    fireEvent.click(screen.getByTestId('preliminar-confirmar'));

    // El renglón vacío inicial se descartó y quedó el avío de la receta, con lo que le falta a la
    // orden (aquí nada se ha enviado, así que falta = requerido; la diferencia se mide aparte).
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
            {
              idAvio: 3,
              clave: 'BOT-01',
              descripcion: 'Botón',
              requerido: 180,
              enviado: 0,
              falta: 180,
              unidad: 'pza',
              esExtra: false,
            },
            {
              idAvio: 4,
              clave: 'CIE-02',
              descripcion: 'Cierre',
              requerido: 60,
              enviado: 0,
              falta: 60,
              unidad: 'pza',
              esExtra: false,
            },
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

      // ⭐ Fila 0.220: el preliminar lo enseña (no lo esconde), deshabilitado y con sus claves.
      expect(screen.getAllByTestId('preliminar-fila')).toHaveLength(2);
      expect(casillaPreliminar('CIE-02')).toBeDisabled();
      expect(screen.getByTestId('preliminar-sin-existencia')).toHaveTextContent('CIE-02');
      fireEvent.click(screen.getByTestId('preliminar-confirmar'));

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
          avios: [
            {
              idAvio: 4,
              clave: 'CIE-02',
              descripcion: 'Cierre',
              requerido: 60,
              enviado: 0,
              falta: 60,
              unidad: 'pza',
              esExtra: false,
            },
          ],
        },
        isPending: false,
      });
      abrirAlta();
      fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
      fireEvent.change(screen.getByTestId('nota-traer-orden'), { target: { value: '50' } });
      fireEvent.click(screen.getByTestId('nota-traer-boton'));

      // ⭐ Fila 0.220: el preliminar se abre igual —para que se vea qué falta— y lo dice; no hay
      // nada que marcar, así que no deja confirmar.
      expect(screen.getByTestId('preliminar-nada-que-mandar')).toHaveTextContent(
        'no hay nada que mandar',
      );
      expect(casillaPreliminar('CIE-02')).toBeDisabled();
      expect(screen.getByTestId('preliminar-confirmar')).toBeDisabled();
      fireEvent.click(
        within(screen.getByTestId('preliminar-avios')).getByRole('button', { name: 'Cancelar' }),
      );
      expect(screen.queryByTestId('preliminar-avios')).not.toBeInTheDocument();
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
   * ⭐⭐ FILA 0.220 — EL PRELIMINAR: «ver un preliminar y seleccionar qué avíos son los que se van a
   * mandar (obviamente… que sólo te ofrezca los que ya se recibieron en almacén)» (Daniel, 07b).
   */
  describe('el PRELIMINAR de «Traer avíos» (fila 0.220)', () => {
    /** BOT-01 (500) y ETQ-03 (12) hay; CIE-02 no. */
    const EXISTENCIAS_DOS = {
      data: {
        filas: [
          { idAvio: 3, idAlmacen: 2, existencia: 500, unidad: 'pza' },
          { idAvio: 5, idAlmacen: 2, existencia: 12, unidad: 'pza' },
        ],
      },
      isPending: false,
      isError: false,
      isPlaceholderData: false,
    };

    function abrirPreliminar(): void {
      useExistenciasAvioMock.mockReturnValue(EXISTENCIAS_DOS);
      useHabilitacionOrdenMock.mockReturnValue({
        data: {
          idOrden: 50,
          folioOrden: 1001,
          idMaquilero: 9,
          avios: [
            {
              idAvio: 3,
              clave: 'BOT-01',
              descripcion: 'Botón',
              requerido: 180,
              enviado: 0,
              falta: 180,
              unidad: 'pza',
              esExtra: false,
            },
            {
              idAvio: 4,
              clave: 'CIE-02',
              descripcion: 'Cierre',
              requerido: 60,
              enviado: 0,
              falta: 60,
              unidad: 'pza',
              esExtra: false,
            },
            {
              idAvio: 5,
              clave: 'ETQ-03',
              descripcion: 'Etiqueta',
              requerido: 30,
              enviado: 0,
              falta: 30,
              unidad: 'pza',
              esExtra: false,
            },
          ],
        },
        isPending: false,
      });
      renderConProveedores(
        <DialogoEditarNota
          abierto
          alCambiarAbierto={() => undefined}
          alGuardada={() => undefined}
        />,
        { sesion: estadoSesionDePrueba(['notas.administrar']) },
      );
      fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
      fireEvent.change(screen.getByTestId('nota-traer-orden'), { target: { value: '50' } });
      fireEvent.click(screen.getByTestId('nota-traer-boton'));
    }

    function avioDeRenglones(): string[] {
      return screen
        .getAllByTestId('selector-avio-nota-busqueda')
        .map((e) => (e as HTMLInputElement).value);
    }

    it('⭐ no mete nada de golpe: enseña la lista y los que hay vienen MARCADOS', () => {
      abrirPreliminar();
      expect(screen.getAllByTestId('preliminar-fila')).toHaveLength(3);
      expect(casillaPreliminar('BOT-01')).toBeChecked();
      expect(casillaPreliminar('ETQ-03')).toBeChecked();
      expect(casillaPreliminar('CIE-02')).not.toBeChecked();
      expect(casillaPreliminar('CIE-02')).toBeDisabled();
      // La nota sigue con su renglón vacío: nada entra hasta confirmar.
      expect(avioDeRenglones()).toEqual(['']);
    });

    it('⭐ camino rápido: confirmar sin tocar nada mete los que hay', () => {
      abrirPreliminar();
      fireEvent.click(screen.getByTestId('preliminar-confirmar'));
      expect(screen.queryByTestId('preliminar-avios')).not.toBeInTheDocument();
      expect(avioDeRenglones()).toEqual(['BOT-01', 'ETQ-03']);
    });

    it('⭐ DESMARCAR uno lo deja fuera de la nota (y no se avisa como faltante)', () => {
      abrirPreliminar();
      fireEvent.click(casillaPreliminar('ETQ-03'));
      fireEvent.click(screen.getByTestId('preliminar-confirmar'));
      expect(avioDeRenglones()).toEqual(['BOT-01']);
      // El aviso de faltantes habla de lo que NO HAY, no de lo que se desmarcó a propósito.
      expect(toastWarning).toHaveBeenCalledTimes(1);
      expect(toastWarning.mock.calls[0]?.[0]).toContain('CIE-02');
      expect(toastWarning.mock.calls[0]?.[0]).not.toContain('ETQ-03');
    });

    it('cancelar el preliminar no mete nada', () => {
      abrirPreliminar();
      fireEvent.click(
        within(screen.getByTestId('preliminar-avios')).getByRole('button', { name: 'Cancelar' }),
      );
      expect(screen.queryByTestId('preliminar-avios')).not.toBeInTheDocument();
      expect(avioDeRenglones()).toEqual(['']);
    });

    /**
     * ⭐ Si con el preliminar abierto la existencia deja de saberse (la consulta falla al refrescar),
     * la regla de las 0.216/0.233 manda: no se inventa un cero, así que el que no había se puede
     * marcar —y decide el servidor al confirmar la nota (A1)—.
     */
    it('⭐ si la existencia deja de saberse, el que no había SE PUEDE marcar y entra', () => {
      abrirPreliminar();
      expect(casillaPreliminar('CIE-02')).toBeDisabled();
      useExistenciasAvioMock.mockReturnValue(EXISTENCIAS_AVIO_EN_ERROR);
      // Cualquier cambio de estado re-pinta el diálogo y vuelve a leer las existencias.
      fireEvent.change(screen.getByTestId('nota-observaciones'), { target: { value: 'x' } });
      expect(casillaPreliminar('CIE-02')).toBeEnabled();
      expect(casillaPreliminar('CIE-02')).not.toBeChecked();
      fireEvent.click(casillaPreliminar('CIE-02'));
      fireEvent.click(screen.getByTestId('preliminar-confirmar'));
      expect(avioDeRenglones()).toEqual(['BOT-01', 'CIE-02', 'ETQ-03']);
    });

    /**
     * ⭐⭐ FILA 0.220 (decisión del lead) — se propone lo que le FALTA a la orden, no el requerido:
     * una OP surtida a medias volvía a pedir la receta entera y se podían mandar avíos de más. Lo ya
     * surtido sale «Ya surtido» y no se puede marcar.
     */
    describe('lo que le FALTA a la orden', () => {
      /**
       * BOT-01 ya surtido (180 de 180) y CON existencia; CIE-02 a medias (60 pedidos, 20 enviados ⇒
       * faltan 40); HIL-06 ya surtido y SIN existencia — el que mide que lo ya surtido no se avisa
       * como faltante (con existencia, el aviso no lo nombraría de todos modos).
       */
      function abrirOpAMedias(): void {
        useExistenciasAvioMock.mockReturnValue({
          data: {
            filas: [
              { idAvio: 3, idAlmacen: 2, existencia: 500, unidad: 'pza' },
              { idAvio: 4, idAlmacen: 2, existencia: 100, unidad: 'pza' },
              { idAvio: 5, idAlmacen: 2, existencia: 12, unidad: 'pza' },
            ],
          },
          isPending: false,
          isError: false,
          isPlaceholderData: false,
        });
        useHabilitacionOrdenMock.mockReturnValue({
          data: {
            idOrden: 50,
            folioOrden: 1001,
            idMaquilero: 9,
            avios: [
              {
                idAvio: 3,
                clave: 'BOT-01',
                descripcion: 'Botón',
                requerido: 180,
                enviado: 180,
                falta: 0,
                unidad: 'pza',
                esExtra: false,
              },
              {
                idAvio: 4,
                clave: 'CIE-02',
                descripcion: 'Cierre',
                requerido: 60,
                enviado: 20,
                falta: 40,
                unidad: 'pza',
                esExtra: false,
              },
              {
                idAvio: 6,
                clave: 'HIL-06',
                descripcion: 'Hilo',
                requerido: 90,
                enviado: 90,
                falta: 0,
                unidad: 'pza',
                esExtra: false,
              },
            ],
          },
          isPending: false,
        });
        renderConProveedores(
          <DialogoEditarNota
            abierto
            alCambiarAbierto={() => undefined}
            alGuardada={() => undefined}
          />,
          { sesion: estadoSesionDePrueba(['notas.administrar']) },
        );
        fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
        fireEvent.change(screen.getByTestId('nota-traer-orden'), { target: { value: '50' } });
        fireEvent.click(screen.getByTestId('nota-traer-boton'));
      }

      it('⭐ una OP surtida a medias propone la FALTA, no el requerido', () => {
        abrirOpAMedias();
        const filaCierre = screen
          .getAllByTestId('preliminar-fila')
          .find((f) => within(f).queryByText('CIE-02') !== null);
        expect(
          within(filaCierre as HTMLElement).getByTestId('preliminar-cantidad'),
        ).toHaveTextContent('40 pza');
        fireEvent.click(screen.getByTestId('preliminar-confirmar'));
        expect(avioDeRenglones()).toEqual(['CIE-02']);
        expect(screen.getByTestId('cantidad-nota')).toHaveValue(40);
      });

      it('⭐ un avío YA SURTIDO sale «Ya surtido», no se puede marcar y no entra (ni se avisa)', () => {
        abrirOpAMedias();
        const filaBoton = screen
          .getAllByTestId('preliminar-fila')
          .find((f) => within(f).queryByText('BOT-01') !== null);
        expect(
          within(filaBoton as HTMLElement).getByTestId('preliminar-cantidad'),
        ).toHaveTextContent('Ya surtido');
        // Aunque HAY 500 en el almacén: no le falta a la orden.
        expect(casillaPreliminar('BOT-01')).toBeDisabled();
        expect(casillaPreliminar('BOT-01')).not.toBeChecked();
        fireEvent.click(screen.getByTestId('preliminar-marcar-todos'));
        fireEvent.click(screen.getByTestId('preliminar-marcar-todos'));
        expect(casillaPreliminar('BOT-01')).not.toBeChecked();
        fireEvent.click(screen.getByTestId('preliminar-confirmar'));
        expect(avioDeRenglones()).not.toContain('BOT-01');
        // Lo ya surtido no es un faltante que haya que ir a comprar.
        expect(toastWarning).not.toHaveBeenCalled();
      });

      /**
       * El flag ✓/⚠ mide contra la receta COMPLETA de la orden, no contra lo que se trajo: un avío de
       * la receta que no se trajo (aquí, por ya surtido) sigue siendo «de la receta» si alguien lo
       * agrega a mano —p. ej. para reponer merma—, y uno de fuera sigue saliendo ⚠.
       */
      it('el flag ✓/⚠ de la receta sigue funcionando', () => {
        abrirOpAMedias();
        fireEvent.click(screen.getByTestId('preliminar-confirmar'));
        expect(screen.getByTestId('flag-receta-nota')).toHaveTextContent('en la receta');

        function agregarAMano(clave: string): void {
          fireEvent.click(screen.getByTestId('agregar-renglon-nota'));
          const ordenes = screen.getAllByTestId('selector-orden-nota');
          fireEvent.change(ordenes[ordenes.length - 1] as HTMLElement, { target: { value: '50' } });
          const buscadores = screen.getAllByTestId('selector-avio-nota-busqueda');
          fireEvent.focus(buscadores[buscadores.length - 1] as HTMLElement);
          const opcion = screen
            .getAllByTestId('selector-avio-nota-opcion')
            .find((o) => (o.textContent ?? '').includes(clave));
          fireEvent.mouseDown(opcion as HTMLElement);
        }
        agregarAMano('BOT-01');
        agregarAMano('ETQ-03');
        const flags = screen.getAllByTestId('flag-receta-nota').map((f) => f.textContent);
        expect(flags).toHaveLength(3);
        expect(flags[0]).toContain('en la receta');
        // BOT-01 no se trajo (ya surtido) pero ES de la receta.
        expect(flags[1]).toContain('en la receta');
        expect(flags[2]).toContain('fuera de la receta');
      });
    });

    /**
     * ⭐⭐ Revisión de la fila 0.220 — los datos de la habilitación tienen que ser los de AHORA, y lo
     * que ESTA nota ya lleva se descuenta de lo que se propone.
     */
    describe('datos vivos y lo que la nota ya lleva', () => {
      /** CIE-02: 60 pedidos; la existencia de las pruebas tiene 3, 4 y 5. */
      const EXISTENCIAS_TRES = {
        data: {
          filas: [
            { idAvio: 3, idAlmacen: 2, existencia: 500, unidad: 'pza' },
            { idAvio: 4, idAlmacen: 2, existencia: 100, unidad: 'pza' },
            { idAvio: 5, idAlmacen: 2, existencia: 12, unidad: 'pza' },
          ],
        },
        isPending: false,
        isError: false,
        isPlaceholderData: false,
      };
      function habilitacion(falta: number): Record<string, unknown> {
        return {
          idOrden: 50,
          folioOrden: 1001,
          idMaquilero: 9,
          avios: [
            {
              idAvio: 3,
              clave: 'BOT-01',
              descripcion: 'Botón',
              requerido: 180,
              enviado: 0,
              falta: 180,
              unidad: 'pza',
              esExtra: false,
            },
            {
              idAvio: 4,
              clave: 'CIE-02',
              descripcion: 'Cierre',
              requerido: 60,
              enviado: 60 - falta,
              falta,
              unidad: 'pza',
              esExtra: false,
            },
          ],
        };
      }
      function render(prefill?: Parameters<typeof DialogoEditarNota>[0]['prefill']): void {
        useExistenciasAvioMock.mockReturnValue(EXISTENCIAS_TRES);
        renderConProveedores(
          <DialogoEditarNota
            abierto
            alCambiarAbierto={() => undefined}
            alGuardada={() => undefined}
            prefill={prefill}
          />,
          { sesion: estadoSesionDePrueba(['notas.administrar']) },
        );
        if (prefill === undefined) {
          fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
        }
        fireEvent.change(screen.getByTestId('nota-traer-orden'), { target: { value: '50' } });
      }
      function cantidadPreliminar(clave: string): string {
        const fila = screen
          .getAllByTestId('preliminar-fila')
          .find((f) => within(f).queryByText(clave) !== null);
        return within(fila as HTMLElement).getByTestId('preliminar-cantidad').textContent ?? '';
      }
      /** Re-pinta el diálogo (cualquier cambio de estado vuelve a leer las consultas). */
      function repintar(): void {
        fireEvent.change(screen.getByTestId('nota-observaciones'), {
          target: { value: String(Math.random()) },
        });
      }

      it('🔴 con la orden REFRESCÁNDOSE (datos viejos en mano) no abre el preliminar', () => {
        useHabilitacionOrdenMock.mockReturnValue({
          data: habilitacion(60),
          isPending: false,
          isFetching: true,
          isError: false,
        });
        render();
        expect(screen.getByTestId('nota-traer-boton')).toBeDisabled();
        fireEvent.click(screen.getByTestId('nota-traer-boton'));
        expect(screen.queryByTestId('preliminar-avios')).not.toBeInTheDocument();
      });

      it('🔴 con la consulta de la orden EN ERROR no abre y dice que no se pudo leer la receta', () => {
        useHabilitacionOrdenMock.mockReturnValue({
          data: habilitacion(60),
          isPending: false,
          isFetching: false,
          isError: true,
          error: { message: 'Se cayó la red.' },
        });
        render();
        expect(screen.getByTestId('nota-traer-boton')).toBeDisabled();
        fireEvent.click(screen.getByTestId('nota-traer-boton'));
        expect(screen.queryByTestId('preliminar-avios')).not.toBeInTheDocument();
        expect(screen.getByTestId('nota-traer-error')).toHaveTextContent(
          'No se pudo leer la receta de la orden: Se cayó la red.',
        );
      });

      it('⭐ si la orden se refresca con el preliminar ABIERTO, la falta se actualiza ahí mismo', () => {
        useHabilitacionOrdenMock.mockReturnValue({ data: habilitacion(60), isPending: false });
        render();
        fireEvent.click(screen.getByTestId('nota-traer-boton'));
        expect(cantidadPreliminar('CIE-02')).toBe('60 pza');

        // Mientras se refresca: no se deja confirmar con la cifra vieja, y se dice por qué.
        useHabilitacionOrdenMock.mockReturnValue({
          data: habilitacion(60),
          isPending: false,
          isFetching: true,
        });
        repintar();
        expect(screen.getByTestId('preliminar-confirmar')).toBeDisabled();
        expect(screen.getByTestId('preliminar-aviso-datos')).toHaveTextContent('Actualizando');

        // Llega el dato nuevo (otra nota confirmó 20 entretanto).
        useHabilitacionOrdenMock.mockReturnValue({ data: habilitacion(40), isPending: false });
        repintar();
        expect(cantidadPreliminar('CIE-02')).toBe('40 pza');
        fireEvent.click(screen.getByTestId('preliminar-confirmar'));
        expect(
          screen.getAllByTestId('cantidad-nota').map((e) => (e as HTMLInputElement).value),
        ).toEqual(['180', '40']);
      });

      it('⭐ con el borrador llevando ya BOT-01 de la orden, propone sólo el RESTO', () => {
        useHabilitacionOrdenMock.mockReturnValue({ data: habilitacion(60), isPending: false });
        render({
          idMaquilero: 9,
          idAlmacen: 2,
          renglones: [{ idOrden: 50, idAvio: 3, clave: 'BOT-01', cantidad: 100, unidad: 'pza' }],
        });
        fireEvent.click(screen.getByTestId('nota-traer-boton'));
        expect(cantidadPreliminar('BOT-01')).toContain('80 pza');
        expect(cantidadPreliminar('BOT-01')).toContain('100 pza ya en esta nota');
        fireEvent.click(screen.getByTestId('preliminar-confirmar'));
        expect(
          screen.getAllByTestId('cantidad-nota').map((e) => (e as HTMLInputElement).value),
        ).toEqual(['100', '80', '60']);
      });

      it('⭐ traer DOS veces la misma orden no duplica: la segunda dice «ya en esta nota»', () => {
        useHabilitacionOrdenMock.mockReturnValue({ data: habilitacion(60), isPending: false });
        render();
        fireEvent.click(screen.getByTestId('nota-traer-boton'));
        fireEvent.click(screen.getByTestId('preliminar-confirmar'));
        expect(screen.getAllByTestId('renglon-nota')).toHaveLength(2);

        fireEvent.click(screen.getByTestId('nota-traer-boton'));
        expect(cantidadPreliminar('BOT-01')).toBe('Ya en esta nota');
        expect(cantidadPreliminar('CIE-02')).toBe('Ya en esta nota');
        expect(casillaPreliminar('BOT-01')).toBeDisabled();
        expect(casillaPreliminar('BOT-01')).not.toBeChecked();
        expect(screen.getByTestId('preliminar-nada-que-mandar')).toHaveTextContent(
          'ya va en esta nota',
        );
        expect(screen.getByTestId('preliminar-confirmar')).toBeDisabled();
        expect(screen.getAllByTestId('renglon-nota')).toHaveLength(2);
      });

      it('los toasts hablan en SINGULAR cuando es uno', () => {
        useHabilitacionOrdenMock.mockReturnValue({
          data: {
            idOrden: 50,
            folioOrden: 1001,
            idMaquilero: 9,
            avios: [
              {
                idAvio: 3,
                clave: 'BOT-01',
                descripcion: 'Botón',
                requerido: 180,
                enviado: 0,
                falta: 180,
                unidad: 'pza',
                esExtra: false,
              },
              {
                idAvio: 6,
                clave: 'HIL-06',
                descripcion: 'Hilo',
                requerido: 90,
                enviado: 0,
                falta: 90,
                unidad: 'pza',
                esExtra: false,
              },
            ],
          },
          isPending: false,
        });
        render();
        fireEvent.click(screen.getByTestId('nota-traer-boton'));
        fireEvent.click(screen.getByTestId('preliminar-confirmar'));
        expect(toastSuccess).toHaveBeenCalledWith(
          '1 avío de la orden 1001 agregado desde su receta.',
        );
        expect(toastWarning).toHaveBeenCalledWith(
          'No se trajo 1 avío de la receta porque no hay existencia en este almacén: HIL-06.',
        );
      });
    });

    it('con el almacén elegido pero su existencia EN VUELO no abre el preliminar (aún no se sabe)', () => {
      useExistenciasAvioMock.mockReturnValue(EXISTENCIAS_AVIO_EN_VUELO);
      useHabilitacionOrdenMock.mockReturnValue({
        data: {
          idOrden: 50,
          folioOrden: 1001,
          idMaquilero: 9,
          avios: [
            {
              idAvio: 4,
              clave: 'CIE-02',
              descripcion: 'Cierre',
              requerido: 60,
              enviado: 0,
              falta: 60,
              unidad: 'pza',
              esExtra: false,
            },
          ],
        },
        isPending: false,
      });
      renderConProveedores(
        <DialogoEditarNota
          abierto
          alCambiarAbierto={() => undefined}
          alGuardada={() => undefined}
        />,
        { sesion: estadoSesionDePrueba(['notas.administrar']) },
      );
      fireEvent.change(screen.getByTestId('nota-almacen'), { target: { value: '2' } });
      fireEvent.change(screen.getByTestId('nota-traer-orden'), { target: { value: '50' } });
      fireEvent.click(screen.getByTestId('nota-traer-boton'));
      expect(screen.queryByTestId('preliminar-avios')).not.toBeInTheDocument();
      expect(toastError.mock.calls[0]?.[0]).toContain('espera a que cargue su existencia');
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
