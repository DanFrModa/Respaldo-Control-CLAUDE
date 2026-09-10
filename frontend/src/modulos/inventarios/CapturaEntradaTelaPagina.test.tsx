import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as ReactRouter from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { elegirEnCombobox, estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

/**
 * Pruebas de la CAPTURA de una entrada de tela por factura/remisión (etapa B1): la cabecera del
 * documento + los renglones (partidas) se mandan juntos y el documento nace en BORRADOR (no toca
 * el inventario hasta confirmarse desde la lista). Sin renglones o sin número de documento, el
 * botón no deja guardar.
 */

// Los AVISOS de la pantalla son parte de lo que se prueba (§Post-F9.159(a): un letrero que afirma
// de más es el defecto), así que el toast se espía en vez de dejarlo pasar sin mirar.
const { avisoToast } = vi.hoisted(() => ({
  avisoToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: avisoToast }));

const crearMutate = vi.fn();
const actualizarMutate = vi.fn();
const leerCfdiMutate = vi.fn();
const navegar = vi.fn();
const useEntradaTelaMock = vi.fn();

vi.mock('@/api/entradas-tela', () => ({
  useCrearEntradaTela: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarEntradaTela: () => ({ mutate: actualizarMutate, isPending: false }),
  useEntradaTela: (id: unknown) => useEntradaTelaMock(id) as unknown,
  // §Post-F9.20 — lectura del XML de la factura (se espía el cuerpo que manda la pantalla).
  useLeerCfdiEntradaTela: () => ({ mutate: leerCfdiMutate, isPending: false }),
}));
const espiaLineasOc = vi.fn();
/**
 * §Post-F9.159(a) — el estado de ESTA consulta es uno de los dos ejes del diagnóstico, así que las
 * pruebas tienen que poder moverlo: `hay` (default), `vacio`, `error` y `cargando`.
 */
const { estadoConsultaOc } = vi.hoisted(() => {
  const estadoConsultaOc: { valor: 'hay' | 'vacio' | 'error' | 'cargando' } = { valor: 'hay' };
  return { estadoConsultaOc };
});
vi.mock('@/api/compras-lineas-tela', () => ({
  useLineasTelaPendientes: (idProveedor: number | undefined, idOrdenCompra?: number) => {
    espiaLineasOc(idProveedor, idOrdenCompra);
    const pendientes = [
      {
        idOrdenCompraLinea: 55,
        idOrdenCompra: 7,
        numCompra: 1007,
        idTela: 3,
        tela: 'Felpa Suiza',
        unidad: 'kg',
        cantidad: 100,
        recibido: 0,
        pendiente: 100,
        precio: 12,
      },
    ];
    if (idProveedor === undefined) {
      // Sin proveedor la query ni se habilita: en TanStack v5 eso es `pending` con `data` vacío.
      return { data: undefined, isPending: true, isError: false };
    }
    switch (estadoConsultaOc.valor) {
      case 'vacio':
        return { data: [], isPending: false, isError: false };
      case 'error':
        // 🔴 El caso que el reviewer señaló: en v5 el ERROR deja `isPending` en false y `data` en
        // undefined — leerlo como "lista vacía" es leer "no se sabe" como "no hay".
        return { data: undefined, isPending: false, isError: true };
      case 'cargando':
        return { data: undefined, isPending: true, isError: false };
      default:
        return { data: pendientes, isPending: false, isError: false };
    }
  },
}));
/**
 * Catálogo de mentiras con LOS TRES tipos de almacén (fila 0.137). El mock de `useAlmacenes` filtra
 * por el `tipo` que pide la pantalla: si la pantalla se olvidara de pedirlo, los tres saldrían en el
 * desplegable y la prueba lo cazaría — que es justo lo que se quiere fijar, y no un
 * `toHaveBeenCalledWith` que solo mira la consulta.
 */
const ALMACENES_TODOS = [
  { id: 3, nombre: 'Primeras', tipo: 'PT' },
  { id: 2, nombre: 'Bodega Telas', tipo: 'TELA' },
  { id: 7, nombre: 'Almacén de avíos', tipo: 'AVIO' },
];

/** Los del `tipo` pedido (o todos si la pantalla no filtra — el caso que la prueba caza). */
function almacenesDelTipo(query: { tipo?: string } | undefined) {
  const tipo = query?.tipo;
  return tipo === undefined ? ALMACENES_TODOS : ALMACENES_TODOS.filter((a) => a.tipo === tipo);
}

vi.mock('@/api/almacenes', () => ({
  useAlmacenes: (query: { tipo?: string } | undefined) => ({
    data: { datos: almacenesDelTipo(query), total: almacenesDelTipo(query).length },
    isPending: false,
    isError: false,
  }),
}));
// Espía del código de rol con el que la captura pide los proveedores (debe ser "vende-telas").
const { espiaRolProveedor } = vi.hoisted(() => ({ espiaRolProveedor: vi.fn() }));
vi.mock('@/api/proveedores', () => ({
  COD_ROL_PROVEEDOR: { vendeTelas: 'vende-telas', vendeAvios: 'vende-avios' },
  // V1-E7g: el proveedor se elige en un combobox con búsqueda en SERVIDOR. El mock filtra por
  // «contiene», igual que el servidor (`idsPorNombreSinAcentos` hace `LIKE %texto%`).
  useProveedoresPorRol: (codigo: string | undefined, filtros?: { busqueda?: string }) => {
    espiaRolProveedor(codigo);
    // El backend ya filtró por rol: solo llegan proveedores de telas.
    const todos = [
      // §Post-F9.22 — los dos tipos de proveedor conviven en el mismo selector.
      { id: 3, nombre: 'Textiles del Norte', factura: true },
      { id: 4, nombre: 'Talleres Don Chuy', factura: false },
    ];
    const busqueda = (filtros?.busqueda ?? '').toLowerCase();
    const datos =
      busqueda === '' ? todos : todos.filter((p) => p.nombre.toLowerCase().includes(busqueda));
    return {
      data: { datos, total: datos.length },
      isPending: false,
      isError: false,
    };
  },
}));
// Los parámetros de ruta son MUTABLES: `…/:id/editar` es lo que distingue el alta de la edición, y
// hay pruebas de las dos (cada una fija `parametrosRuta.valor` antes de renderizar).
const { parametrosRuta } = vi.hoisted(() => {
  const parametrosRuta: { valor: { id?: string } } = { valor: {} };
  return { parametrosRuta };
});
vi.mock('react-router-dom', async () => {
  const real = await vi.importActual<typeof ReactRouter>('react-router-dom');
  return { ...real, useNavigate: () => navegar, useParams: () => parametrosRuta.valor };
});
// La captura de renglones se simula: un botón que emite un renglón ya armado.
// §Post-F9.159(a): el renglón trae SU renglón de orden de compra, porque desde esa decisión un
// renglón suelto ya no se puede capturar (el componente real ni siquiera deja agregarlo) y la
// pantalla no arma el cuerpo sin él. Un mock que lo omitiera probaría un caso imposible.
// `vi.hoisted`: el `vi.mock` se iza por encima de las declaraciones del módulo.
const { espiaProveedorTelas } = vi.hoisted(() => ({ espiaProveedorTelas: vi.fn() }));
vi.mock('./CapturaRenglonesTelaColor', () => ({
  CapturaRenglonesTelaColor: ({
    onChange,
    idProveedorTelas,
    exigirOrdenCompra,
    lineasOc,
    estadoPendientesOc,
  }: {
    onChange: (renglones: unknown[]) => void;
    idProveedorTelas?: number;
    exigirOrdenCompra?: boolean;
    lineasOc?: readonly unknown[];
    estadoPendientesOc?: string;
  }) => (
    <>
      {espiaProveedorTelas(idProveedorTelas)}
      {/* La pantalla de entrada SIEMPRE exige la orden de compra (§Post-F9.159(a)). */}
      <span data-testid="espia-exige-oc">{String(exigirOrdenCompra === true)}</span>
      {/* Los DOS ejes, por separado: lo OFRECIDO aquí y lo que el PROVEEDOR tiene pendiente. */}
      <span data-testid="espia-ofrecidos">{String(lineasOc?.length ?? -1)}</span>
      <span data-testid="espia-estado-oc">{String(estadoPendientesOc)}</span>
      <button
        type="button"
        data-testid="agregar-renglon"
        onClick={() =>
          onChange([
            {
              idTelaColor: 71,
              tela: 'Felpa Suiza',
              color: 'Marino',
              nombreComplemento: 'Cardigan',
              cantidad: 300,
              cantidadComplemento: 45,
              loteProveedor: 'L-A',
              precioUnit: 90,
              precioUnitComplemento: 120,
              idOrdenCompraLinea: 500,
            },
          ])
        }
      >
        agregar renglón
      </button>
    </>
  ),
}));

const { CapturaEntradaTelaPagina } = await import('./CapturaEntradaTelaPagina');

describe('CapturaEntradaTelaPagina (B1)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    actualizarMutate.mockReset();
    navegar.mockReset();
    useEntradaTelaMock.mockReset();
    useEntradaTelaMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    parametrosRuta.valor = {};
  });

  /**
   * Fila 0.137 — el almacén DESTINO de una entrada de tela sólo puede ser de TELA; el desplegable
   * ya no ofrece los de PT ni los de avíos (el dominio los rechaza con un 400 desde esta fila).
   */
  it('el almacén destino SOLO ofrece almacenes de TELA (fila 0.137)', () => {
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    const selector = within(screen.getByTestId('entrada-almacen'));
    expect(selector.getByRole('option', { name: 'Bodega Telas' })).toBeInTheDocument();
    expect(selector.queryByRole('option', { name: 'Primeras' })).not.toBeInTheDocument();
    expect(selector.queryByRole('option', { name: 'Almacén de avíos' })).not.toBeInTheDocument();
  });

  it('manda cabecera + renglones (con precios y lote del proveedor) al guardar el borrador', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });

    await usuario.selectOptions(screen.getByTestId('entrada-tipo'), 'remision');
    await usuario.type(screen.getByTestId('entrada-numero'), 'R-2200');
    await elegirEnCombobox('entrada-proveedor', 'Textiles del Norte');
    await usuario.selectOptions(screen.getByTestId('entrada-almacen'), '2');
    await usuario.click(screen.getByTestId('agregar-renglon'));
    await usuario.click(screen.getByTestId('entrada-guardar'));

    expect(crearMutate).toHaveBeenCalledTimes(1);
    expect(crearMutate.mock.calls[0]?.[0]).toMatchObject({
      tipoDocumento: 'remision',
      numeroDocumento: 'R-2200',
      idProveedor: 3,
      idAlmacen: 2,
      lineas: [
        {
          idTelaColor: 71,
          cantidad: 300,
          cantidadComplemento: 45,
          loteProveedor: 'L-A',
          precioUnit: 90,
          precioUnitComplemento: 120,
        },
      ],
    });
  });

  it('sin número de documento o sin renglones no deja guardar', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    await elegirEnCombobox('entrada-proveedor', 'Textiles del Norte');
    await usuario.selectOptions(screen.getByTestId('entrada-almacen'), '2');
    // Sin número NI renglones.
    expect(screen.getByTestId('entrada-guardar')).toBeDisabled();
    await usuario.type(screen.getByTestId('entrada-numero'), 'A-1');
    // Con número pero sin renglones sigue deshabilitado.
    expect(screen.getByTestId('entrada-guardar')).toBeDisabled();
  });

  it('un documento CONFIRMADO no se edita: avisa y bloquea la captura (no muere con 409)', () => {
    useEntradaTelaMock.mockReturnValue({
      data: {
        id: 5,
        folio: 12,
        estatus: 'confirmada',
        tipoDocumento: 'factura',
        numeroDocumento: 'A-1001',
        idProveedor: 3,
        fecha: '2026-08-06',
        idAlmacen: 2,
        observaciones: null,
        avisos: [],
        lineas: [],
      },
      isPending: false,
      isError: false,
    });
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    expect(screen.getByTestId('entrada-no-editable')).toHaveTextContent('confirmada');
    expect(screen.getByTestId('entrada-numero')).toBeDisabled();
    expect(screen.getByTestId('entrada-guardar')).toBeDisabled();
  });

  it('el AVISO de factura repetida se muestra al editar (informa, no bloquea)', () => {
    useEntradaTelaMock.mockReturnValue({
      data: {
        id: 5,
        folio: 12,
        estatus: 'borrador',
        tipoDocumento: 'factura',
        numeroDocumento: 'A-1001',
        idProveedor: 3,
        fecha: '2026-08-06',
        idAlmacen: 2,
        observaciones: null,
        avisos: ['Ojo: ya hay otra entrada de este proveedor con el documento "A-1001" (folio 7).'],
        lineas: [],
      },
      isPending: false,
      isError: false,
    });
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    expect(screen.getByTestId('entrada-aviso')).toHaveTextContent('A-1001');
    // No bloquea: los campos siguen editables.
    expect(screen.getByTestId('entrada-numero')).toBeEnabled();
  });

  it('sin `inventario-telas.mover` la captura queda deshabilitada', () => {
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    expect(screen.getByTestId('entrada-numero')).toBeDisabled();
    expect(screen.getByTestId('entrada-guardar')).toBeDisabled();
  });

  it('solo ofrece proveedores con el rol «Vende telas» (decisión P.2)', async () => {
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    // La lista se pide ACOTADA al rol: el filtro lo aplica el servidor, no la pantalla.
    expect(espiaRolProveedor).toHaveBeenCalledWith('vende-telas');
    // V1-E7g: la lista vive en el popover del combobox, que se abre al enfocar el campo.
    fireEvent.focus(screen.getByTestId('entrada-proveedor-busqueda'));
    const opciones = await screen.findAllByTestId('entrada-proveedor-opcion');
    expect(opciones.map((o) => o.textContent)).toContain('Textiles del Norte');
    expect(screen.getByTestId('entrada-proveedor-ayuda')).toHaveTextContent('«Vende telas»');
  });

  it('al EDITAR conserva el proveedor capturado aunque no traiga el rol', () => {
    // Documento viejo cuyo proveedor (id 99) no aparece en la lista acotada.
    useEntradaTelaMock.mockReturnValue({
      data: {
        id: 5,
        folio: 12,
        estatus: 'borrador',
        tipoDocumento: 'factura',
        numeroDocumento: 'A-1001',
        idProveedor: 99,
        proveedor: 'Taller Montaño',
        fecha: '2026-08-06',
        idAlmacen: 2,
        observaciones: null,
        avisos: [],
        lineas: [],
      },
      isPending: false,
      isError: false,
    });
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    // El combobox lo MUESTRA por su nombre aunque la búsqueda acotada al rol no lo devuelva.
    expect(screen.getByTestId('entrada-proveedor-busqueda')).toHaveValue('Taller Montaño');
  });

  it('§Post-F9.14: los renglones de OC pendientes se piden por el PROVEEDOR elegido', async () => {
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });

    // Sin proveedor elegido no hay universo que consultar (la consulta queda apagada).
    expect(espiaLineasOc).toHaveBeenCalledWith(undefined, undefined);

    await elegirEnCombobox('entrada-proveedor', 'Textiles del Norte');
    expect(espiaLineasOc).toHaveBeenCalledWith(3, undefined);
  });

  it('§Post-F9.15: llegando DESDE la OC, el proveedor queda FIJO y los pendientes son de esa orden', async () => {
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
      rutaInicial: {
        pathname: '/inventarios/telas/entradas/nueva',
        state: { idOrdenCompra: 7, idProveedor: 3 },
      },
    });

    await waitFor(() => {
      // El proveedor lo puso la orden…
      expect(screen.getByTestId('entrada-proveedor-busqueda')).toHaveValue('Textiles del Norte');
    });
    // …y no se puede cambiar (cambiarlo dejaría los renglones ligados a otra orden).
    expect(screen.getByTestId('entrada-proveedor-busqueda')).toBeDisabled();
    expect(screen.getByTestId('entrada-proveedor-ayuda')).toHaveTextContent('orden de compra');
    // Los pendientes se piden ACOTADOS a esa OC, no a todo el proveedor.
    expect(espiaLineasOc).toHaveBeenCalledWith(3, 7);
  });

  it('V1-E7g: el proveedor que fija la OC se MUESTRA aunque no caiga en la página del combobox', async () => {
    // El caso real: la búsqueda server-side sólo trae 10 proveedores por página, y el que fijó la
    // orden casi nunca está entre ellos. Antes, con el `<select>` de 100, alcanzaba a salir casi
    // siempre; con el combobox, el nombre TIENE que viajar en el enlace o el campo se ve VACÍO
    // pese a traer proveedor —y el usuario cree que la pantalla perdió el dato—.
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
      rutaInicial: {
        pathname: '/inventarios/telas/entradas/nueva',
        // El id 77 NO está en el catálogo simulado: es justo el proveedor que no cae en la página.
        state: { idOrdenCompra: 7, idProveedor: 77, proveedor: 'Zurcidos Zacatecas' },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('entrada-proveedor-busqueda')).toHaveValue('Zurcidos Zacatecas');
    });
  });

  it('§Post-F9.15: el buscador de telas se acota al proveedor DUEÑO', async () => {
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });

    await elegirEnCombobox('entrada-proveedor', 'Textiles del Norte');
    // El editor de renglones recibe el proveedor: "no puedo meter una felpa alsatex en bloom".
    await waitFor(() => {
      expect(espiaProveedorTelas).toHaveBeenCalledWith(3);
    });
  });
  it('§Post-F9.22: el proveedor que NO factura pierde el camino del CFDI', async () => {
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });

    // Con el que SÍ factura, la pantalla ofrece leer el XML y capturar una factura.
    await elegirEnCombobox('entrada-proveedor', 'Textiles del Norte');
    expect(screen.getByTestId('entrada-leer-cfdi')).toBeInTheDocument();
    expect(screen.getByTestId('entrada-tipo')).toHaveValue('factura');

    // Con el informal desaparece el lector del XML, la opción "Factura" deja de existir y el
    // documento se corrige solo a remisión: no se le puede mandar al servidor algo que rechazará.
    await elegirEnCombobox('entrada-proveedor', 'Talleres Don Chuy');
    await waitFor(() => {
      expect(screen.queryByTestId('entrada-leer-cfdi')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('entrada-tipo')).toHaveValue('remision');
    expect(
      within(screen.getByTestId('entrada-tipo')).queryByRole('option', { name: 'Factura' }),
    ).toBeNull();
    // Y se dice POR QUÉ, con lo que sí va a pasar: su cuenta por pagar nace igual.
    expect(screen.getByTestId('entrada-proveedor-sin-factura')).toHaveTextContent(
      'cuenta por pagar',
    );
  });

  it('factura leída cuyo EMISOR no está en el catálogo: dice qué hacer y ofrece soltarla', async () => {
    // El callejón sin salida de la revisión del 11-ago: sin proveedor con ese RFC, guardar es
    // imposible con CUALQUIER proveedor, así que la pantalla no debe invitar a elegir uno a mano —
    // debe decir la ruta que sí existe y dejar soltar la factura sin perder lo capturado.
    leerCfdiMutate.mockImplementation(
      (_variables: unknown, opciones: { onSuccess: (datos: unknown) => void }) => {
        opciones.onSuccess({
          uuid: '22222222-2222-2222-2222-222222222222',
          numeroDocumento: 'B-77',
          fecha: '2026-08-06',
          emisorRfc: 'XXX010101AAA',
          emisorNombre: 'Telas Desconocidas',
          moneda: 'MXN',
          total: 100,
          idProveedor: null, // ninguno del catálogo tiene ese RFC
          proveedor: null,
          yaUsado: false,
          avisos: [],
          conceptos: [],
        });
      },
    );
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });

    await usuario.upload(
      screen.getByTestId('entrada-xml-archivo'),
      new File(['<cfdi/>'], 'factura.xml', { type: 'text/xml' }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('entrada-cfdi-sin-proveedor')).toHaveTextContent('XXX010101AAA');
    });
    // El selector NO se ofrece: elegir a mano siempre terminaría en 400.
    expect(screen.getByTestId('entrada-proveedor-busqueda')).toBeDisabled();

    // …y hay salida: soltar la factura devuelve la captura al camino sin CFDI.
    await usuario.click(screen.getByTestId('entrada-quitar-cfdi'));
    await waitFor(() => {
      expect(screen.queryByTestId('entrada-cfdi-sin-proveedor')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('entrada-proveedor-busqueda')).toBeEnabled();
    leerCfdiMutate.mockReset();
  });

  it('al EDITAR un borrador NO manda `uuidCfdi`: el sello de la factura no se toca desde aquí', async () => {
    // El borrador nació de un XML (trae su UUID sellado). Editarlo NO puede borrarlo: el cuerpo del
    // PUT ni siquiera lo lleva — el servidor conserva el sello y solo un XML nuevo lo reemplaza.
    parametrosRuta.valor = { id: '5' };
    useEntradaTelaMock.mockReturnValue({
      data: {
        id: 5,
        folio: 12,
        estatus: 'borrador',
        tipoDocumento: 'factura',
        numeroDocumento: 'A-1001',
        uuidCfdi: '11111111-1111-1111-1111-111111111111',
        totalCfdi: 920,
        idProveedor: 3,
        proveedor: 'Textiles del Norte',
        fecha: '2026-08-06',
        idAlmacen: 2,
        observaciones: null,
        avisos: [],
        lineas: [],
      },
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });

    await usuario.click(screen.getByTestId('agregar-renglon'));
    await usuario.click(screen.getByTestId('entrada-guardar'));

    expect(actualizarMutate).toHaveBeenCalledTimes(1);
    const argumentos = actualizarMutate.mock.calls[0]?.[0] as { id: number; cuerpo: object };
    expect(argumentos.id).toBe(5);
    expect(argumentos.cuerpo).not.toHaveProperty('uuidCfdi');
    expect(crearMutate).not.toHaveBeenCalled();
  });
});

