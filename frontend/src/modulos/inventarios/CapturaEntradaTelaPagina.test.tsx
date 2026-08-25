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
vi.mock('@/api/compras-lineas-tela', () => ({
  useLineasTelaPendientes: (idProveedor: number | undefined, idOrdenCompra?: number) => {
    espiaLineasOc(idProveedor, idOrdenCompra);
    return {
      data:
        idProveedor === undefined
          ? undefined
          : [
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
            ],
      isPending: false,
      isError: false,
    };
  },
}));
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({
    data: { datos: [{ id: 2, nombre: 'Bodega Telas' }], total: 1 },
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
// `vi.hoisted`: el `vi.mock` se iza por encima de las declaraciones del módulo.
const { espiaProveedorTelas } = vi.hoisted(() => ({ espiaProveedorTelas: vi.fn() }));
vi.mock('./CapturaRenglonesTelaColor', () => ({
  CapturaRenglonesTelaColor: ({
    onChange,
    idProveedorTelas,
  }: {
    onChange: (renglones: unknown[]) => void;
    idProveedorTelas?: number;
  }) => (
    <>
      {espiaProveedorTelas(idProveedorTelas)}
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
