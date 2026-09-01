import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModeloFicha } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { EditorBom } from './EditorBom';

/**
 * Pruebas de componente del `<EditorBom>` (F1-E4 + V1-E3c). Cubre las dos secciones de SET
 * COMPLETO (telas/avíos: capturar y guardar la receta), el renglón COMPACTO con su panel
 * expandible (las 3 banderas 🔑 y el AMARRE de precio viven ahí), que la receta muestre el precio
 * del proveedor amarrado —o el de catálogo marcado como "referencia"— y que la pestaña **Arte**
 * delegue en `SeccionArte` (desde V1-E3d el arte es un HIJO del modelo con CRUD por renglón).
 * La capa de datos va simulada (sin red).
 */
const guardarTelasMutate = vi.fn();
const guardarAviosMutate = vi.fn();
/** V1-E3v: lo que el servidor sugiere de avíos favoritos (se ajusta por prueba). */
let favoritosMock: {
  sugeridos: {
    idAvio: number;
    clave: string;
    descripcion: string;
    cantidadSugerida: number;
    unidad: string | null;
  }[];
  yaEnLaReceta: unknown[];
  sinCantidad: unknown[];
} = { sugeridos: [], yaEnLaReceta: [], sinCantidad: [] };
/**
 * V1-E9b: lo que el servidor propone de CURVA. Configurable porque la curva es lo ÚNICO de esta
 * pantalla que NO es receta: en un modelo hijo del linaje 1:N tiene que seguir editándose, y sin
 * una propuesta el bloque no pinta nada que se pueda mirar.
 */
let curvasMock: {
  idModelo: number;
  yaTieneCurva: boolean;
  sugerencias: {
    idsTalla: number[];
    etiquetas: string[];
    nombre: string;
    ordenes: number;
    folios: string[];
    idCurvaExistente: number | null;
  }[];
} = { idModelo: 1, yaTieneCurva: false, sugerencias: [] };
/** V1-E9b: la matriz por talla del avío 5, ya cargada (ver la nota del mock de abajo). */
const medidasMock = {
  idModelo: 1,
  idAvio: 5,
  consumoPorTalla: true,
  tieneCurva: true,
  modoCaptura: 'consumo' as const,
  unidadConsumo: 'pza',
  unidadMedida: null,
  avisos: [] as string[],
  tallas: [
    {
      idTalla: 3,
      etiquetaTalla: 'CH',
      consumo: 2,
      enCurva: true,
      idAvioMedida: null,
      medidaAmarrada: null,
      precioMedida: null,
    },
  ],
};

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/api/modelos', () => ({
  useReemplazarTelasBom: () => ({ mutate: guardarTelasMutate, isPending: false }),
  useReemplazarAviosBom: () => ({ mutate: guardarAviosMutate, isPending: false }),
  useCopiarBom: () => ({ mutate: vi.fn(), isPending: false }),
  // V1-E3r: el bloque de la curva vive arriba del editor; aquí no se ejercita (tiene su propia
  // prueba en `CurvaDelModelo.test.tsx`), así que la propuesta llega vacía.
  useCurvasSugeridas: () => ({ data: curvasMock }),
  useAsignarCurvaDesdeOrdenes: () => ({ mutate: vi.fn(), isPending: false }),
  // V1-E3v: la sugerencia de avíos favoritos vive arriba de la sección de avíos y tiene su propia
  // prueba (`SugerenciaAviosFavoritos.test.tsx`); aquí llega vacía para no estorbar.
  useAviosFavoritosBom: () => ({ data: favoritosMock }),
  useAceptarAviosFavoritos: () => ({ mutate: vi.fn(), isPending: false }),
  // useModelos lo usa el CopiarBomDialogo montado (cerrado).
  useModelos: () => ({
    data: { datos: [], total: 0, pagina: 1, porPagina: 20, totalPaginas: 1 },
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Catálogos de los selectores de "agregar" (combobox con búsqueda server-side) y del amarre.
vi.mock('@/api/telas', () => ({
  useTelas: () => ({ data: { datos: [] }, isPending: false, isError: false, error: null }),
}));
vi.mock('@/api/avios', () => ({
  useAvios: () => ({ data: { datos: [] }, isPending: false, isError: false, error: null }),
  useProveedoresDeAvio: () => ({
    data: [
      {
        idProveedor: 4,
        nombreProveedor: 'Botones SA',
        precio: 1.2,
        condiciones: null,
      },
      {
        idProveedor: 5,
        nombreProveedor: 'Botones Caros',
        precio: 3,
        condiciones: null,
      },
    ],
    isPending: false,
    isError: false,
    error: null,
  }),
}));
vi.mock('@/api/tela-proveedores', () => ({
  useTelaProveedores: () => ({
    data: [
      {
        id: 31,
        idTela: 9,
        idProveedor: 7,
        nombreProveedor: 'Alsatex',
        precio: 62.5,
        manejaPrecioPorColor: false,
        condiciones: null,
        activo: true,
        colores: [],
      },
      // Cotiza POR COLOR: el precio base es el piso, no el que costea.
      {
        id: 32,
        idTela: 9,
        idProveedor: 8,
        nombreProveedor: 'Textiles del Valle',
        precio: 55,
        manejaPrecioPorColor: true,
        condiciones: null,
        activo: true,
        colores: [],
      },
      // Amarre POSIBLE pero SIN precio capturado: la cascada lo salta.
      {
        id: 33,
        idTela: 9,
        idProveedor: 9,
        nombreProveedor: 'Telas sin lista',
        precio: null,
        manejaPrecioPorColor: false,
        condiciones: null,
        activo: true,
        colores: [],
      },
    ],
    isPending: false,
    isError: false,
    error: null,
  }),
}));
/**
 * El panel de consumo por talla tiene su propia capa de datos (y su propio archivo de pruebas),
 * pero **aquí tiene que llegar CARGADO**.
 *
 * 🔴 Cicatriz de la revisión de V1-E9b: este mock devolvía `isPending: true`, así que el panel
 * pintaba un `Skeleton` y su botón de guardar NO existía **nunca**. Cualquier aserción de que el
 * botón no está habría pasado por la razón equivocada — y de hecho la regresión real
 * (`EditorMedidasAvio` recibiendo `puedeAdministrar` en vez de `puedeEditarReceta`) sobrevivió la
 * suite entera. El panel es una de las DOCE puertas de la receta (`guardarMedidasAvio`): tiene su
 * propio botón y su propio endpoint, así que su cierre hay que verlo de verdad.
 */
vi.mock('@/api/modelo-medidas', () => ({
  useMedidasAvio: () => ({ data: medidasMock, isPending: false, isError: false, error: null }),
  useReemplazarMedidasAvio: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/medidas-avio', () => ({
  useMedidasAvio: () => ({ data: { datos: [] }, isPending: false, isError: false, error: null }),
}));

// El ARTE tiene su propia capa de datos (V1-E3d): aquí solo hace falta que no toque la red.
vi.mock('@/api/artes', () => ({
  useEliminarArte: () => ({ mutate: vi.fn(), isPending: false }),
  useMarcarArtePrincipal: () => ({ mutate: vi.fn(), isPending: false }),
  useCrearArte: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarArte: () => ({ mutate: vi.fn(), isPending: false }),
  useCopiarArte: () => ({ mutate: vi.fn(), isPending: false }),
  useGaleriaArte: () => ({ data: { datos: [] }, isPending: false, isError: false }),
  useFotosArte: () => ({ data: { datos: [] }, isPending: false, isError: false }),
  useArtesModelo: () => ({ data: { datos: [] }, isPending: false, isError: false }),
  useSubirFotoArte: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarFotoArte: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] }, isPending: false }),
  // V1-E3f: el selector de proveedor del arte pasó al combobox con búsqueda en servidor.
  useProveedoresPorRol: () => ({ data: { datos: [] }, isPending: false, isError: false }),
  useRolesProveedor: () => ({ data: [], isPending: false }),
}));