/**
 * 🔴 **§Post-F9.159(a) — la pantalla que RECIBE tela exige la orden de compra.** Dos cosas que la
 * página tiene que sostener y que no se ven desde el componente de renglones:
 *  (1) que le PASE `exigirOrdenCompra` (si se olvida, el bloqueo no existe y nadie lo nota);
 *  (2) qué hace con un BORRADOR VIEJO —capturado cuando la vía suelta valía—: se puede abrir y
 *      cancelar, pero ya no guardar. Y se DICE, en vez de dejar que el servidor lo rechace después
 *      de teclear (REGLA 0-B: el dato viejo no se repara, se limpia).
 */
describe('CapturaEntradaTelaPagina · §Post-F9.159(a): no se recibe tela sin OC', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    actualizarMutate.mockReset();
    useEntradaTelaMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    parametrosRuta.valor = {};
  });

  it('le pasa `exigirOrdenCompra` al panel de renglones', () => {
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    expect(screen.getByTestId('espia-exige-oc')).toHaveTextContent('true');
  });

  it('🔴 un BORRADOR VIEJO con renglones sin OC no se puede guardar, y la pantalla dice por qué', async () => {
    parametrosRuta.valor = { id: '9' };
    useEntradaTelaMock.mockReturnValue({
      data: {
        id: 9,
        folio: 3,
        estatus: 'borrador',
        tipoDocumento: 'remision',
        numeroDocumento: 'R-VIEJA',
        uuidCfdi: null,
        totalCfdi: null,
        idProveedor: 3,
        proveedor: 'Textiles del Norte',
        fecha: '2026-08-06',
        idAlmacen: 2,
        observaciones: null,
        avisos: [],
        lineas: [
          {
            id: 1,
            idTela: 3,
            tela: 'Felpa Suiza',
            idTelaColor: 71,
            telaColor: 'Marino',
            nombreComplemento: null,
            cantidad: 100,
            cantidadComplemento: null,
            precioUnit: 90,
            precioUnitComplemento: null,
            loteProveedor: null,
            // Así se guardó: sin orden de compra. Es el dato REAL que hay hoy en `prueba`.
            idOrdenCompraLinea: null,
          },
        ],
      },
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });

    await waitFor(() => {
      expect(screen.getByTestId('entrada-renglones-sin-oc')).toBeInTheDocument();
    });
    expect(screen.getByTestId('entrada-renglones-sin-oc')).toHaveTextContent(
      'no se recibe tela que no se haya comprado',
    );
    // Y el botón está apagado: nada se manda al servidor.
    expect(screen.getByTestId('entrada-guardar')).toBeDisabled();
    await usuario.click(screen.getByTestId('entrada-guardar'));
    expect(actualizarMutate).not.toHaveBeenCalled();
  });

  it('CONTROL: con su renglón de OC el mismo borrador sí se guarda (el aviso no es permanente)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    await usuario.type(screen.getByTestId('entrada-numero'), 'R-2200');
    await elegirEnCombobox('entrada-proveedor', 'Textiles del Norte');
    await usuario.selectOptions(screen.getByTestId('entrada-almacen'), '2');
    await usuario.click(screen.getByTestId('agregar-renglon'));

    expect(screen.queryByTestId('entrada-renglones-sin-oc')).toBeNull();
    await usuario.click(screen.getByTestId('entrada-guardar'));
    expect(crearMutate).toHaveBeenCalledTimes(1);
  });
});

