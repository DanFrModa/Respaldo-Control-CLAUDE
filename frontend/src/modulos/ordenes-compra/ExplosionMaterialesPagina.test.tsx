import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ExplosionMaterialesPagina } from './ExplosionMaterialesPagina';

const useExplosionMock = vi.fn();
const useGenerarOcMock = vi.fn();
const useConsultaOrdenesMock = vi.fn();
const mutateMock = vi.fn();
const imprimirExplosionMock = vi.fn();
// ⭐ V1-E3q (§Post-F9.85/.86): la REVISIÓN PREVIA y la precarga por pedido interno.
const usePrevioCompraMock = vi.fn();
const previoMutateMock = vi.fn();
const useOrdenesDelPedidoMock = vi.fn();
// ⭐ V1-E3m (§Post-F9.82): asignar/quitar el proveedor de un material EN ESTA ORDEN.
const useAsignarProveedorMock = vi.fn();
const asignarMutateMock = vi.fn();

const useColoresDeTelaMock = vi.fn((_id: unknown) => ({ data: undefined, isPending: false }));
vi.mock('@/api/mrp', () => ({
  useExplosion: (ids: unknown) => useExplosionMock(ids) as unknown,
  useOrdenesDelPedido: (id: unknown) => useOrdenesDelPedidoMock(id) as unknown,
  usePrevioCompra: () => usePrevioCompraMock() as unknown,
  useGenerarOc: () => useGenerarOcMock() as unknown,
  useAsignarProveedor: () => useAsignarProveedorMock() as unknown,
  imprimirExplosion: (id: number) => imprimirExplosionMock(id) as unknown,
  // ⭐⭐ V1-E3u (§Post-F9.89): el diálogo «de qué color se compra la tela» cuelga de esta pantalla.
  // Se monta siempre (cerrado), así que sus hooks tienen que existir en el mock aunque no se usen.
  // ⭐ V1-E3u/D7: se ESPÍA el id que recibe. El diálogo pide los colores de UNA orden, así que este
  // argumento es la prueba de a qué orden se aterrizó — y no se puede falsear leyendo la pantalla
  // (el texto del botón también dice el folio, y una aserción por texto pasaría sin abrir nada).
  useColoresDeTela: (id: unknown) => useColoresDeTelaMock(id) as unknown,
  useAsignarColorTela: () => ({ mutate: vi.fn(), isPending: false }) as unknown,
  useFijarPrecioColor: () => ({ mutate: vi.fn(), isPending: false }) as unknown,
}));
vi.mock('@/api/ordenes-consulta', () => ({
  useConsultaOrdenes: () => useConsultaOrdenesMock() as unknown,
}));
// El catálogo de direcciones de entrega decide si la OC se puede generar (§Post-F9.18): sin
// dirección el dominio la RECHAZA, así que la pantalla tiene que decirlo antes de intentarlo.
const useDireccionesMock = vi.fn();
vi.mock('@/api/direcciones-entrega', () => ({
  useDireccionesEntregaActivas: () => useDireccionesMock() as unknown,
}));
// El combobox de proveedor busca en el SERVIDOR; aquí se sustituye por un botón que elige uno fijo,
// para poder ejercitar el flujo de «asignar proveedor» sin montar la búsqueda entera.
vi.mock('@/modulos/cxp/SelectorProveedor', () => ({
  SelectorProveedor: ({
    alSeleccionar,
  }: {
    alSeleccionar: (proveedor: { id: number; nombre: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="exp-selector-proveedor-stub"
      onClick={() => alSeleccionar({ id: 33, nombre: 'Telas del Norte' })}
    >
      Elegir proveedor
    </button>
  ),
}));

/** Explosión de prueba: un botón comprable (con proveedor) + felpa sin proveedor + genérico cubierto. */
function explosionDePrueba() {
  return {
    // ⭐ V1-E3q (§Post-F9.86): la explosión es de un CONJUNTO de OP.
    ordenes: [
      {
        idOrden: 50,
        folio: 7,
        idModelo: 9,
        modelo: 'A-100',
        totalPiezas: 30,
        idPedido: 300,
        folioPedido: 1515,
        fechaEntrega: '2026-09-30',
      },
    ],
    idOrden: 50,
    folioOrden: 7,
    idModelo: 9,
    modelo: 'A-100',
    totalPiezas: 30,
    huboCambios: false,
    regenerado: false,
    avisos: [],
    // V1-E3d: la explosión trae la desalineación de la receta congelada vs. el BOM vivo.
    desalineacion: { hayCambios: false, conOrdenCompra: false, critico: false, cambios: [] },
    // V1-E3h: y lo que quedó fuera por no estar liberado (vacío = no falta firmar nada).
    pendientesLiberar: [],
    // ⭐⭐ V1-E3u (§Post-F9.89): telas a las que falta decirles de qué color se compran.
    pendientesColor: [],
    grupos: [
      {
        idProveedor: 11,
        proveedor: 'Avíos Baratos',
        renglones: [
          {
            id: 1,
            tipo: 'avio',
            idTela: null,
            idTelaColor: null,
            telaColor: null,
            idAvio: 3,
            material: 'BOT-01 — Botón',
            cantidadRequerida: 180,
            unidad: 'pza',
            esGenerico: false,
            estadoGenerico: 'no-aplica',
            existenciaStock: 0,
            cantidadAComprar: 180,
            idProveedorSugerido: 11,
            proveedorSugerido: 'Avíos Baratos',
            precioSugerido: 2,
            origenProveedor: 'habitual',
            proveedorSugeridoInactivo: false,
            diff: 'sin-cambio',
            cambiosReceta: [],
            cantidadEnOc: 0,
            cantidadPendiente: 180,
            idsRequerimiento: [1],
            porOrden: [
              {
                idRequerimiento: 1,
                idOrden: 50,
                folioOrden: 7,
                cantidadRequerida: 180,
                cantidadAComprar: 180,
                cantidadEnOc: 0,
                cantidadPendiente: 180,
                precioSugerido: 2,
              },
            ],
          },
        ],
      },
      {
        idProveedor: null,
        proveedor: 'Sin proveedor sugerido',
        renglones: [
          {
            id: 2,
            tipo: 'tela',
            idTela: 4,
            idTelaColor: null,
            telaColor: null,
            idAvio: null,
            material: 'Felpa',
            cantidadRequerida: 45,
            unidad: 'm',
            esGenerico: false,
            estadoGenerico: 'no-aplica',
            existenciaStock: 0,
            cantidadAComprar: 45,
            idProveedorSugerido: null,
            proveedorSugerido: null,
            precioSugerido: null,
            origenProveedor: 'sin-proveedor',
            proveedorSugeridoInactivo: false,
            diff: 'sin-cambio',
            cambiosReceta: [],
            cantidadEnOc: 0,
            cantidadPendiente: 45,
            idsRequerimiento: [2],
            porOrden: [
              {
                idRequerimiento: 2,
                idOrden: 50,
                folioOrden: 7,
                cantidadRequerida: 45,
                cantidadAComprar: 45,
                cantidadEnOc: 0,
                cantidadPendiente: 45,
                precioSugerido: null,
              },
            ],
          },
          {
            id: 3,
            tipo: 'avio',
            idTela: null,
            idTelaColor: null,
            telaColor: null,
            idAvio: 5,
            material: 'HIL-01 — Hilo',
            cantidadRequerida: 60,
            unidad: 'm',
            esGenerico: true,
            estadoGenerico: 'cubierto-por-stock',
            existenciaStock: 100,
            cantidadAComprar: 0,
            idProveedorSugerido: null,
            proveedorSugerido: null,
            precioSugerido: null,
            origenProveedor: 'sin-proveedor',
            proveedorSugeridoInactivo: false,
            diff: 'sin-cambio',
            cambiosReceta: [],
            cantidadEnOc: 0,
            cantidadPendiente: 0,
            idsRequerimiento: [3],
            porOrden: [
              {
                idRequerimiento: 3,
                idOrden: 50,
                folioOrden: 7,
                cantidadRequerida: 60,
                cantidadAComprar: 0,
                cantidadEnOc: 0,
                cantidadPendiente: 0,
                precioSugerido: null,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('ExplosionMaterialesPagina (F4-E4, R3)', () => {
  beforeEach(() => {
    useExplosionMock.mockReset();
    useGenerarOcMock.mockReset();
    useConsultaOrdenesMock.mockReset();
    useDireccionesMock.mockReset();
    mutateMock.mockReset();
    imprimirExplosionMock.mockReset();
    useAsignarProveedorMock.mockReset();
    asignarMutateMock.mockReset();
    usePrevioCompraMock.mockReset();
    previoMutateMock.mockReset();
    useOrdenesDelPedidoMock.mockReset();
    // Por defecto la OP no tiene hermanas que precargar (la precarga tiene su propio bloque).
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useAsignarProveedorMock.mockReturnValue({
      mutate: asignarMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });

    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      isError: false,
    });
    // Caso normal: hay catálogo y una dirección FAVORITA (la que el servidor usaría por default).
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    useGenerarOcMock.mockReturnValue({
      mutate: mutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
  });

  it('al elegir una orden, muestra los materiales agrupados por proveedor y el neteo de genéricos', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });

    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    // Pide la explosión de la orden elegida (id 50).
    expect(useExplosionMock).toHaveBeenCalledWith([50]);
    // Dos grupos (un proveedor + "sin proveedor").
    expect(screen.getAllByTestId('exp-grupo')).toHaveLength(2);
    expect(screen.getByText('BOT-01 — Botón')).toBeInTheDocument();
    // El genérico cubierto por stock se marca.
    expect(screen.getByText('Cubierto por stock')).toBeInTheDocument();
  });

  /**
   * ⭐⭐ V1-E3q (§Post-F9.85) — el botón YA NO GENERA de un clic: pide la REVISIÓN PREVIA. Daniel:
   * *"al darle «generar OC desde la explosión», te mande a una pantalla previa… una revisión previa
   * es indispensable"*. Si alguien devolviera este botón a `generar.mutate`, esta prueba se pone
   * roja: `mutateMock` NO debe haberse llamado.
   */
  it('«Revisar y generar OC» pide el PLAN al servidor y NO crea nada todavía', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    // Revisa TODO lo pendiente (sin marcar nada → idsRequerimiento vacío).
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    expect(previoMutateMock).toHaveBeenCalledOnce();
    // 🔴 Y NADA se generó: el clic que Daniel daba ahora abre la revisión, no la compra.
    expect(mutateMock).not.toHaveBeenCalled();
    const [cuerpo, opciones] = previoMutateMock.mock.calls[0] as [
      Record<string, unknown>,
      { onSuccess?: unknown },
    ];
    // La dirección FAVORITA viaja explícita: el servidor no tiene que adivinarla. Y las OP van en
    // el cuerpo (§Post-F9.86), no en la URL.
    expect(cuerpo).toEqual({ idsOrden: [50], idsRequerimiento: [], idDireccionEntrega: 7 });
    expect(typeof opciones.onSuccess).toBe('function');
  });

  it('el checkbox de un material sin proveedor (felpa) está deshabilitado (no comprable)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    const checks = screen.getAllByTestId('exp-renglon-check');
    // El primero (botón, comprable) habilitado; la felpa (sin proveedor) deshabilitada.
    expect(checks[0]).not.toBeDisabled();
    expect(checks[1]).toBeDisabled();
  });

  it('marca el aviso cuando el BOM cambió desde la última explosión', async () => {
    useExplosionMock.mockReturnValue({
      data: { ...explosionDePrueba(), huboCambios: true, regenerado: true },
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    expect(screen.getByTestId('exp-aviso-cambios')).toBeInTheDocument();
  });

  it('muestra los avisos del enganche (F8-E6) cuando la explosión los reporta', async () => {
    useExplosionMock.mockReturnValue({
      data: {
        ...explosionDePrueba(),
        avisos: ['Tela "Felpa" amarrada multi-color con precios distintos: se usó el precio base.'],
      },
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    expect(screen.getByTestId('exp-avisos')).toBeInTheDocument();
    expect(screen.getByTestId('exp-aviso')).toHaveTextContent('amarrada multi-color');
  });

  /**
   * §Post-F9.16 — el catálogo de direcciones nace VACÍO y sin dirección el dominio rechaza la
   * generación. Antes el botón se veía habilitado y el error llegaba del servidor, sin decir a
   * dónde ir: ahora se explica y se enlaza el catálogo.
   */
  it('SIN direcciones de entrega explica por qué no se puede y enlaza el catálogo', async () => {
    useDireccionesMock.mockReturnValue({ data: { datos: [] }, isPending: false });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    const aviso = screen.getByTestId('exp-falta-direccion');
    expect(aviso).toHaveTextContent('catálogo de direcciones de entrega está vacío');
    expect(screen.getByRole('link', { name: /catálogo de direcciones/i })).toHaveAttribute(
      'href',
      '/catalogos/direcciones-entrega',
    );
    expect(screen.getByTestId('exp-generar-oc')).toBeDisabled();
  });

  it('CON direcciones pero ninguna favorita, dice que hay que elegir una', async () => {
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: false }] },
      isPending: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    expect(screen.getByTestId('exp-falta-direccion')).toHaveTextContent('favorita');

    // Al elegirla en el selector, el aviso desaparece y ya se puede generar.
    await usuario.selectOptions(screen.getByTestId('exp-direccion-entrega'), '7');
    expect(screen.queryByTestId('exp-falta-direccion')).not.toBeInTheDocument();
    expect(screen.getByTestId('exp-generar-oc')).not.toBeDisabled();
  });

  /**
   * Si el catálogo NO se pudo consultar, decir "está vacío" sería mentir con el catálogo lleno (el
   * usuario abre el enlace, ve sus 5 direcciones y vuelve bloqueado sin causa). Se avisa del ERROR
   * y NO se bloquea: por una lectura fallida no se le cierra la puerta — decide el servidor al
   * guardar.
   */
  it('si FALLA la consulta del catálogo: lo dice tal cual y NO bloquea', async () => {
    const refetchDirecciones = vi.fn();
    useDireccionesMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: refetchDirecciones,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    const aviso = screen.getByTestId('exp-falta-direccion');
    expect(aviso).toHaveTextContent('No se pudo consultar el catálogo');
    // NO dice "está vacío" (sería falso) ni bloquea por un error de lectura.
    expect(aviso).not.toHaveTextContent('está vacío');
    expect(screen.getByTestId('exp-generar-oc')).not.toBeDisabled();
    await usuario.click(screen.getByTestId('exp-reintentar-direcciones'));
    expect(refetchDirecciones).toHaveBeenCalled();
  });

  /**
   * ORDEN DE LAS RAMAS: un refetch que falla NO borra los datos previos de la cache. Si el usuario
   * ya eligió su dirección, decirle "no sabemos cuál usar" sería falso — se pregunta primero si ya
   * hay dirección y solo después si hubo error.
   */
  it('con la dirección YA ELEGIDA, un refetch fallido no inventa que falta', async () => {
    // Datos previos en cache + isError (lo que deja React Query tras un refetch fallido).
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: false }] },
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    // Sin elegir nada (y sin favorita) sí avisa del error.
    expect(screen.getByTestId('exp-falta-direccion')).toBeInTheDocument();

    await usuario.selectOptions(screen.getByTestId('exp-direccion-entrega'), '7');
    expect(screen.queryByTestId('exp-falta-direccion')).not.toBeInTheDocument();
    expect(screen.getByTestId('exp-generar-oc')).not.toBeDisabled();
  });

  it('con una dirección FAVORITA no estorba con avisos', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    expect(screen.queryByTestId('exp-falta-direccion')).not.toBeInTheDocument();
  });
  // ── ⭐ PRIMER AVISO de §Post-F9.43(d): la desalineación EN EL LUGAR DE LA DECISIÓN (V1-E3d) ──
  //
  // La ficha es explícita: *"sin OC todavía → rojo en el lugar de la decisión: al explotar el MRP /
  // generar la OC, los renglones que cambiaron salen marcados diciendo QUÉ cambió"*. Aquí es donde
  // se está a punto de gastar; que el aviso solo viviera en el detalle de la orden dejaba a esta
  // pantalla —la que decide— muda.

  it('sin desalineación no estorba con el aviso', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    expect(screen.queryByTestId('exp-desalineacion')).not.toBeInTheDocument();
  });

  it('el modelo cambió: lo dice AQUÍ, con QUÉ cambió, y marca el renglón afectado', async () => {
    const base = explosionDePrueba();
    useExplosionMock.mockReturnValue({
      data: {
        ...base,
        desalineacion: {
          hayCambios: true,
          conOrdenCompra: false,
          critico: false,
          cambios: [
            {
              tipo: 'avio',
              idRenglon: 9,
              material: 'BOT-01 — Botón',
              que: 'consumo',
              detalle: 'La cantidad de "BOT-01 — Botón" pasó de 6 a 8 en el modelo.',
            },
          ],
        },
        grupos: base.grupos.map((g) => ({
          ...g,
          renglones: g.renglones.map((r) =>
            r.id === 1 ? { ...r, cambiosReceta: ['consumo'] } : r,
          ),
        })),
      },
      isPending: false,
      isError: false,
    });

    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    const aviso = screen.getByTestId('exp-desalineacion');
    expect(aviso).toHaveTextContent('pasó de 6 a 8 en el modelo');
    // …y el renglón concreto queda marcado, que es a lo que apunta el aviso.
    expect(screen.getByTestId('exp-renglon-desalineado')).toHaveTextContent('El modelo cambió');
  });

  it('⭐ un movimiento del PRECIO DE COMPRA se informa SIN rojo y con su causa real', async () => {
    // El escenario del reviewer: el comprador ajusta su propia OC y la autoriza. Eso mueve el precio
    // de la receta del modelo (desde V1-E3e ES la última compra real), pero NADIE tocó el modelo.
    const base = explosionDePrueba();
    useExplosionMock.mockReturnValue({
      data: {
        ...base,
        desalineacion: {
          hayCambios: true,
          conOrdenCompra: true,
          critico: false, // ← lo decide el servidor: sin esto sería rojo permanente
          cambios: [
            {
              tipo: 'avio',
              idRenglon: 9,
              material: 'BOT-01 — Botón',
              que: 'precio-mercado',
              detalle:
                'La última COMPRA REAL de "BOT-01 — Botón" es de $2.20 y esta orden congeló $2.00. El modelo no cambió: cambió el precio de compra.',
            },
          ],
        },
        grupos: base.grupos.map((g) => ({
          ...g,
          renglones: g.renglones.map((r) =>
            r.id === 1 ? { ...r, cambiosReceta: ['precio-mercado'] } : r,
          ),
        })),
      },
      isPending: false,
      isError: false,
    });

    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    const aviso = screen.getByTestId('exp-desalineacion');
    expect(aviso).toHaveTextContent('El modelo no cambió');
    expect(aviso).not.toHaveTextContent('ya tiene compras'); // NO es el cartel rojo
    expect(screen.getByTestId('exp-renglon-desalineado')).toHaveTextContent(
      'Cambió el precio de compra',
    );
  });
});

/**
 * ⭐ V1-E3h (§Post-F9.72) — LO QUE EL COMPRADOR TIENE QUE VER. Requisito TEXTUAL de Daniel: que se
 * vea *"transparentemente qué le falta de liberar"*. No un "no se puede": **qué** y **cuánto**, y el
 * camino a donde se resuelve (antes la explosión frenaba en seco sin decir siquiera a qué pantalla
 * ir — el hueco de navegación que la decisión nombra aparte).
 */
describe('ExplosionMaterialesPagina · lo que falta liberar (V1-E3h)', () => {
  /** Explosión con un material fuera por no estar firmado. */
  function conPendiente() {
    return {
      ...explosionDePrueba(),
      pendientesLiberar: [
        {
          tipo: 'avio' as const,
          idRenglon: 9,
          idOrden: 50,
          folioOrden: 7,
          idTela: null,
          idTelaColor: null,
          telaColor: null,
          idAvio: 21,
          material: 'CIE-53 — Cierre 53 cm',
          consumoPorPrenda: 1,
          unidad: 'pza',
        },
      ],
    };
  }

  async function abrir(permisos: string[]): Promise<void> {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(permisos as never),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
  }

  it('lista lo pendiente con NOMBRE y CANTIDAD (no un "no se puede")', async () => {
    useExplosionMock.mockReturnValue({ data: conPendiente(), isPending: false, isError: false });
    await abrir(['compras.ver']);

    const aviso = screen.getByTestId('exp-pendientes-liberar');
    expect(aviso).toHaveTextContent('CIE-53 — Cierre 53 cm');
    expect(aviso).toHaveTextContent('1 pza por prenda');
    // Y la explosión SIGUE mostrando lo que sí se puede comprar.
    expect(screen.getAllByTestId('exp-grupo').length).toBeGreaterThan(0);
  });

  it('sin nada pendiente, el aviso NI SE PINTA', async () => {
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      isError: false,
    });
    await abrir(['compras.ver']);

    expect(screen.queryByTestId('exp-pendientes-liberar')).toBeNull();
  });

  it('⭐ el aviso LLEVA a donde se libera, si esta sesión puede abrirlo', async () => {
    useExplosionMock.mockReturnValue({ data: conPendiente(), isPending: false, isError: false });
    await abrir(['compras.ver', 'ordenes.ver', 'desarrollo.ver']);

    expect(screen.getByTestId('exp-ir-a-liberar')).toBeInTheDocument();
  });

  it('con TODO pendiente, el vacío NO miente diciendo "BOM vacío"', async () => {
    useExplosionMock.mockReturnValue({
      data: { ...conPendiente(), grupos: [] },
      isPending: false,
      isError: false,
    });
    await abrir(['compras.ver']);

    expect(screen.getByTestId('exp-vacio')).toHaveTextContent(
      /pendiente de que Desarrollo lo libere/,
    );
    expect(screen.getByTestId('exp-vacio')).not.toHaveTextContent(/BOM vacío/);
  });

  it('un comprador que NO puede ver la receta no recibe un enlace muerto (§Post-F9.68)', async () => {
    useExplosionMock.mockReturnValue({ data: conPendiente(), isPending: false, isError: false });
    await abrir(['compras.ver']);

    expect(screen.queryByTestId('exp-ir-a-liberar')).toBeNull();
    // Pero SÍ se le dice quién lo resuelve (nunca un callejón sin salida).
    expect(screen.getByTestId('exp-pendientes-liberar')).toHaveTextContent(/Pídeselo a Desarrollo/);
  });
});

