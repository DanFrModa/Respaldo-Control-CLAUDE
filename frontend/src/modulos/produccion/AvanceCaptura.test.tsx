import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden, WipOrden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

/**
 * Pruebas de la CAPTURA del avance de producción con las tres reglas que dictó Daniel el
 * 28-jul-2026:
 *   1. la ENTREGA a maquila arranca con el maquilero ya programado en la OP;
 *   2. el RECIBO solo ofrece maquileros a los que SÍ se les entregó (y el pendiente que se les
 *      teclea es el de ESE maquilero, no el del proceso entero);
 *   3. la etapa de CORTE ofrece el enlace para descargar la tela del inventario.
 * La capa de datos va simulada (sin red): lo que se prueba es la pantalla, no el API. La regla 2
 * la RE-VALIDA el servidor (`recibos.int.test.ts`) — aquí solo se comprueba la comodidad.
 */

const useOrden = vi.fn<() => unknown>();
const useWipOrden = vi.fn<() => unknown>();
const useProveedores = vi.fn<() => unknown>();
const navegar = vi.fn();

vi.mock('@/api/ordenes', () => ({ useOrden: () => useOrden() }));
vi.mock('@/api/wip', () => ({ CLAVE_WIP: ['wip'], useWipOrden: () => useWipOrden() }));
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => useProveedores(),
  useRolesProveedor: () => ({ data: [{ id: 9, codigo: 'maquila-costura', nombre: 'Costura' }] }),
}));
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({
    data: { datos: [{ id: 1, nombre: 'Primeras', tipo: 'PT', activo: true }] },
  }),
}));
vi.mock('@/api/tipos-proceso', () => ({
  useTiposProceso: () => ({
    data: {
      datos: [
        { id: 5, codigo: 'costura', nombre: 'Costura', generaEntradaPt: true, activo: true },
        { id: 6, codigo: 'estampado', nombre: 'Estampado', generaEntradaPt: false, activo: true },
      ],
    },
  }),
}));
vi.mock('@/api/etapas', () => ({
  CLAVE_ETAPAS: ['etapas'],
  useEtapasOrden: () => ({ data: { etapas: [] }, isPending: false }),
  useCrearCorte: () => ({ mutate: vi.fn(), isPending: false }),
  useCrearEnvio: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarCorte: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarEnvio: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/recibos', () => ({
  CLAVE_RECIBOS: ['recibos'],
  useCrearRecibo: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarRecibo: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/ordenes-centro', () => ({ CLAVE_ORDENES_CENTRO: ['centro'] }));
vi.mock('react-router-dom', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useNavigate: () => navegar,
}));

const { AvanceProduccion } = await import('./AvanceProduccion');

const PERMISOS = [
  'produccion.wip-ver',
  'produccion.corte',
  'produccion.envio',
  'produccion.recibo',
  'inventario-telas.mover',
] as const;

/** Orden con matriz de un color × una talla y el maquilero YA programado. */
function orden(idMaquilero: number | null, maquilero: string | null): Orden {
  return {
    id: 1,
    folio: 5424,
    codigoModelo: '62182',
    idModelo: 3,
    cliente: 'C&A',
    estado: 'capturada',
    idMaquilero,
    maquilero,
    lineas: [
      {
        idColor: 7,
        color: 'Rojo',
        tallas: [{ idTalla: 11, etiquetaTalla: 'CH', cantidad: 10 }],
      },
    ],
    referencias: [],
    totalPiezas: 10,
  } as unknown as Orden;
}

/** WIP con 10 cortadas y lo enviado repartido entre maquileros (id `null` = migrado sin tercero). */
function wip(
  porMaquilero: {
    idMaquilero: number | null;
    maquilero: string;
    pendiente: number;
    /** Celdas explícitas; por default, una sola celda con el pendiente. */
    celdas?: { cantidad: number }[];
  }[],
): WipOrden {
  const celda = { idColor: 7, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH' };
  return {
    idOrden: 1,
    folio: 5424,
    estado: 'capturada',
    idModelo: 3,
    codigoModelo: '62182',
    idCliente: 4,
    cliente: 'C&A',
    pedido: 10,
    cortado: 10,
    enviado: 10,
    recibido: 0,
    recibidoCostura: 0,
    entregado: 0,
    porEntregar: 0,
    porCortar: [],
    cortadoPorEnviar: [],
    porRecibir: [
      {
        idTipoProceso: 5,
        tipoProceso: 'Costura',
        codigoProceso: 'costura',
        generaEntradaPt: true,
        celdas: [{ ...celda, cantidad: 10 }],
        totalPendiente: 10,
        porMaquilero: porMaquilero.map((m) => ({
          idMaquilero: m.idMaquilero,
          maquilero: m.maquilero,
          celdas: (m.celdas ?? [{ cantidad: m.pendiente }]).map((c) => ({
            ...celda,
            cantidad: c.cantidad,
          })),
          totalPendiente: m.pendiente,
        })),
      },
    ],
    entregadoCeldas: [],
  } as unknown as WipOrden;
}

function pintar(): void {
  renderConProveedores(<AvanceProduccion idOrden={1} alCerrar={vi.fn()} />, {
    sesion: estadoSesionDePrueba([...PERMISOS]),
  });
}

/** Abre la etapa indicada del stepper (por su clave) y su formulario de captura. */
async function abrirCaptura(
  usuario: ReturnType<typeof userEvent.setup>,
  clave: string,
): Promise<void> {
  await usuario.click(screen.getByTestId(`avance-stepper-${clave}`));
  await usuario.click(screen.getByTestId('avance-abrir-captura'));
}

beforeEach(() => {
  navegar.mockReset();
  useOrden.mockReturnValue({
    data: orden(77, 'Maquila del Norte'),
    isPending: false,
    isError: false,
    error: null,
  });
  useWipOrden.mockReturnValue({
    data: wip([
      { idMaquilero: 77, maquilero: 'Maquila del Norte', pendiente: 6 },
      { idMaquilero: 88, maquilero: 'Otra Maquila', pendiente: 4 },
    ]),
    isPending: false,
  });
  useProveedores.mockReset();
  useProveedores.mockReturnValue({
    data: { datos: [{ id: 99, nombre: 'Maquila del Sur' }] },
    isFetching: false,
  });
});

describe('Captura del avance · entrega a maquila', () => {
  it('arranca con el maquilero YA PROGRAMADO en la OP', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-maquila');

    // El asignado NO está en la página de proveedores del catálogo (que trae "Maquila del Sur"):
    // aun así el campo lo pinta, porque el padre pasa su etiqueta.
    await waitFor(() => {
      expect(screen.getByTestId('avance-proveedor-input')).toHaveValue('Maquila del Norte');
    });
  });

  it('al elegir OTRO maquilero el campo conserva el elegido (no lo pisa el de la OP)', async () => {
    // Se reproduce el camino REAL: con >100 maquileros el typeahead va al servidor, así que la
    // página SOLO trae a "Maquila del Sur" mientras se le busca; al elegirlo, el combobox resetea
    // la búsqueda y la página vuelve SIN él. Ahí es donde la etiqueta fija de la OP le pisaba el
    // nombre y el campo terminaba mostrando un maquilero distinto del que se iba a guardar.
    let paginaCatalogo: { id: number; nombre: string }[] = [{ id: 55, nombre: 'Maquila Centro' }];
    useProveedores.mockImplementation(() => ({
      data: { datos: paginaCatalogo },
      isFetching: false,
    }));

    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-maquila');
    await waitFor(() => {
      expect(screen.getByTestId('avance-proveedor-input')).toHaveValue('Maquila del Norte');
    });

    // Se teclea la búsqueda: la página del servidor ahora sí trae al del sur.
    paginaCatalogo = [{ id: 99, nombre: 'Maquila del Sur' }];
    await usuario.clear(screen.getByTestId('avance-proveedor-input'));
    await usuario.type(screen.getByTestId('avance-proveedor-input'), 'sur');
    const opcionSur = await screen.findByText('Maquila del Sur');

    // Al elegir, el combobox resetea la búsqueda y el typeahead vuelve a consultar: la página que
    // llega YA NO trae al elegido (es lo que pasa con >100 maquileros). Se prepara ANTES del clic
    // para que ese re-render del padre ocurra de verdad.
    paginaCatalogo = [{ id: 55, nombre: 'Maquila Centro' }];
    await usuario.click(opcionSur);
    // Y se SALE del campo, que es cuando el combobox re-sincroniza el texto con la etiqueta de la
    // selección: ahí es donde la etiqueta fija de la OP pisaba el nombre elegido.
    await usuario.tab();
    await waitFor(() => {
      expect(screen.getByTestId('avance-proveedor-input')).toHaveValue('Maquila del Sur');
    });
  });

  it('sin maquilero programado el campo arranca VACÍO (es un default, no un invento)', async () => {
    useOrden.mockReturnValue({
      data: orden(null, null),
      isPending: false,
      isError: false,
      error: null,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'entrega-maquila');

    expect(screen.getByTestId('avance-proveedor-input')).toHaveValue('');
  });
});

describe('Captura del avance · recibo de maquila', () => {
  it('solo ofrece a los maquileros con entrega viva, con lo que les falta devolver', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    // El campo arranca vacío (no hereda el maquilero de la OP: aquí se elige a quién se le recibe).
    expect(screen.getByTestId('avance-proveedor-input')).toHaveValue('');

    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    // Los dos que recibieron corte, con su pendiente…
    expect(await screen.findByText('Maquila del Norte')).toBeInTheDocument();
    expect(screen.getByText('Otra Maquila')).toBeInTheDocument();
    expect(screen.getByText('6 pza(s) por recibirle')).toBeInTheDocument();
    expect(screen.getByText('4 pza(s) por recibirle')).toBeInTheDocument();
    // …y NADIE del catálogo general: a "Maquila del Sur" no se le entregó nada de esta orden.
    expect(screen.queryByText('Maquila del Sur')).not.toBeInTheDocument();
  });

  // La otra mitad de la regla: lo que se TECLEA se topa contra el pendiente de ESE maquilero, no
  // contra el del proceso entero (el reviewer probó por mutación que esto no estaba cubierto).
  it('la matriz se topa contra el pendiente del maquilero ELEGIDO, no del proceso', async () => {
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    // Sin maquilero elegido no hay referencia: no se ofrece un tope que no aplica a nadie.
    expect(screen.queryByTestId('avance-matriz-hint')).not.toBeInTheDocument();

    // Otra Maquila tiene 4 de las 10 del proceso.
    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    await usuario.click(await screen.findByText('Otra Maquila'));
    await waitFor(() => {
      expect(screen.getByTestId('avance-matriz-hint')).toHaveTextContent('de 4');
    });

    // Y al cambiar de maquilero, el tope cambia con él (Norte tiene 6). Se borra el campo para que
    // el combobox suelte la selección y vuelva a ofrecer la lista completa.
    await usuario.clear(screen.getByTestId('avance-proveedor-input'));
    await usuario.type(screen.getByTestId('avance-proveedor-input'), 'norte');
    await usuario.click(await screen.findByText('Maquila del Norte'));
    await waitFor(() => {
      expect(screen.getByTestId('avance-matriz-hint')).toHaveTextContent('de 6');
    });
  });

  it('el maquilero que ya devolvió todo no se ofrece (no hay qué recibirle)', async () => {
    useWipOrden.mockReturnValue({
      data: wip([
        { idMaquilero: 77, maquilero: 'Maquila del Norte', pendiente: 10 },
        { idMaquilero: 88, maquilero: 'Otra Maquila', pendiente: 0 },
      ]),
      isPending: false,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    expect(await screen.findByText('Maquila del Norte')).toBeInTheDocument();
    expect(screen.queryByText('Otra Maquila')).not.toBeInTheDocument();
  });
});

describe('Captura del avance · casos del histórico migrado', () => {
  it('un maquilero con total 0 pero CELDAS pendientes SÍ se ofrece', async () => {
    // +5 en una talla y −5 en otra (recibo capturado en la talla equivocada en el Access): el
    // total da 0, pero el servidor sí aceptaría recibirle esas 5.
    useWipOrden.mockReturnValue({
      data: wip([
        {
          idMaquilero: 88,
          maquilero: 'Otra Maquila',
          pendiente: 0,
          celdas: [{ cantidad: 5 }, { cantidad: -5 }],
        },
      ]),
      isPending: false,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    await usuario.click(screen.getByTestId('avance-proveedor-input'));
    expect(await screen.findByText('Otra Maquila')).toBeInTheDocument();
  });

  it('una entrega migrada SIN maquilero se DICE, no se esconde', async () => {
    useWipOrden.mockReturnValue({
      data: wip([{ idMaquilero: null, maquilero: 'Sin asignar', pendiente: 10 }]),
      isPending: false,
    });
    const usuario = userEvent.setup();
    pintar();
    await abrirCaptura(usuario, 'recibo-maquila');

    // No hay a quién recibirle…
    expect(screen.getByTestId('avance-proveedor-input')).toHaveAttribute(
      'placeholder',
      'Nadie tiene piezas por devolver',
    );
    // …pero el aviso explica POR QUÉ y qué hay que corregir (antes se negaba que existiera).
    expect(screen.getByTestId('avance-sin-maquilero')).toHaveTextContent(
      /10 pza\(s\).*SIN maquilero/s,
    );
  });
});

describe('Captura del avance · descargar tela', () => {
  it('la etapa de CORTE lleva a la salida de tela con la orden puesta', async () => {
    const usuario = userEvent.setup();
    pintar();

    await usuario.click(screen.getByTestId('avance-descargar-tela'));
    expect(navegar).toHaveBeenCalledWith('/inventarios/telas/salida-orden', {
      state: { idOrden: 1 },
    });
  });

  it('con captura ABIERTA pregunta antes de salir (y no navega si se cancela)', async () => {
    const usuario = userEvent.setup();
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      pintar();
      await abrirCaptura(usuario, 'corte');

      await usuario.click(screen.getByTestId('avance-descargar-tela'));
      expect(confirmar).toHaveBeenCalled();
      expect(navegar).not.toHaveBeenCalled();

      // Con el "sí", ahora navega.
      confirmar.mockReturnValue(true);
      await usuario.click(screen.getByTestId('avance-descargar-tela'));
      expect(navegar).toHaveBeenCalledWith('/inventarios/telas/salida-orden', {
        state: { idOrden: 1 },
      });
    } finally {
      confirmar.mockRestore();
    }
  });

  it('con el CORTADOR elegido, la descarga se lleva su id (§Post-F9.13)', async () => {
    const usuario = userEvent.setup();
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      pintar();
      await abrirCaptura(usuario, 'corte');

      // Se elige el cortador en la captura (el corte arranca SIN proveedor: no hay default).
      await usuario.type(screen.getByTestId('avance-proveedor-input'), 'sur');
      await usuario.click(await screen.findByText('Maquila del Sur'));

      await usuario.click(screen.getByTestId('avance-descargar-tela'));
      expect(navegar).toHaveBeenCalledWith('/inventarios/telas/salida-orden', {
        state: { idOrden: 1, idCortador: 99 },
      });
    } finally {
      confirmar.mockRestore();
    }
  });

  it('"Mandar tela al cortador" aparece SOLO con cortador elegido y lleva su id', async () => {
    const usuario = userEvent.setup();
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      pintar();
      // Sin captura abierta (y por tanto sin cortador) el atajo no existe.
      expect(screen.queryByTestId('avance-traspasar-tela')).not.toBeInTheDocument();

      await abrirCaptura(usuario, 'corte');
      await usuario.type(screen.getByTestId('avance-proveedor-input'), 'sur');
      await usuario.click(await screen.findByText('Maquila del Sur'));

      await usuario.click(screen.getByTestId('avance-traspasar-tela'));
      expect(navegar).toHaveBeenCalledWith('/inventarios/telas/traspaso', {
        state: { idCortador: 99 },
      });
    } finally {
      confirmar.mockRestore();
    }
  });

  it('el enlace NO aparece en las otras etapas', async () => {
    const usuario = userEvent.setup();
    pintar();
    await usuario.click(screen.getByTestId('avance-stepper-entrega-maquila'));
    expect(screen.queryByTestId('avance-descargar-tela')).not.toBeInTheDocument();
  });

  it('el enlace NO aparece sin permiso para mover inventario de telas', () => {
    renderConProveedores(<AvanceProduccion idOrden={1} alCerrar={vi.fn()} />, {
      sesion: estadoSesionDePrueba(['produccion.wip-ver', 'produccion.corte']),
    });
    expect(screen.queryByTestId('avance-descargar-tela')).not.toBeInTheDocument();
    // …y la captura de corte sigue estando (no se escondió de más).
    expect(screen.getByTestId('avance-abrir-captura')).toBeInTheDocument();
  });
});