/**
 * 🔴🔴 **LOS DOS EJES NO SE PUEDEN COLAPSAR** (hallazgo del reviewer de la 0.078).
 *
 * `lineasOc` = lo que esta pantalla OFRECE capturar ahora · `estadoPendientesOc` = lo que el
 * PROVEEDOR tiene pendiente según la consulta. Por el camino del XML (§Post-F9.20) el primero sale
 * de los conceptos que CRUZARON, así que puede venir vacío con el proveedor teniendo órdenes
 * abiertas — y con un solo eje la pantalla acusaba de no haber comprado a quien sí había comprado.
 *
 * ⚠️ Estas pruebas ejercitan **al PRODUCTOR** (la derivación de la página), no un `[]` inyectado a
 * mano en el componente: ése era justo el agujero de la prueba anterior.
 */
describe('CapturaEntradaTelaPagina · §Post-F9.159(a): los dos ejes del diagnóstico', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    actualizarMutate.mockReset();
    leerCfdiMutate.mockReset();
    useEntradaTelaMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    parametrosRuta.valor = {};
    estadoConsultaOc.valor = 'hay';
    // El espía se limpia entre pruebas: aquí se mide CON QUÉ ALCANCE se pidió la consulta, y las
    // llamadas de la prueba anterior harían pasar la aserción sin que esta prueba lo demuestre.
    espiaLineasOc.mockClear();
    avisoToast.warning.mockClear();
    avisoToast.success.mockClear();
  });

  /** Lee un XML cuyos conceptos NO cruzaron con ningún renglón de OC (`sugerencia: null`). */
  function leerXmlSinCruce(): void {
    leerCfdiMutate.mockImplementation(
      (_variables: unknown, opciones: { onSuccess: (datos: unknown) => void }) => {
        opciones.onSuccess({
          uuid: '33333333-3333-3333-3333-333333333333',
          numeroDocumento: 'C-99',
          fecha: '2026-08-06',
          emisorRfc: 'TNO850101BBB',
          emisorNombre: 'Textiles del Norte',
          moneda: 'MXN',
          total: 100,
          idProveedor: 3,
          proveedor: 'Textiles del Norte',
          yaUsado: false,
          avisos: [],
          // Cruce fallido: `cruzarConceptos` no encontró a qué renglón ligarlos.
          conceptos: [
            {
              descripcion: 'MATERIAL X',
              cantidad: 10,
              valorUnitario: 5,
              importe: 50,
              sugerencia: null,
            },
          ],
        });
      },
    );
  }

  it('🔴 el XML no cruzó NADA pero el proveedor SÍ tiene pendientes: no se le acusa de no haber comprado', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    await elegirEnCombobox('entrada-proveedor', 'Textiles del Norte');
    leerXmlSinCruce();
    await usuario.upload(
      screen.getByTestId('entrada-xml-archivo'),
      new File(['<cfdi/>'], 'factura.xml', { type: 'text/xml' }),
    );

    // Lo OFRECIDO queda en 0 (ningún concepto cruzó)…
    await waitFor(() => {
      expect(screen.getByTestId('espia-ofrecidos')).toHaveTextContent('0');
    });
    // …pero el estado del PROVEEDOR sigue siendo 'hay'. Si los dos ejes se colapsaran, aquí
    // saldría 'ninguno' y la pantalla mandaría a levantar una OC que ya existe.
    expect(screen.getByTestId('espia-estado-oc')).toHaveTextContent('hay');
  });

  it('🔴 el toast del XML sin cruce respeta el ALCANCE del panel (desde cero vs. desde la OC)', async () => {
    // Mismo error de alcance, en el otro letrero: sin deep-link el panel enseña TODO lo del
    // proveedor, pero llegando desde una OC sólo enseña lo de ESA orden — mandar ahí a «lo que el
    // proveedor tenga pendiente» apuntaría a una lista que esta pantalla no muestra.
    const usuario = userEvent.setup();
    const subirXml = async () => {
      leerXmlSinCruce();
      await usuario.upload(
        screen.getByTestId('entrada-xml-archivo'),
        new File(['<cfdi/>'], 'factura.xml', { type: 'text/xml' }),
      );
    };

    // (1) Desde cero: el proveedor se elige a mano y el panel no está acotado.
    const desdeCero = renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    await elegirEnCombobox('entrada-proveedor', 'Textiles del Norte');
    await subirXml();
    await waitFor(() => {
      expect(avisoToast.warning).toHaveBeenCalledWith(
        expect.stringContaining('el proveedor tenga pendiente de recibir'),
        expect.anything(),
      );
    });
    desdeCero.unmount();
    avisoToast.warning.mockClear();

    // (2) Desde la OC: el panel va acotado, así que el letrero manda a ESA orden.
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
      rutaInicial: {
        pathname: '/inventarios/telas/entradas/nueva',
        state: { idOrdenCompra: 7, idProveedor: 3 },
      },
    });
    await subirXml();
    await waitFor(() => {
      expect(avisoToast.warning).toHaveBeenCalledWith(
        expect.stringContaining('esta orden de compra tenga pendiente de recibir'),
        expect.anything(),
      );
    });
    expect(avisoToast.warning).not.toHaveBeenCalledWith(
      expect.stringContaining('el proveedor tenga pendiente'),
      expect.anything(),
    );
  });

  it('🔴 si la consulta de pendientes FALLA, el estado es `error`, nunca `ninguno`', async () => {
    estadoConsultaOc.valor = 'error';
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    await elegirEnCombobox('entrada-proveedor', 'Textiles del Norte');

    await waitFor(() => {
      expect(screen.getByTestId('espia-estado-oc')).toHaveTextContent('error');
    });
    // En v5 el error deja `data` en undefined: leerlo como lista vacía sería decir "no hay" cuando
    // lo cierto es "no se sabe".
    expect(screen.getByTestId('espia-ofrecidos')).toHaveTextContent('0');
  });

  it('`ninguno` SÓLO cuando se preguntó por TODO el proveedor y la respuesta vino vacía', async () => {
    estadoConsultaOc.valor = 'vacio';
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    await elegirEnCombobox('entrada-proveedor', 'Textiles del Norte');

    await waitFor(() => {
      // ANCLADO: 'ninguno-en-esta-oc' CONTIENE 'ninguno', y son estados que dicen cosas opuestas.
      expect(screen.getByTestId('espia-estado-oc')).toHaveTextContent(/^ninguno$/);
    });
    // Y sin deep-link la consulta va SIN acotar: por eso su vacío sí cubre al proveedor entero.
    expect(espiaLineasOc).toHaveBeenCalledWith(3, undefined);
  });

  it('🔴 EL SEXTO CAMINO: llegando DESDE una OC la consulta va ACOTADA, y su vacío es de ESA orden', async () => {
    // El agujero que dejó la ronda anterior: los cinco estados agotaban el ESTATUS de la consulta
    // (respondió / falló / va en camino) pero no su ALCANCE. Con deep-link el backend filtra por
    // `idOrdenCompra`, así que `[]` dice «esta orden no tiene nada», jamás «este proveedor no
    // tiene nada» — que es lo único que `ninguno` autoriza a afirmar.
    estadoConsultaOc.valor = 'vacio';
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
      rutaInicial: {
        pathname: '/inventarios/telas/entradas/nueva',
        state: { idOrdenCompra: 7, idProveedor: 3 },
      },
    });

    await waitFor(() => {
      // La consulta se pidió ACOTADA: es el hecho del que sale todo lo demás.
      expect(espiaLineasOc).toHaveBeenCalledWith(3, 7);
    });
    await waitFor(() => {
      expect(screen.getByTestId('espia-estado-oc')).toHaveTextContent(/^ninguno-en-esta-oc$/);
    });
  });

  it('CONTROL: acotada pero CON pendientes sigue siendo `hay` (el subconjunto no miente)', async () => {
    // `hay` es el único de los cinco que sobrevive al acotamiento: si ESA orden tiene pendiente,
    // el proveedor también. Sin esta prueba, "arreglar" el alcance podría tumbarlo de más.
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
      rutaInicial: {
        pathname: '/inventarios/telas/entradas/nueva',
        state: { idOrdenCompra: 7, idProveedor: 3 },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('espia-estado-oc')).toHaveTextContent(/^hay$/);
    });
    expect(espiaLineasOc).toHaveBeenCalledWith(3, 7);
  });

  it('sin proveedor elegido no se le atribuye nada a nadie (`sin-proveedor`)', () => {
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    expect(screen.getByTestId('espia-estado-oc')).toHaveTextContent('sin-proveedor');
  });

  it('mientras la consulta va en camino, `consultando` (tampoco es "no hay")', async () => {
    estadoConsultaOc.valor = 'cargando';
    renderConProveedores(<CapturaEntradaTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    await elegirEnCombobox('entrada-proveedor', 'Textiles del Norte');

    await waitFor(() => {
      expect(screen.getByTestId('espia-estado-oc')).toHaveTextContent('consultando');
    });
  });
});