/**
 * ⭐ §Post-F9.71 (V1-E3i) — CADA OC CON SU FECHA. Daniel, sobre una orden real: *"me pide fecha de
 * entrega, pero cada OC interna va a tener una fecha de entrega diferente"*. La tela se necesita
 * semanas antes que los avíos: una sola fecha para todas convierte el dato en decorativo.
 */
describe('ExplosionMaterialesPagina · fecha de entrega POR PROVEEDOR (§Post-F9.71)', () => {
  /** Explosión con DOS proveedores comprables (una sola OC no puede demostrar nada de fechas). */
  function conDosProveedores() {
    const base = explosionDePrueba();
    return {
      ...base,
      grupos: [
        ...base.grupos,
        {
          idProveedor: 22,
          proveedor: 'Telas del Norte',
          renglones: [
            {
              id: 4,
              tipo: 'tela',
              idTela: 4,
              idTelaColor: null,
              telaColor: null,
              idAvio: null,
              material: 'Felpa amarrada',
              cantidadRequerida: 45,
              unidad: 'm',
              esGenerico: false,
              estadoGenerico: 'no-aplica',
              existenciaStock: 0,
              cantidadAComprar: 45,
              idProveedorSugerido: 22,
              proveedorSugerido: 'Telas del Norte',
              precioSugerido: 10,
              origenProveedor: 'amarre-desarrollo',
              proveedorSugeridoInactivo: false,
              diff: 'sin-cambio',
              cambiosReceta: [],
              cantidadEnOc: 0,
              cantidadPendiente: 45,
              idsRequerimiento: [4],
              porOrden: [
                {
                  idRequerimiento: 4,
                  idOrden: 50,
                  folioOrden: 7,
                  cantidadRequerida: 45,
                  cantidadAComprar: 45,
                  cantidadEnOc: 0,
                  cantidadPendiente: 45,
                  precioSugerido: 10,
                },
              ],
            },
          ],
        },
      ],
    };
  }

  beforeEach(() => {
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    mutateMock.mockReset();
    previoMutateMock.mockReset();
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useGenerarOcMock.mockReturnValue({
      mutate: mutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useExplosionMock.mockReturnValue({
      data: conDosProveedores(),
      isPending: false,
      isError: false,
    });
  });

  async function abrirExplosion(): Promise<void> {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
  }

  it('cada grupo CON proveedor lleva su propia fecha; el grupo sin proveedor no (no genera OC)', async () => {
    await abrirExplosion();

    const fechas = screen.getAllByTestId('exp-fecha-grupo');
    expect(fechas).toHaveLength(2);
    expect(fechas.map((f) => f.getAttribute('data-proveedor'))).toEqual(['11', '22']);
  });

  it('la fecha de arriba es el VALOR INICIAL: las que nadie tocó la siguen', async () => {
    await abrirExplosion();

    fireEvent.change(screen.getByTestId('exp-fecha-entrega'), { target: { value: '2026-11-30' } });
    for (const campo of screen.getAllByTestId('exp-fecha-grupo')) {
      expect(campo).toHaveValue('2026-11-30');
    }
  });

  it('la fecha tocada de un proveedor NO arrastra a los demás, y viaja al servidor', async () => {
    const usuario = userEvent.setup();
    await abrirExplosion();

    fireEvent.change(screen.getByTestId('exp-fecha-entrega'), { target: { value: '2026-11-30' } });
    const campos = screen.getAllByTestId('exp-fecha-grupo');
    fireEvent.change(campos[1] as HTMLElement, { target: { value: '2026-10-05' } });

    // El campo tocado SE QUEDA con lo que se escribió…
    expect(campos[1] as HTMLElement).toHaveValue('2026-10-05');
    // …y el otro proveedor sigue con la de arriba (no se movió con el vecino).
    expect(campos[0] as HTMLElement).toHaveValue('2026-11-30');

    await usuario.click(screen.getByTestId('exp-generar-oc'));
    const [cuerpo] = previoMutateMock.mock.calls[0] as [
      {
        fechaEntrega?: string;
        fechasPorProveedor?: { idProveedor: number; fechaEntrega: string }[];
      },
    ];
    expect(cuerpo.fechaEntrega).toBe('2026-11-30');
    // Sólo viaja la EXCEPCIÓN: la del proveedor que nadie tocó la resuelve el servidor con la de
    // arriba (mandar las dos sería mandar como decisión lo que es un default).
    expect(cuerpo.fechasPorProveedor).toEqual([{ idProveedor: 22, fechaEntrega: '2026-10-05' }]);
  });

  it('sin tocar ninguna fecha de grupo, el cuerpo NO lleva fechas por proveedor (gemela)', async () => {
    const usuario = userEvent.setup();
    await abrirExplosion();

    fireEvent.change(screen.getByTestId('exp-fecha-entrega'), { target: { value: '2026-11-30' } });
    await usuario.click(screen.getByTestId('exp-generar-oc'));

    const [cuerpo] = previoMutateMock.mock.calls[0] as [Record<string, unknown>];
    expect(cuerpo).not.toHaveProperty('fechasPorProveedor');
    expect(cuerpo.fechaEntrega).toBe('2026-11-30');
  });

  it('vaciar la fecha de un grupo lo devuelve a seguir a la de arriba (y no viaja vacía)', async () => {
    const usuario = userEvent.setup();
    await abrirExplosion();

    fireEvent.change(screen.getByTestId('exp-fecha-entrega'), { target: { value: '2026-11-30' } });
    const campos = screen.getAllByTestId('exp-fecha-grupo');
    fireEvent.change(campos[1] as HTMLElement, { target: { value: '2026-10-05' } });
    fireEvent.change(campos[1] as HTMLElement, { target: { value: '' } });

    // Vuelve a mostrar la de arriba (no se queda en blanco significando otra cosa).
    expect(screen.getAllByTestId('exp-fecha-grupo')[1] as HTMLElement).toHaveValue('2026-11-30');

    await usuario.click(screen.getByTestId('exp-generar-oc'));
    const [cuerpo] = previoMutateMock.mock.calls[0] as [Record<string, unknown>];
    expect(cuerpo).not.toHaveProperty('fechasPorProveedor');
  });

  it('al cambiar de orden, las fechas por proveedor NO se arrastran', async () => {
    const usuario = userEvent.setup();
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [
          { id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' },
          { id: 51, folio: 8, codigoModelo: 'A-101', cliente: 'Cliente Y' },
        ],
        total: 2,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    fireEvent.change(screen.getAllByTestId('exp-fecha-grupo')[0] as HTMLElement, {
      target: { value: '2026-10-05' },
    });

    // V1-E3q: quitar la última OP deja la pantalla en blanco; volver a empezar NO arrastra fechas.
    await usuario.click(screen.getAllByTestId('exp-quitar-op')[0] as HTMLElement);
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[1] as HTMLElement);
    expect(screen.getAllByTestId('exp-fecha-grupo')[0] as HTMLElement).toHaveValue('');
  });
});

/**
 * ⭐ V1-E3m (§Post-F9.82) — EL PROVEEDOR DEL MATERIAL, desde la pantalla del comprador.
 *
 * Daniel se quedó atorado aquí: la explosión completa a la vista, el botón «Generar OC» apagado y
 * ni una pista de por qué. Estas pruebas cubren las dos mitades del arreglo en la UI: **decir qué
 * falta, con nombres** y **poder asignarle proveedor al material ahí mismo, solo para esa OP**.
 */
describe('ExplosionMaterialesPagina — V1-E3m: el proveedor del material (§Post-F9.82)', () => {
  beforeEach(() => {
    // Este bloque es TOP-LEVEL a propósito: arma su propio escenario en vez de heredar el de otro
    // describe (heredar el de al lado fue justo lo que hizo que un `mock.calls[0]` leyera la llamada
    // de la prueba anterior y diera un verde/rojo que no hablaba de esta prueba).
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      isError: false,
    });
    mutateMock.mockReset();
    previoMutateMock.mockReset();
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useGenerarOcMock.mockReturnValue({
      mutate: mutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    asignarMutateMock.mockReset();
    useAsignarProveedorMock.mockReturnValue({
      mutate: asignarMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
  });

  /** Explosión donde NADA se puede comprar: el único material pendiente no tiene proveedor. */
  function explosionSinNadaComprable(): ReturnType<typeof explosionDePrueba> {
    const base = explosionDePrueba();
    return { ...base, grupos: base.grupos.filter((g) => g.idProveedor === null) };
  }

  it('el botón apagado DICE qué falta, con los NOMBRES de los materiales', async () => {
    const usuario = userEvent.setup();
    useExplosionMock.mockReturnValue({
      data: explosionSinNadaComprable(),
      isPending: false,
      isError: false,
    });
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    expect(screen.getByTestId('exp-generar-oc')).toBeDisabled();
    const motivo = screen.getByTestId('exp-motivo-sin-oc');
    // "1 material sin proveedor" a secas obligaría a revisar la lista a mano: tiene que decir CUÁL.
    expect(motivo).toHaveTextContent('sin proveedor');
    expect(motivo).toHaveTextContent('Felpa');
    // El genérico cubierto por stock NO es lo que bloquea, y no debe salir nombrado como culpable.
    expect(motivo).not.toHaveTextContent('HIL-01');
  });

  it('con algo comprable no bloquea, pero nombra lo que se va a quedar FUERA de las OC', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    expect(screen.getByTestId('exp-generar-oc')).toBeEnabled();
    expect(screen.queryByTestId('exp-motivo-sin-oc')).not.toBeInTheDocument();
    expect(screen.getByTestId('exp-parcial-sin-proveedor')).toHaveTextContent('Felpa');
  });

  it('ofrece «asignar proveedor» SOLO en el material que no tiene a quién comprarle', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    const botones = screen.getAllByTestId('exp-asignar-proveedor');
    // UNO solo: la Felpa (id 4). El botón (id 3) ya trae proveedor del catálogo —ahí no se cambia
    // desde aquí, se cambia en la OC— y el hilo genérico no va a compra (cantidadAComprar 0).
    expect(botones).toHaveLength(1);
    expect(botones[0]).toHaveAttribute('data-material', '4');
  });

  it('sin `compras.administrar` la acción NO se pinta (§Post-F9.68: esconder Y bloquear)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    expect(screen.queryByTestId('exp-asignar-proveedor')).not.toBeInTheDocument();
  });

  it('asignar manda tipo + material + proveedor + precio, y NO toca ningún catálogo', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    await usuario.click(screen.getByTestId('exp-asignar-proveedor'));

    // Sin proveedor elegido no se puede guardar (evita mandar una asignación a medias).
    expect(screen.getByTestId('exp-guardar-proveedor')).toBeDisabled();

    await usuario.click(screen.getByTestId('exp-selector-proveedor-stub'));
    fireEvent.change(screen.getByTestId('exp-precio-asignar'), { target: { value: '13.5' } });
    await usuario.click(screen.getByTestId('exp-guardar-proveedor'));

    expect(asignarMutateMock).toHaveBeenCalledTimes(1);
    const [args] = asignarMutateMock.mock.calls[0] as [
      { idOrden: number; cuerpo: Record<string, unknown> },
    ];
    // El material es la FELPA (tela 4) y el proveedor el elegido (33): si la pantalla mandara el
    // renglón del snapshot (id 2) o el proveedor del otro grupo (11), aquí saldría rojo.
    expect(args.idOrden).toBe(50);
    expect(args.cuerpo).toEqual({
      tipo: 'tela',
      idMaterial: 4,
      idProveedor: 33,
      precio: 13.5,
    });
  });

  it('sin precio capturado la asignación viaja SIN precio (que lo resuelva el servidor, no un 0)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    await usuario.click(screen.getByTestId('exp-asignar-proveedor'));
    await usuario.click(screen.getByTestId('exp-selector-proveedor-stub'));
    await usuario.click(screen.getByTestId('exp-guardar-proveedor'));

    const [args] = asignarMutateMock.mock.calls[0] as [{ cuerpo: Record<string, unknown> }];
    expect(args.cuerpo).not.toHaveProperty('precio');
  });

  it('⭐ si el proveedor propuesto está DE BAJA, la pantalla SÍ ofrece reasignarlo', async () => {
    const usuario = userEvent.setup();
    const base = explosionDePrueba();
    // El botón (id 3) trae proveedor del catálogo… pero ese proveedor está dado de baja. Antes el
    // renglón se quedaba sin salida: `crearOC` no valida `activo`, así que la OC nacía a un
    // proveedor muerto, y el catálogo tampoco deja guardar con un proveedor desactivado.
    const conInactivo = {
      ...base,
      grupos: base.grupos.map((g) => ({
        ...g,
        renglones: g.renglones.map((r) =>
          r.idAvio === 3 ? { ...r, proveedorSugeridoInactivo: true } : r,
        ),
      })),
    };
    useExplosionMock.mockReturnValue({ data: conInactivo, isPending: false, isError: false });
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    expect(screen.getByTestId('exp-proveedor-inactivo')).toBeInTheDocument();
    // DOS ofertas de asignar: la felpa (sin proveedor, id 4) y el botón (proveedor de baja, id 3).
    const materiales = screen
      .getAllByTestId('exp-asignar-proveedor')
      .map((b) => b.getAttribute('data-material'));
    expect(materiales.sort()).toEqual(['3', '4']);
  });

  it('lo que asignó COMPRAS se ve marcado y se puede QUITAR (vuelve a lo del catálogo)', async () => {
    const usuario = userEvent.setup();
    const base = explosionDePrueba();
    const conAsignacion = {
      ...base,
      grupos: base.grupos.map((g) =>
        g.idProveedor === null
          ? {
              ...g,
              idProveedor: 33,
              proveedor: 'Telas del Norte',
              renglones: g.renglones.map((r) =>
                r.idTela === 4
                  ? {
                      ...r,
                      idProveedorSugerido: 33,
                      proveedorSugerido: 'Telas del Norte',
                      precioSugerido: 13.5,
                      origenProveedor: 'asignado-compras',
                    }
                  : r,
              ),
            }
          : g,
      ),
    };
    useExplosionMock.mockReturnValue({ data: conAsignacion, isPending: false, isError: false });
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    // Se distingue de un proveedor que vino del catálogo (el botón, `origenProveedor: habitual`).
    expect(screen.getAllByTestId('exp-origen-compras')).toHaveLength(1);

    await usuario.click(screen.getByTestId('exp-asignar-proveedor'));
    await usuario.click(screen.getByTestId('exp-quitar-proveedor'));
    const [args] = asignarMutateMock.mock.calls[0] as [{ cuerpo: Record<string, unknown> }];
    expect(args.cuerpo).toMatchObject({ tipo: 'tela', idMaterial: 4, idProveedor: null });
  });
});

