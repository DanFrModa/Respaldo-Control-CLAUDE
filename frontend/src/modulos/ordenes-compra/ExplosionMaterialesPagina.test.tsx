import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ExplosionMaterialesPagina } from './ExplosionMaterialesPagina';

const useExplosionMock = vi.fn();
const useGenerarOcMock = vi.fn();
const useConsultaOrdenesMock = vi.fn();
const mutateMock = vi.fn();
const imprimirExplosionMock = vi.fn();

vi.mock('@/api/mrp', () => ({
  useExplosion: (id: unknown) => useExplosionMock(id) as unknown,
  useGenerarOc: () => useGenerarOcMock() as unknown,
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
