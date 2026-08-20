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
// ⭐ V1-E3m (§Post-F9.82): asignar/quitar el proveedor de un material EN ESTA ORDEN.
const useAsignarProveedorMock = vi.fn();
const asignarMutateMock = vi.fn();

vi.mock('@/api/mrp', () => ({
  useExplosion: (id: unknown) => useExplosionMock(id) as unknown,
  useGenerarOc: () => useGenerarOcMock() as unknown,
  useAsignarProveedor: () => useAsignarProveedorMock() as unknown,
  imprimirExplosion: (id: number) => imprimirExplosionMock(id) as unknown,
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
    grupos: [
      {
        idProveedor: 11,
        proveedor: 'Avíos Baratos',
        renglones: [
          {
            id: 1,
            tipo: 'avio',
            idTela: null,
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
          },
          {
            id: 3,
            tipo: 'avio',
            idTela: null,
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
    expect(useExplosionMock).toHaveBeenCalledWith(50);
    // Dos grupos (un proveedor + "sin proveedor").
    expect(screen.getAllByTestId('exp-grupo')).toHaveLength(2);
    expect(screen.getByText('BOT-01 — Botón')).toBeInTheDocument();
    // El genérico cubierto por stock se marca.
    expect(screen.getByText('Cubierto por stock')).toBeInTheDocument();
  });

  it('genera OC con la selección (un clic) y limpia la selección al terminar', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    // Genera para TODO lo pendiente (sin marcar nada → idsRequerimiento vacío).
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    // Llama a generar con la orden y la selección vacía (todo lo pendiente) + un callback onSuccess.
    expect(mutateMock).toHaveBeenCalledOnce();
    const [args, opciones] = mutateMock.mock.calls[0] as [
      { idOrden: number; cuerpo: { idsRequerimiento: number[] } },
      { onSuccess?: unknown },
    ];
    // La dirección FAVORITA viaja explícita: el servidor no tiene que adivinarla.
    expect(args).toEqual({
      idOrden: 50,
      cuerpo: { idsRequerimiento: [], idDireccionEntrega: 7 },
    });
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
          idTela: null,
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
              diff: 'sin-cambio',
              cambiosReceta: [],
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
    const [args] = mutateMock.mock.calls[0] as [
      {
        cuerpo: {
          fechaEntrega?: string;
          fechasPorProveedor?: { idProveedor: number; fechaEntrega: string }[];
        };
      },
    ];
    expect(args.cuerpo.fechaEntrega).toBe('2026-11-30');
    // Sólo viaja la EXCEPCIÓN: la del proveedor que nadie tocó la resuelve el servidor con la de
    // arriba (mandar las dos sería mandar como decisión lo que es un default).
    expect(args.cuerpo.fechasPorProveedor).toEqual([
      { idProveedor: 22, fechaEntrega: '2026-10-05' },
    ]);
  });

  it('sin tocar ninguna fecha de grupo, el cuerpo NO lleva fechas por proveedor (gemela)', async () => {
    const usuario = userEvent.setup();
    await abrirExplosion();

    fireEvent.change(screen.getByTestId('exp-fecha-entrega'), { target: { value: '2026-11-30' } });
    await usuario.click(screen.getByTestId('exp-generar-oc'));

    const [args] = mutateMock.mock.calls[0] as [{ cuerpo: Record<string, unknown> }];
    expect(args.cuerpo).not.toHaveProperty('fechasPorProveedor');
    expect(args.cuerpo.fechaEntrega).toBe('2026-11-30');
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
    const [args] = mutateMock.mock.calls[0] as [{ cuerpo: Record<string, unknown> }];
    expect(args.cuerpo).not.toHaveProperty('fechasPorProveedor');
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