/**
 * ⭐⭐ V1-E3q (§Post-F9.85) — **LA REVISIÓN PREVIA Y EL NETEO CONTRA LO YA COMPRADO.**
 *
 * Daniel, probando en vivo el 20-ago: *"Dice que se generaron las OC, pero no se ven reflejadas…
 * me vuelvo a meter en la pantalla y sigue apareciendo ahí los elementos y me deja volver a
 * hacerla"*, y su petición: *"me gustaría que al darle «generar OC desde la explosión», te mande a
 * una pantalla previa… una revisión previa es indispensable"*.
 */
describe('ExplosionMaterialesPagina — V1-E3q: revisión previa y no recomprar (§Post-F9.85)', () => {
  /** Plan que devolvería el servidor: una OC para dos OP + un renglón omitido por ya estar en OC. */
  function planDePrueba() {
    return {
      ordenes: [
        {
          idOrden: 50,
          folio: 7,
          idModelo: 9,
          modelo: 'A-100',
          totalPiezas: 30,
          idPedido: 300,
          folioPedido: 1515,
          fechaEntrega: '2026-09-30',
        },
        {
          idOrden: 51,
          folio: 8,
          idModelo: 9,
          modelo: 'A-101',
          totalPiezas: 20,
          idPedido: 300,
          folioPedido: 1515,
          fechaEntrega: '2026-10-15',
        },
      ],
      proveedores: [
        {
          idProveedor: 11,
          proveedor: 'Avíos Baratos',
          fechaEntrega: '2026-09-01',
          renglones: [
            {
              tipo: 'avio' as const,
              idMaterial: 3,
              material: 'BOT-01 — Botón',
              unidad: 'pza',
              cantidadTotal: 300,
              cantidadPropuesta: 300,
              ajustado: false,
              importe: 600,
              porOrden: [
                {
                  idRequerimiento: 1,
                  idOrden: 50,
                  folioOrden: 7,
                  cantidad: 180,
                  precio: 2,
                  importe: 360,
                },
                {
                  idRequerimiento: 9,
                  idOrden: 51,
                  folioOrden: 8,
                  cantidad: 120,
                  precio: 2,
                  importe: 240,
                },
              ],
            },
          ],
          total: 600,
          ordenes: [7, 8],
        },
      ],
      omitidos: [
        {
          idRequerimiento: 2,
          idOrden: 50,
          folioOrden: 7,
          tipo: 'tela' as const,
          material: 'Felpa',
          unidad: 'm',
          cantidadAComprar: 45,
          cantidadEnOc: 45,
          motivo: 'ya-en-oc' as const,
          detalle: '"Felpa" ya está en una orden de compra viva para la orden 7 (45 m).',
        },
      ],
      bloqueos: [] as string[],
      totalGeneral: 600,
    };
  }

  beforeEach(() => {
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [
          { id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' },
          { id: 51, folio: 8, codigoModelo: 'A-101', cliente: 'Cliente X' },
        ],
        total: 2,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      isError: false,
    });
    useOrdenesDelPedidoMock.mockReset();
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    mutateMock.mockReset();
    previoMutateMock.mockReset();
    useGenerarOcMock.mockReturnValue({
      mutate: mutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useAsignarProveedorMock.mockReturnValue({
      mutate: asignarMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
  });

  /** Abre la pantalla, elige la OP y llega hasta la REVISIÓN PREVIA con el plan dado. */
  async function llegarALaPrevia(plan = planDePrueba()): Promise<void> {
    previoMutateMock.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess?: (p: unknown) => void }) => {
        opciones.onSuccess?.(plan);
      },
    );
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    await usuario.click(screen.getByTestId('exp-generar-oc'));
  }

  it('⭐ la revisión previa enseña la OC completa, con DE QUÉ OP es cada cantidad', async () => {
    await llegarALaPrevia();

    expect(screen.getByTestId('exp-revision-previa')).toBeInTheDocument();
    const oc = screen.getByTestId('exp-previa-oc');
    expect(oc).toHaveTextContent('Avíos Baratos');
    expect(oc).toHaveTextContent('2026-09-01');
    // §Post-F9.86: el reparto POR OP es innegociable — se ve junto, se guarda repartido.
    const repartos = screen.getAllByTestId('exp-previa-reparto');
    expect(repartos).toHaveLength(2);
    expect(repartos[0]).toHaveTextContent('Orden 7: 180');
    expect(repartos[1]).toHaveTextContent('Orden 8: 120');
    // Y qué OP surte esta OC, dicho arriba.
    expect(screen.getByTestId('exp-previa-ops')).toHaveTextContent('7, 8');
  });

  it('⭐ enseña lo que se va a OMITIR y POR QUÉ (antes se descartaba en silencio)', async () => {
    await llegarALaPrevia();

    const omitido = screen.getByTestId('exp-previa-omitido');
    expect(omitido).toHaveAttribute('data-motivo', 'ya-en-oc');
    expect(omitido).toHaveTextContent('ya está en una orden de compra viva');
  });

  it('⭐ confirmar SÍ genera, con el MISMO cuerpo que se revisó', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    await usuario.click(screen.getByTestId('exp-confirmar-generar'));
    expect(mutateMock).toHaveBeenCalledOnce();
    const [cuerpo] = mutateMock.mock.calls[0] as [Record<string, unknown>];
    expect(cuerpo).toEqual({ idsOrden: [50], idsRequerimiento: [], idDireccionEntrega: 7 });
  });

  it('volver desde la previa NO genera nada y devuelve la explosión', async () => {
    const usuario = userEvent.setup();
    await llegarALaPrevia();

    await usuario.click(screen.getByTestId('exp-volver-explosion'));
    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('exp-revision-previa')).toBeNull();
    expect(screen.getByTestId('exp-grupos')).toBeInTheDocument();
  });

  it('con BLOQUEOS del servidor, la previa los dice y NO deja confirmar', async () => {
    const plan = { ...planDePrueba(), bloqueos: ['Falta la dirección de entrega favorita.'] };
    await llegarALaPrevia(plan);

    expect(screen.getByTestId('exp-bloqueo')).toHaveTextContent('dirección de entrega favorita');
    expect(screen.getByTestId('exp-confirmar-generar')).toBeDisabled();
  });

  /**
   * 🔴 EL DEFECTO DE FONDO: lo que ya está en una OC viva NO se vuelve a proponer. Si alguien
   * quitara el neteo del servidor (o la pantalla volviera a mirar `cantidadAComprar`), el renglón
   * volvería a salir comprable y esta prueba se pondría roja.
   */
  it('⭐ un material YA COMPRADO no es comprable y se dice con letras', async () => {
    const base = explosionDePrueba();
    // Sólo el grupo CON proveedor: así lo único que puede bloquear es el neteo contra la OC (con la
    // felpa sin proveedor delante, el motivo sería "sin proveedor" y no se probaría nada de esto).
    const yaComprado = {
      ...base,
      grupos: base.grupos
        .filter((g) => g.idProveedor !== null)
        .map((g) => ({
          ...g,
          renglones: g.renglones.map((r) =>
            r.id === 1
              ? {
                  ...r,
                  cantidadEnOc: 180,
                  cantidadPendiente: 0,
                  porOrden: r.porOrden.map((l) => ({
                    ...l,
                    cantidadEnOc: 180,
                    cantidadPendiente: 0,
                  })),
                }
              : r,
          ),
        })),
    };
    useExplosionMock.mockReturnValue({ data: yaComprado, isPending: false, isError: false });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    // El aviso lo nombra…
    expect(screen.getByTestId('exp-ya-en-oc')).toHaveTextContent('BOT-01 — Botón');
    // …su fila lo marca…
    expect(screen.getByTestId('exp-en-oc-badge')).toHaveTextContent('Ya comprado');
    // …su casilla queda deshabilitada (no es comprable)…
    expect(screen.getAllByTestId('exp-renglon-check')[0]).toBeDisabled();
    // …y el botón se apaga diciendo la razón REAL (no "sin proveedor", que sería mentir).
    expect(screen.getByTestId('exp-generar-oc')).toBeDisabled();
    expect(screen.getByTestId('exp-motivo-sin-oc')).toHaveTextContent(
      'Todo lo que falta ya está en órdenes de compra',
    );
  });

  it('el SOBRANTE de compra (rollo completo) viaja como AJUSTE; el servidor lo reparte', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    // Sólo el renglón comprable ofrece ajustar el total (el botón, avío 3, proveedor 11).
    const campos = screen.getAllByTestId('exp-ajuste-cantidad');
    expect(campos).toHaveLength(1);
    fireEvent.change(campos[0] as HTMLElement, { target: { value: '250' } });

    await usuario.click(screen.getByTestId('exp-generar-oc'));
    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ ajustes?: unknown[] }];
    expect(cuerpo.ajustes).toEqual([
      { tipo: 'avio', idMaterial: 3, idTelaColor: null, idProveedor: 11, cantidadTotal: 250 },
    ]);
  });

  it('un ajuste VACÍO no viaja (en blanco = compra lo pendiente, no "compra cero")', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    const campo = screen.getAllByTestId('exp-ajuste-cantidad')[0] as HTMLElement;
    fireEvent.change(campo, { target: { value: '250' } });
    fireEvent.change(campo, { target: { value: '' } });

    await usuario.click(screen.getByTestId('exp-generar-oc'));
    const [cuerpo] = previoMutateMock.mock.calls[0] as [Record<string, unknown>];
    expect(cuerpo).not.toHaveProperty('ajustes');
  });
});