vi.mock('@/api/tipos-proceso', () => ({
  // El tipo del arte sale del catálogo ÚNICO (V1-E3f, §Post-F9.58).
  useTiposArte: () => ({ data: { datos: [] }, isPending: false, isError: false }),
}));

/** Ficha mínima con una tela en la receta y el arte/avíos que se le pasen. */
function fichaBase(
  artes: ModeloFicha['artes'] = [],
  extra: Partial<ModeloFicha> = {},
): ModeloFicha {
  return {
    id: 1,
    codigo: '501',
    origen: 'produccion',
    codigoDesarrollo: null,
    numeroProduccion: null,
    // Linaje de versiones (V1-E7b): estos fixtures son de modelos RAÍZ (no nacieron de otro).
    idModeloPadre: null,
    codigoPadre: null,
    versionDesarrollo: null,
    idModeloDesarrollo: null,
    codigoModeloDesarrollo: null,
    // ⭐ V1-E7d — no son versiones, así que NO llevan revisión: los cuatro campos en null.
    revisionEstado: null,
    idRevisadoPor: null,
    revisadoPor: null,
    revisadoEn: null,
    revisionNota: null,
    descripcion: null,
    composicion: null,
    maquilaBase: null,
    idTemporada: null,
    temporada: null,
    idCurvaTalla: null,
    curvaTalla: null,
    idGenero: null,
    genero: null,
    idTipoProducto: null,
    tipoProducto: null,
    numOperaciones: null,
    corteBase: null,
    idMaquileroCotizado: null,
    maquileroCotizado: null,
    secuenciaEstampado: 'antes',
    llevaArte: true,
    cantidadFotos: 0,
    urlFotoPrincipal: null,
    telaPrincipal: null,
    stockPt: null,
    costoActual: null,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    telas: [
      {
        idTela: 9,
        nombre: 'Jersey',
        consumoPorPrenda: 1,
        paraPreCosto: true,
        paraProduccion: true,
        paraCosto: true,
        idTelaProveedor: null,
        proveedorAmarrado: null,
        precioPorColor: false,
        precioCosteo: 40,
        origenPrecio: 'referencia' as const,
        proveedorPrecio: null,
        amarreIgnorado: false,
        precioReferencia: 40,
      },
    ],
    avios: [],
    artes,
    tallasCurva: [],
    avisosCurva: [],
    ...extra,
  };
}