/**
 * ⭐ V1-E3q (§Post-F9.86) — **UNA COMPRA PARA VARIAS OP.** Daniel: *"¿cómo hacemos cuando una OC
 * cubre varias OP? Es muy muy común… Podríamos hacerlo por número de pedido interno (ejemplo 1515).
 * Pero aparte a veces se compran más órdenes… por ejemplo cuando se compran cajas"*.
 */
describe('ExplosionMaterialesPagina — V1-E3q: varias OP en una compra (§Post-F9.86)', () => {
  beforeEach(() => {
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [
          { id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' },
          { id: 51, folio: 8, codigoModelo: 'A-101', cliente: 'Cliente X' },
          { id: 99, folio: 12, codigoModelo: 'B-200', cliente: 'Otro Cliente' },
        ],
        total: 3,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      isError: false,
    });
    mutateMock.mockReset();
    previoMutateMock.mockReset();
    useOrdenesDelPedidoMock.mockReset();
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    useGenerarOcMock.mockReturnValue({
      mutate: mutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    useAsignarProveedorMock.mockReturnValue({
      mutate: asignarMutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
  });

  it('⭐ al elegir una OP se PRECARGAN las OP de su pedido interno (los avíos del 1515)', async () => {
    useOrdenesDelPedidoMock.mockReturnValue({
      data: {
        idPedido: 300,
        folioPedido: 1515,
        ordenes: [
          { idOrden: 50, folio: 7, modelo: 'A-100', cliente: 'Cliente X', cancelada: false },
          { idOrden: 51, folio: 8, modelo: 'A-101', cliente: 'Cliente X', cancelada: false },
          // La cancelada NO se precarga: comprar material para ella es tirar el dinero.
          { idOrden: 52, folio: 9, modelo: 'A-102', cliente: 'Cliente X', cancelada: true },
        ],
      },
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    // Se explosiona el CONJUNTO precargado, sin la cancelada. Si la 52 se colara, esto sale rojo.
    expect(useExplosionMock).toHaveBeenCalledWith([50, 51]);
  });

  /**
   * 🔴 La precarga **NO puede volver a meter una OP que el usuario quitó.** Es fácil que pase: la
   * consulta del pedido se refresca sola (al recuperar el foco, por ejemplo) y un efecto que sólo
   * mirara la forma del conjunto la re-precargaría. Una precarga que pisa lo que la persona decidió
   * es un sabotaje, no una ayuda. Por eso corre UNA sola vez por OP base.
   */
  it('⭐ quitar una OP precargada NO la devuelve cuando la consulta del pedido se refresca', async () => {
    const respuesta = {
      idPedido: 300,
      folioPedido: 1515,
      ordenes: [
        { idOrden: 50, folio: 7, modelo: 'A-100', cliente: 'Cliente X', cancelada: false },
        { idOrden: 51, folio: 8, modelo: 'A-101', cliente: 'Cliente X', cancelada: false },
      ],
    };
    // Cada render devuelve un objeto NUEVO: es justo lo que hace un refetch sin igualdad estructural.
    useOrdenesDelPedidoMock.mockImplementation(() => ({
      data: { ...respuesta, ordenes: [...respuesta.ordenes] },
      isPending: false,
      isError: false,
    }));
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    expect(useExplosionMock).toHaveBeenCalledWith([50, 51]);

    // Se quita la 8 (idOrden 51) y se dispara un re-render más (el buscador).
    const quitar = screen.getAllByTestId('exp-quitar-op');
    await usuario.click(quitar[1] as HTMLElement);
    await usuario.type(screen.getByTestId('exp-buscar-orden'), 'a');

    // 🔴 Si la precarga volviera a correr, la última llamada sería [50, 51] otra vez.
    const ultima = useExplosionMock.mock.calls.at(-1)?.[0] as number[];
    expect(ultima).toEqual([50]);
  });

  it('⭐ se pueden AGREGAR OP sueltas (las cajas, que cruzan pedidos) y quitarlas', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    // La 99 es de OTRO cliente y OTRO pedido: se agrega a mano.
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[2] as HTMLElement);
    expect(useExplosionMock).toHaveBeenCalledWith([50, 99]);

    // Y se puede quitar: el chip de cada OP lleva su botón.
    const chips = screen.getAllByTestId('exp-op-chip');
    expect(chips.length).toBeGreaterThan(0);
  });

  it('las OP del conjunto viajan en el cuerpo de la compra (no en la URL)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[1] as HTMLElement);
    await usuario.click(screen.getByTestId('exp-generar-oc'));

    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ idsOrden: number[] }];
    expect(cuerpo.idsOrden).toEqual([50, 51]);
  });

  it('quitar la ÚLTIMA OP deja la pantalla sin explosión (no en un estado a medias)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);
    expect(screen.getByTestId('exp-grupos')).toBeInTheDocument();

    await usuario.click(screen.getAllByTestId('exp-quitar-op')[0] as HTMLElement);
    expect(screen.queryByTestId('exp-grupos')).toBeNull();
    expect(screen.queryByTestId('exp-ops-elegidas')).toBeNull();
  });
});

/**
 * ⭐⭐ V1-E3u (§Post-F9.89) — **LA TELA SE COMPRA POR COLOR.**
 *
 * Lo que se protege aquí es que la pantalla **diga la verdad sobre el color** y que el ajuste del
 * comprador **viaje amarrado a SU color**: sin eso, el total que se teclea para el marino se
 * aplicaría también al grana y el desvío que ve quien autoriza sería el de una compra que nadie hizo.
 */
describe('ExplosionMaterialesPagina — V1-E3u: la tela se compra POR COLOR (§Post-F9.89)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
    });
    useOrdenesDelPedidoMock.mockReturnValue({ data: undefined, isPending: false });
    useDireccionesMock.mockReturnValue({
      data: { datos: [{ id: 7, nombre: 'Naucalpan', favorita: true }] },
      isPending: false,
    });
    usePrevioCompraMock.mockReturnValue({
      mutate: previoMutateMock,
      isPending: false,
      reset: vi.fn(),
    });
    useGenerarOcMock.mockReturnValue({ mutate: vi.fn(), isPending: false, reset: vi.fn() });
    useAsignarProveedorMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    imprimirExplosionMock.mockReset();
  });

  /** Explosión con la felpa PARTIDA en dos colores (lo que la etapa vino a hacer posible). */
  function explosionPorColor() {
    const base = explosionDePrueba();
    const felpa = base.grupos[1]?.renglones[0] as Record<string, unknown>;
    const grana = {
      ...felpa,
      id: 20,
      idTelaColor: 77,
      telaColor: 'Grana 7700',
      idProveedorSugerido: 11,
      idsRequerimiento: [20],
    };
    const marino = {
      ...felpa,
      id: 21,
      idTelaColor: 78,
      telaColor: 'Marino Alsa 3040',
      idProveedorSugerido: 11,
      idsRequerimiento: [21],
    };
    return {
      ...base,
      grupos: [{ idProveedor: 11, proveedor: 'Alsatex', renglones: [grana, marino] }],
      pendientesColor: [
        {
          idTela: 4,
          tela: 'Cardigan',
          colores: ['Azul'],
          cantidadRequerida: 15,
          unidad: 'kg',
          idOrden: 91,
          folioOrden: 5558,
        },
        // ⭐ V1-E3u/D7 — un SEGUNDO pendiente, de OTRA orden: es el caso multi-OP que Daniel llamó
        // *"muy muy común"* y donde la acción global abría siempre la primera.
        {
          idTela: 4,
          tela: 'Cardigan',
          colores: ['Verde'],
          cantidadRequerida: 20,
          unidad: 'kg',
          idOrden: 92,
          folioOrden: 5560,
        },
      ],
    };
  }

  it('cada renglón de tela ENSEÑA su color', async () => {
    useExplosionMock.mockReturnValue({ data: explosionPorColor(), isPending: false, error: null });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    const chips = screen.getAllByTestId('exp-color-tela').map((c) => c.textContent);
    expect(chips).toEqual(['Grana 7700', 'Marino Alsa 3040']);
  });

  it('lo que falta por decir se AVISA, con su acción para arreglarlo', async () => {
    useExplosionMock.mockReturnValue({ data: explosionPorColor(), isPending: false, error: null });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    expect(screen.getByTestId('exp-pendientes-color')).toBeInTheDocument();
    const pendientes = screen.getAllByTestId('exp-pendiente-color');
    expect(pendientes[0]?.textContent).toContain('Cardigan');
    expect(pendientes[0]?.textContent).toContain('Azul');
    // Una acción POR PENDIENTE, no una sola para todos.
    expect(screen.getAllByTestId('exp-decir-colores')).toHaveLength(2);
  });

  /**
   * 🔴 **D7 — la acción abre SU orden, no la primera de la lista.** El texto del pendiente dice de
   * qué orden es (el servidor antepone «Orden 5560:»), así que un único enlace a `idsOrden[0]` hacía
   * leer 5560 y aterrizar en 5558 — a capturarle los colores a la orden equivocada.
   */
  it('🔴 con varias OP, cada pendiente abre la orden que NOMBRA (no la primera)', async () => {
    useExplosionMock.mockReturnValue({ data: explosionPorColor(), isPending: false, error: null });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    const acciones = screen.getAllByTestId('exp-decir-colores');
    // Cada enlace NOMBRA su orden: si volviera a haber uno solo, o los dos dijeran 5558, rojo.
    expect(acciones[0]?.textContent).toContain('5558');
    expect(acciones[1]?.textContent).toContain('5560');

    // Y al pulsar el SEGUNDO, el diálogo pide los colores de la orden 92 (folio 5560).
    // 🔴 EL VALOR QUE LO PONDRÍA ROJO: 91 — que es lo que pasaba con `idsOrden[0]`.
    useColoresDeTelaMock.mockClear();
    await usuario.click(acciones[1] as HTMLElement);
    expect(useColoresDeTelaMock).toHaveBeenCalledWith(92);
  });

  it('§Post-F9.68 — sin `compras.administrar` NO se ofrece decir el color (esconder Y bloquear)', async () => {
    useExplosionMock.mockReturnValue({ data: explosionPorColor(), isPending: false, error: null });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    // El AVISO sí se ve (es información), pero la acción no.
    expect(screen.getByTestId('exp-pendientes-color')).toBeInTheDocument();
    expect(screen.queryByTestId('exp-decir-colores')).toBeNull();
  });

  /**
   * 🟠 **D5 — cuando el "ya en OC" NO es un hecho plano.** Lo ya comprado que viene de una OC vieja
   * (sin color) hay que atribuírselo a ALGÚN color; cuando no alcanza para todos, **el orden de las
   * filas decide**. Es una elección del sistema, no un dato — y se marca.
   */
  it('🟠 avisa cuando lo "ya en OC" viene de una orden que no dice el color', async () => {
    const base = explosionPorColor();
    const grupo = base.grupos[0] as { renglones: Record<string, unknown>[] };
    const [grana, marino] = grupo.renglones;
    const conAmbiguo = {
      ...base,
      grupos: [
        {
          ...grupo,
          renglones: [{ ...grana, cantidadEnOc: 100, cantidadEnOcSinColor: 100 }, marino],
        },
      ],
    };
    useExplosionMock.mockReturnValue({ data: conAmbiguo, isPending: false, error: null });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    // 🔴 El valor que la pone ROJA: `cantidadEnOcSinColor: 0` — el sistema eligiendo en silencio,
    // que es como estaba antes de la revisión.
    const aviso = screen.getByTestId('exp-en-oc-sin-color');
    expect(aviso).toHaveTextContent('no dice de');
    expect(aviso).toHaveTextContent('100');
    // Y sólo lo marca el renglón que lo tiene: el otro color no inventa una alarma.
    expect(screen.getAllByTestId('exp-en-oc-sin-color')).toHaveLength(1);
  });

  it('🔴 el ajuste del comprador viaja amarrado a SU COLOR, no a la tela', async () => {
    useExplosionMock.mockReturnValue({ data: explosionPorColor(), isPending: false, error: null });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    await usuario.click(screen.getAllByTestId('exp-orden-opcion')[0] as HTMLElement);

    // Se teclea el rollo completo SÓLO en el segundo color (el marino).
    const campos = screen.getAllByTestId('exp-ajuste-cantidad');
    expect(campos).toHaveLength(2);
    fireEvent.change(campos[1] as HTMLElement, { target: { value: '250' } });
    await usuario.click(screen.getByTestId('exp-generar-oc'));

    const [cuerpo] = previoMutateMock.mock.calls[0] as [{ ajustes?: unknown[] }];
    // 🔴 EL VALOR QUE LO PONDRÍA ROJO: `idTelaColor: 77` (el grana) o `null` — cualquiera de los dos
    // haría que el rollo completo se le cargara al color equivocado.
    expect(cuerpo.ajustes).toEqual([
      { tipo: 'tela', idMaterial: 4, idTelaColor: 78, idProveedor: 11, cantidadTotal: 250 },
    ]);
  });
});