describe('<EditorBom> — secciones de la receta', () => {
  beforeEach(() => {
    guardarTelasMutate.mockReset();
    guardarAviosMutate.mockReset();
    favoritosMock = { sugeridos: [], yaEnLaReceta: [], sinCantidad: [] };
    curvasMock = { idModelo: 1, yaTieneCurva: false, sugerencias: [] };
  });

  // ── ⭐ V1-E3v (§Post-F9.90) — la sugerencia de favoritos TIENE que verse ──────
  it('la sugerencia de avíos favoritos se ve en la sección de Avíos, no en la de Telas', async () => {
    favoritosMock = {
      sugeridos: [
        {
          idAvio: 7,
          clave: 'ETQ-LAV',
          descripcion: 'Etiqueta de lavado',
          cantidadSugerida: 1,
          unidad: 'pza',
        },
      ],
      yaEnLaReceta: [],
      sinCantidad: [],
    };
    const usuario = userEvent.setup();
    renderConProveedores(<EditorBom ficha={fichaBase()} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    // Arranca en Telas: ahí la sugerencia NO pinta (es de la receta de avíos).
    expect(screen.queryByTestId('sugerencia-avios-favoritos')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('tab-bom-avios'));
    expect(screen.getByTestId('sugerencia-avios-favoritos')).toBeInTheDocument();
    expect(screen.getByTestId('avio-favorito-7')).toHaveTextContent('1 pza');
    // Con la captura intacta, el acto único está disponible.
    expect(screen.getByTestId('aceptar-avios-favoritos')).toBeEnabled();
  });

  it('con un cambio SIN GUARDAR en la captura, aceptar los favoritos queda bloqueado con su razón', async () => {
    favoritosMock = {
      sugeridos: [
        {
          idAvio: 7,
          clave: 'ETQ-LAV',
          descripcion: 'Etiqueta de lavado',
          cantidadSugerida: 1,
          unidad: 'pza',
        },
      ],
      yaEnLaReceta: [],
      sinCantidad: [],
    };
    const usuario = userEvent.setup();
    renderConProveedores(
      <EditorBom
        ficha={fichaBase([], {
          avios: [
            {
              idAvio: 5,
              clave: 'ZIP-01',
              descripcion: 'Cierre',
              consumoPorPrenda: 1,
              paraPreCosto: true,
              paraProduccion: true,
              paraCosto: true,
              consumoPorTalla: false,
              idAvioProveedor: null,
              proveedorAmarrado: null,
              precioCosteo: 4.2,
              origenPrecio: 'mas-barato',
              proveedorPrecio: 'Zippers MX',
              amarreIgnorado: false,
              precioReferencia: 9,
            },
          ],
        })}
        puedeAdministrar
      />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    await usuario.click(screen.getByTestId('tab-bom-avios'));
    expect(screen.getByTestId('aceptar-avios-favoritos')).toBeEnabled();

    // Se teclea un consumo distinto en el avío que ya trae la ficha: hay captura pendiente.
    const consumo = screen.getByTestId('consumo-bom-5');
    await usuario.clear(consumo);
    await usuario.type(consumo, '9');

    expect(screen.getByTestId('aceptar-avios-favoritos')).toBeDisabled();
    expect(screen.getByTestId('favoritos-bloqueado-sin-guardar')).toBeInTheDocument();
  });

  it('guarda TELAS como set completo con lo capturado', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EditorBom ficha={fichaBase()} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.clear(screen.getByTestId('consumo-bom-9'));
    await usuario.type(screen.getByTestId('consumo-bom-9'), '3');
    await usuario.click(screen.getByTestId('guardar-bom-telas'));

    expect(guardarTelasMutate).toHaveBeenCalledTimes(1);
    const args = guardarTelasMutate.mock.calls[0]?.[0] as {
      id: number;
      telas: { idTela: number; consumoPorPrenda: number }[];
    };
    expect(args.id).toBe(1);
    expect(args.telas[0]).toMatchObject({ idTela: 9, consumoPorPrenda: 3 });
  });

  it('el renglón es COMPACTO: las 3 banderas 🔑 viven en el panel expandible (no se perdieron)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EditorBom ficha={fichaBase()} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    // Colapsado: ni las casillas ni el amarre ocupan espacio.
    expect(screen.queryByTestId('pre-costo-bom-9')).not.toBeInTheDocument();
    expect(screen.queryByTestId('detalle-bom-9')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('expandir-bom-9'));
    expect(screen.getByTestId('detalle-bom-9')).toBeInTheDocument();
    expect(screen.getByTestId('pre-costo-bom-9')).toBeChecked();
    expect(screen.getByTestId('produccion-bom-9')).toBeChecked();
    expect(screen.getByTestId('costo-bom-9')).toBeChecked();

    // Desmarcar una bandera se guarda en el set completo.
    await usuario.click(screen.getByTestId('produccion-bom-9'));
    await usuario.click(screen.getByTestId('guardar-bom-telas'));
    const args = guardarTelasMutate.mock.calls[0]?.[0] as {
      telas: { paraProduccion: boolean }[];
    };
    expect(args.telas[0]?.paraProduccion).toBe(false);
  });

  it('AMARRA el precio de la tela a un proveedor y lo manda al guardar (R17)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EditorBom ficha={fichaBase()} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    // Sin amarre, el renglón muestra el precio de catálogo MARCADO como referencia.
    const renglon = screen.getByTestId('renglon-bom-9');
    expect(within(renglon).getByText('referencia')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('expandir-bom-9'));
    await usuario.selectOptions(screen.getByTestId('selector-amarre-tela-9'), '31');

    // Ya amarrado: el renglón dice a quién quedó amarrado y avisa que FALTA GUARDAR. V1-E3e retiró
    // la predicción del precio en cliente: desde §Post-F9.48 el escalón que gana depende de las
    // COMPRAS reales, que el navegador no conoce — adivinarlo sería enseñar una cifra que no costea.
    const fila = screen.getByTestId('renglon-bom-9');
    expect(within(fila).getByText('amarrado: Alsatex')).toBeInTheDocument();
    expect(within(fila).getByText('falta guardar')).toBeInTheDocument();
    // Y mientras tanto sigue mostrando el precio que costea HOY (el de la ficha), no uno inventado.
    expect(within(fila).getByText('$40.00')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('guardar-bom-telas'));
    const args = guardarTelasMutate.mock.calls[0]?.[0] as {
      telas: { idTelaProveedor: number | null }[];
    };
    expect(args.telas[0]?.idTelaProveedor).toBe(31);
  });

  it('⭐ V1-E3e: el renglón que costea con la ÚLTIMA COMPRA REAL lo dice, con su proveedor', () => {
    renderConProveedores(
      <EditorBom
        ficha={fichaBase([], {
          telas: [
            {
              idTela: 9,
              nombre: 'Jersey',
              consumoPorPrenda: 1,
              paraPreCosto: true,
              paraProduccion: true,
              paraCosto: true,
              idTelaProveedor: 31,
              proveedorAmarrado: 'Alsatex',
              precioPorColor: false,
              // El catálogo negociado dice otra cosa; el motor costea lo que de verdad se pagó.
              precioCosteo: 33.5,
              origenPrecio: 'ultimo-precio-compra' as const,
              proveedorPrecio: 'Alsatex',
              amarreIgnorado: false,
              precioReferencia: 40,
            },
          ],
        })}
        puedeAdministrar
      />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    const renglon = screen.getByTestId('renglon-bom-9');
    expect(within(renglon).getByText('$33.50')).toBeInTheDocument();
    expect(within(renglon).getByText('última compra: Alsatex')).toBeInTheDocument();
    // Tener amarre y costear por la última compra a ESE proveedor es lo NORMAL desde §Post-F9.48:
    // no debe gritarse como si el amarre se estuviera ignorando.
    expect(within(renglon).queryByText('amarre sin precio')).not.toBeInTheDocument();
    // Y nunca se enseña el precio de catálogo, que no es el que costea.
    expect(within(renglon).queryByText('$40.00')).not.toBeInTheDocument();
  });

  it('⭐ marca el amarre que cotiza POR COLOR (el base no es el precio que costea)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EditorBom ficha={fichaBase()} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.click(screen.getByTestId('expandir-bom-9'));
    await usuario.selectOptions(screen.getByTestId('selector-amarre-tela-9'), '32');

    const renglon = screen.getByTestId('renglon-bom-9');
    expect(within(renglon).getByText('amarrado: Textiles del Valle')).toBeInTheDocument();
    // Sin este aviso, la receta enseñaría un precio base mientras el motor costea el del color.
    expect(within(renglon).getByText('precio por color')).toBeInTheDocument();
    expect(within(renglon).getByText('falta guardar')).toBeInTheDocument();
  });

  it('⭐ un amarre SIN precio se marca y se muestra el precio que SÍ va a costear', () => {
    // El estado lo manda el SERVIDOR (`amarreIgnorado`): la UI ya no lo deduce del origen.
    renderConProveedores(
      <EditorBom
        ficha={fichaBase([], {
          telas: [
            {
              idTela: 9,
              nombre: 'Jersey',
              consumoPorPrenda: 1,
              paraPreCosto: true,
              paraProduccion: true,
              paraCosto: true,
              idTelaProveedor: 33,
              proveedorAmarrado: 'Sin Precio SA',
              precioPorColor: false,
              precioCosteo: 40,
              origenPrecio: 'referencia' as const,
              proveedorPrecio: null,
              amarreIgnorado: true,
              precioReferencia: 40,
            },
          ],
        })}
        puedeAdministrar
      />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    const renglon = screen.getByTestId('renglon-bom-9');
    expect(within(renglon).getByText('amarre sin precio')).toBeInTheDocument();
    // La tela sin amarre usable costea el precio de CATÁLOGO: es el número que se enseña.
    expect(within(renglon).getByText('$40.00')).toBeInTheDocument();
  });

  it('⭐ C1: con amarre pero la última compra fue a OTRO proveedor, SE GRITA (no queda gris)', () => {
    // Escenario real: Desarrollo amarra a "Alsatex" para fijar la relación negociada pero deja
    // `TelaProveedor.precio` en blanco, y a Alsatex nunca se le compró esa tela. La cascada salta
    // el amarre y costea con la última compra a OTRO ($15). El número es correcto, pero sin este
    // chip Desarrollo cotizaría creyendo que manda su amarre.
    renderConProveedores(
      <EditorBom
        ficha={fichaBase([], {
          telas: [
            {
              idTela: 9,
              nombre: 'Jersey',
              consumoPorPrenda: 1,
              paraPreCosto: true,
              paraProduccion: true,
              paraCosto: true,
              idTelaProveedor: 31,
              proveedorAmarrado: 'Alsatex',
              precioPorColor: false,
              precioCosteo: 15,
              origenPrecio: 'ultimo-precio-compra' as const,
              proveedorPrecio: 'Otro Textil',
              amarreIgnorado: true,
              precioReferencia: 40,
            },
          ],
        })}
        puedeAdministrar
      />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    const renglon = screen.getByTestId('renglon-bom-9');
    expect(within(renglon).getByText('$15.00')).toBeInTheDocument();
    expect(within(renglon).getByText('última compra: Otro Textil')).toBeInTheDocument();
    // ⭐ La alerta que C1 rescató: el amarre no está mandando.
    expect(within(renglon).getByText('amarre sin precio')).toBeInTheDocument();
  });

  it('⭐ SIN amarre el avío muestra el MÁS BARATO con su proveedor, marcado "sin amarrar" (H2b)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <EditorBom
        ficha={fichaBase([], {
          avios: [
            {
              idAvio: 5,
              clave: 'ZIP-01',
              descripcion: 'Cierre',
              consumoPorPrenda: 1,
              paraPreCosto: true,
              paraProduccion: true,
              paraCosto: true,
              consumoPorTalla: false,
              idAvioProveedor: null,
              proveedorAmarrado: null,
              precioCosteo: 4.2,
              origenPrecio: 'mas-barato',
              proveedorPrecio: 'Zippers MX',
              amarreIgnorado: false,
              // El catálogo dice 9, pero el motor NO costea con eso: costea 4.20.
              precioReferencia: 9,
            },
          ],
        })}
        puedeAdministrar
      />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    await usuario.click(screen.getByTestId('tab-bom-avios'));
    const renglon = screen.getByTestId('renglon-bom-5');
    expect(within(renglon).getByText('$4.20')).toBeInTheDocument();
    expect(within(renglon).getByText('el más barato: Zippers MX')).toBeInTheDocument();
    // Se conserva la marca de que NO está negociado (falta amarrarlo).
    expect(within(renglon).getByText('sin amarrar')).toBeInTheDocument();
    // Y NUNCA se enseña el precio de catálogo, que no es el que costea.
    expect(within(renglon).queryByText('$9.00')).not.toBeInTheDocument();
  });

  it('⭐ un avío POR MEDIDA se marca "promedio de medidas" y el amarre NO mueve el precio', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <EditorBom
        ficha={fichaBase([], {
          avios: [
            {
              idAvio: 5,
              clave: 'CIE-MED',
              descripcion: 'Cierre por medida',
              consumoPorPrenda: 1,
              paraPreCosto: true,
              paraProduccion: true,
              paraCosto: true,
              consumoPorTalla: false,
              idAvioProveedor: null,
              proveedorAmarrado: null,
              precioCosteo: 6,
              origenPrecio: 'promedio-medidas',
              proveedorPrecio: null,
              amarreIgnorado: false,
              precioReferencia: 2,
            },
          ],
        })}
        puedeAdministrar
      />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    await usuario.click(screen.getByTestId('tab-bom-avios'));
    const renglon = () => screen.getByTestId('renglon-bom-5');
    expect(within(renglon()).getByText('$6.00')).toBeInTheDocument();
    expect(within(renglon()).getByText('promedio de medidas')).toBeInTheDocument();

    // Amarrar un proveedor NO cambia lo que costea: el promedio gana (regla del precosto).
    await usuario.click(screen.getByTestId('expandir-bom-5'));
    await usuario.selectOptions(screen.getByTestId('selector-amarre-avio-5'), '5');
    expect(within(renglon()).getByText('$6.00')).toBeInTheDocument();
    expect(within(renglon()).getByText('promedio de medidas')).toBeInTheDocument();
  });

  it('al DESAMARRAR un avío el renglón avisa que falta guardar (el precio lo resuelve el servidor)', async () => {
    const usuario = userEvent.setup();
    const ficha = fichaBase([], {
      avios: [
        {
          idAvio: 5,
          clave: 'BTN-01',
          descripcion: 'Botón',
          consumoPorPrenda: 2,
          paraPreCosto: true,
          paraProduccion: true,
          paraCosto: true,
          consumoPorTalla: false,
          idAvioProveedor: 5,
          proveedorAmarrado: 'Botones Caros',
          precioCosteo: 3,
          origenPrecio: 'amarre',
          proveedorPrecio: 'Botones Caros',
          amarreIgnorado: false,
          precioReferencia: 1,
        },
      ],
    });
    renderConProveedores(<EditorBom ficha={ficha} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.click(screen.getByTestId('tab-bom-avios'));
    await usuario.click(screen.getByTestId('expandir-bom-5'));
    await usuario.selectOptions(screen.getByTestId('selector-amarre-avio-5'), '');

    const renglon = screen.getByTestId('renglon-bom-5');
    // Conserva el precio que costea HOY ($3 del amarre) y avisa; NO adivina el escalón nuevo, que
    // desde §Post-F9.48 puede ser la última compra real y el navegador no la conoce.
    expect(within(renglon).getByText('$3.00')).toBeInTheDocument();
    expect(within(renglon).getByText('falta guardar')).toBeInTheDocument();
    expect(within(renglon).queryByText(/amarrado:/)).not.toBeInTheDocument();
  });

  it('la ficha ya trae el amarre por color y el renglón lo marca sin tocar nada', () => {
    renderConProveedores(
      <EditorBom
        ficha={fichaBase([], {
          telas: [
            {
              idTela: 9,
              nombre: 'Jersey',
              consumoPorPrenda: 1,
              paraPreCosto: true,
              paraProduccion: true,
              paraCosto: true,
              idTelaProveedor: 32,
              proveedorAmarrado: 'Textiles del Valle',
              precioPorColor: true,
              precioCosteo: 55,
              origenPrecio: 'amarre' as const,
              proveedorPrecio: 'Textiles del Valle',
              amarreIgnorado: false,
              precioReferencia: 40,
            },
          ],
        })}
        puedeAdministrar
      />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    const renglon = screen.getByTestId('renglon-bom-9');
    expect(within(renglon).getByText('precio por color')).toBeInTheDocument();
    expect(within(renglon).queryByText('referencia')).not.toBeInTheDocument();
  });

  it('AMARRA el proveedor del avío (el par avío–proveedor) y lo manda al guardar', async () => {
    const usuario = userEvent.setup();
    const ficha = fichaBase([], {
      avios: [
        {
          idAvio: 5,
          clave: 'BTN-01',
          descripcion: 'Botón',
          consumoPorPrenda: 2,
          paraPreCosto: true,
          paraProduccion: true,
          paraCosto: true,
          consumoPorTalla: false,
          idAvioProveedor: null,
          proveedorAmarrado: null,
          precioCosteo: 1.2,
          origenPrecio: 'mas-barato' as const,
          proveedorPrecio: 'Botones SA',
          amarreIgnorado: false,
          precioReferencia: 1,
        },
      ],
    });
    renderConProveedores(<EditorBom ficha={ficha} puedeAdministrar />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });

    await usuario.click(screen.getByTestId('tab-bom-avios'));
    await usuario.click(screen.getByTestId('expandir-bom-5'));

    // ⭐ V1-E8a (§Post-F9.97): el selector enseña el precio del proveedor TAL CUAL, sin dividirlo
    // por nada. Hasta aquí esta línea no tenía NINGUNA prueba detrás —lo midió el reviewer: se le
    // podía hacer devolver 999 y las 1615 pruebas del frontend seguían verdes—, y es justo la
    // línea donde vivía la vieja preferencia por el precio "÷ factor de conversión".
    const selector = screen.getByTestId('selector-amarre-avio-5');
    expect(within(selector).getByRole('option', { name: /Botones SA/ }).textContent).toContain(
      '$1.20',
    );
    expect(within(selector).getByRole('option', { name: /Botones Caros/ }).textContent).toContain(
      '$3.00',
    );

    await usuario.selectOptions(selector, '4');
    await usuario.click(screen.getByTestId('guardar-bom-avios'));

    const args = guardarAviosMutate.mock.calls[0]?.[0] as {
      avios: { idAvio: number; idAvioProveedor: number | null }[];
    };
    expect(args.avios[0]).toMatchObject({ idAvio: 5, idAvioProveedor: 4 });
  });

  it('la pestaña Arte muestra la sección de ARTE del modelo (ya no es un set que se guarda)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <EditorBom
        ficha={fichaBase([
          {
            id: 5,
            idModelo: 1,
            descripcion: 'Logo',
            posicion: null,
            puntadas: null,
            precio: 30,
            idTipoArte: 9,
            tipoArte: 'Bordado',
            codigoTipoArte: 'bordado',
            usaPuntadas: true,
            idProveedor: null,
            proveedor: null,
            fotos: [],
            orden: 0,
            creadoEn: '2026-01-01T00:00:00.000Z',
            creadoPorId: null,
            modificadoEn: '2026-01-01T00:00:00.000Z',
            modificadoPorId: null,
          },
        ])}
        puedeAdministrar
      />,
      { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
    );

    await usuario.click(screen.getByTestId('tab-bom-artes'));

    expect(screen.getByTestId('seccion-bom-artes')).toBeInTheDocument();
    expect(screen.getByTestId('renglon-arte-5')).toBeInTheDocument();
    // El arte NO se guarda con "Guardar receta": tiene sus propias acciones.
    expect(screen.queryByTestId('guardar-bom-artes')).not.toBeInTheDocument();
    expect(screen.getByTestId('agregar-arte')).toBeInTheDocument();
  });

  // ── ⭐⭐ V1-E9b pieza B (§Post-F9.135) — LA RECETA COMPARTIDA ES DE SOLO LECTURA ──────────────
  //
  // Un modelo de PRODUCCIÓN nacido de un desarrollo (linaje 1:N) COMPARTE su receta: la ve entera y
  // la edita allá. Sin esto la pantalla ofrecía guardar telas, avíos, medidas, arte y copiar receta
  // sobre una receta que no es suya — y el usuario sólo descubría el problema al recibir el error
  // del servidor, después de teclear.
  describe('la receta HEREDADA (linaje 1:N) se ve pero no se toca', () => {
    /**
     * Un avío YA GUARDADO en la receta. Hace falta para llegar a las dos piezas que la primera
     * entrega dejó sin prueba: el AMARRE del avío y el panel de MEDIDAS POR TALLA (que sólo se monta
     * para avíos guardados, `idsAviosGuardados`).
     */
    const avioGuardado = (): ModeloFicha['avios'] => [
      {
        idAvio: 5,
        clave: 'CIE-01',
        descripcion: 'Cierre',
        consumoPorPrenda: 1,
        paraPreCosto: true,
        paraProduccion: true,
        paraCosto: true,
        consumoPorTalla: true,
        idAvioProveedor: null,
        proveedorAmarrado: null,
        precioCosteo: 4.2,
        origenPrecio: 'referencia' as const,
        proveedorPrecio: null,
        amarreIgnorado: false,
        precioReferencia: 4.2,
      },
    ];

    /** La ficha de un HIJO: la receta que enseña es la de su modelo de desarrollo. */
    const fichaHija = (): ModeloFicha =>
      fichaBase([], {
        idModeloDesarrollo: 7,
        codigoModeloDesarrollo: 'CYA-26-71-001',
        avios: avioGuardado(),
      });

    function pintarHija(): void {
      renderConProveedores(<EditorBom ficha={fichaHija()} puedeAdministrar />, {
        sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
      });
    }

    it('⭐ dice DE QUIÉN es la receta, con el código del desarrollo', () => {
      pintarHija();
      const letrero = screen.getByTestId('receta-del-desarrollo');
      expect(letrero).toHaveTextContent('La receta es del modelo de desarrollo CYA-26-71-001');
      // Y dice a DÓNDE ir con una divergencia de un solo color (decisión de Daniel: va en la OP).
      expect(letrero).toHaveTextContent(/ORDEN de producción/);
    });

    it('🔴 cierra los botones de TELAS: ni guardar, ni agregar, ni capturar', () => {
      pintarHija();
      expect(screen.queryByTestId('guardar-bom-telas')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agregar-tela-bom')).not.toBeInTheDocument();
      // Pero la receta SÍ se ve: es de solo lectura, no está escondida.
      expect(screen.getByTestId('renglon-bom-9')).toBeInTheDocument();
      expect(screen.getByTestId('consumo-bom-9')).toBeDisabled();
    });

    it('🔴 cierra AVÍOS y su sugerencia de favoritos', async () => {
      favoritosMock = {
        sugeridos: [
          {
            idAvio: 7,
            clave: 'ETQ-LAV',
            descripcion: 'Etiqueta de lavado',
            cantidadSugerida: 1,
            unidad: 'pza',
          },
        ],
        yaEnLaReceta: [],
        sinCantidad: [],
      };
      const usuario = userEvent.setup();
      pintarHija();
      await usuario.click(screen.getByTestId('tab-bom-avios'));
      expect(screen.queryByTestId('guardar-bom-avios')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agregar-avio-bom')).not.toBeInTheDocument();
      // La sugerencia de favoritos escribiría en el hijo lo que calculó contra el padre: fuera.
      expect(screen.queryByTestId('sugerencia-avios-favoritos')).not.toBeInTheDocument();
    });

    it('🔴🔴 cierra las MEDIDAS POR TALLA — la sexta pata, y la que se quedó suelta', async () => {
      // ⭐ Ésta es la prueba que faltaba en la primera entrega, y su ausencia dejó viva una
      // regresión real: `<EditorMedidasAvio>` con `puedeAdministrar` en vez de `puedeEditarReceta`
      // sobrevivía la suite entera. No es adorno — el panel tiene SU PROPIO botón y SU PROPIO
      // endpoint (`guardarMedidasAvio`, una de las doce puertas), así que sobre un hijo se teclea
      // la matriz completa para recibir el error del servidor: justo lo que el letrero vino a
      // evitar. La simetría del código no se hereda a las pruebas.
      const usuario = userEvent.setup();
      pintarHija();
      await usuario.click(screen.getByTestId('tab-bom-avios'));
      // El panel por talla vive dentro del cajón del renglón (`renderExtra`), así que primero se
      // expande el avío y luego se abre la matriz.
      await usuario.click(screen.getByTestId('expandir-bom-5'));
      await usuario.click(screen.getByTestId('toggle-medidas-avio-5'));
      expect(screen.getByTestId('panel-medidas-avio-5')).toBeInTheDocument();
      // Se VE (es solo lectura, no está escondida)…
      expect(screen.getByTestId('tabla-tallas-avio-5')).toBeInTheDocument();
      // …y no se puede tocar ni guardar.
      expect(screen.queryByTestId('guardar-medidas-avio-5')).not.toBeInTheDocument();
      expect(screen.getByTestId('consumo-por-talla-5')).toBeDisabled();
      expect(screen.getByTestId('consumo-talla-5-3')).toBeDisabled();
    });

    it('🔴 cierra los AMARRES de precio (R17) de tela y de avío', async () => {
      // El amarre viaja dentro del set-completo de telas/avíos: cambiarlo ES cambiar la receta.
      // Los dos selectores sobrevivían igual que las medidas.
      const usuario = userEvent.setup();
      pintarHija();
      await usuario.click(screen.getByTestId('expandir-bom-9'));
      expect(screen.getByTestId('selector-amarre-tela-9')).toBeDisabled();
      await usuario.click(screen.getByTestId('tab-bom-avios'));
      await usuario.click(screen.getByTestId('expandir-bom-5'));
      expect(screen.getByTestId('selector-amarre-avio-5')).toBeDisabled();
    });

    it('🔴 cierra el ARTE y el "Copiar receta de…"', async () => {
      const usuario = userEvent.setup();
      pintarHija();
      // `copiarBom` con `reemplazar: true` (su default) es la más destructiva de las trece puertas.
      expect(screen.queryByTestId('abrir-copiar-bom')).not.toBeInTheDocument();
      await usuario.click(screen.getByTestId('tab-bom-artes'));
      expect(screen.getByTestId('seccion-bom-artes')).toBeInTheDocument();
      expect(screen.queryByTestId('agregar-arte')).not.toBeInTheDocument();
    });

    it('⭐ y en un modelo NORMAL todo eso sigue abierto (la otra mitad de la regla)', async () => {
      // Sin esta prueba, cerrar los botones para TODO EL MUNDO pasaría las cuatro de arriba.
      const usuario = userEvent.setup();
      renderConProveedores(<EditorBom ficha={fichaBase()} puedeAdministrar />, {
        sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
      });
      expect(screen.queryByTestId('receta-del-desarrollo')).not.toBeInTheDocument();
      expect(screen.getByTestId('guardar-bom-telas')).toBeInTheDocument();
      expect(screen.getByTestId('agregar-tela-bom')).toBeInTheDocument();
      expect(screen.getByTestId('consumo-bom-9')).toBeEnabled();
      expect(screen.getByTestId('abrir-copiar-bom')).toBeInTheDocument();
      await usuario.click(screen.getByTestId('expandir-bom-9'));
      expect(screen.getByTestId('selector-amarre-tela-9')).toBeEnabled();
      await usuario.click(screen.getByTestId('tab-bom-artes'));
      expect(screen.getByTestId('agregar-arte')).toBeInTheDocument();
    });

    it('⭐ y las MEDIDAS y el amarre del AVÍO siguen abiertos en un modelo normal', async () => {
      // La otra mitad de las dos pruebas nuevas de arriba: sin esto, cerrar el panel para todo el
      // mundo las pasaría las dos.
      const usuario = userEvent.setup();
      renderConProveedores(
        <EditorBom ficha={fichaBase([], { avios: avioGuardado() })} puedeAdministrar />,
        { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
      );
      await usuario.click(screen.getByTestId('tab-bom-avios'));
      await usuario.click(screen.getByTestId('expandir-bom-5'));
      expect(screen.getByTestId('selector-amarre-avio-5')).toBeEnabled();
      await usuario.click(screen.getByTestId('toggle-medidas-avio-5'));
      expect(screen.getByTestId('guardar-medidas-avio-5')).toBeInTheDocument();
      expect(screen.getByTestId('consumo-por-talla-5')).toBeEnabled();
      expect(screen.getByTestId('consumo-talla-5-3')).toBeEnabled();
    });

    it('🔑 pero la CURVA del modelo SIGUE editándose: no es receta, es suya', () => {
      // La trampa de esta pantalla: la curva vive dentro del editor de receta y se pasa el MISMO
      // `puedeAdministrar`. Cerrarla "de paso" le quitaría a un modelo de producción la única
      // forma de arreglar sus tallas — y la curva del hijo NO es la del padre (lo dice el propio
      // dominio: `leerMedidasAvio` toma la curva de `idModelo` y las medidas de la receta).
      curvasMock = {
        idModelo: 1,
        yaTieneCurva: false,
        sugerencias: [
          {
            idsTalla: [3, 4],
            etiquetas: ['CH', 'G'],
            nombre: 'Dama CH-G',
            ordenes: 2,
            folios: ['1001'],
            idCurvaExistente: null,
          },
        ],
      };
      pintarHija();
      const sugerida = screen.getByTestId('curva-sugerida-3-4');
      expect(within(sugerida).getByRole('button', { name: /Asignar esta curva/ })).toBeEnabled();
    });
  });
});
