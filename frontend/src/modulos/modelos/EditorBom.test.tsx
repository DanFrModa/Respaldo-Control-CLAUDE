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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/api/modelos', () => ({
  useReemplazarTelasBom: () => ({ mutate: guardarTelasMutate, isPending: false }),
  useReemplazarAviosBom: () => ({ mutate: guardarAviosMutate, isPending: false }),
  useCopiarBom: () => ({ mutate: vi.fn(), isPending: false }),
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
        precioUnidadConsumo: 1.2,
        condiciones: null,
      },
      {
        idProveedor: 5,
        nombreProveedor: 'Botones Caros',
        precio: 3,
        precioUnidadConsumo: 3,
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
// El panel de consumo por talla tiene su propia capa de datos (se prueba en su archivo).
vi.mock('@/api/modelo-medidas', () => ({
  useMedidasAvio: () => ({ data: undefined, isPending: true, isError: false, error: null }),
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
  useFotoArte: () => ({ data: null, isPending: false, isError: false }),
  useSubirFotoArte: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarFotoArte: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] }, isPending: false }),
}));

/** Ficha mínima con una tela en la receta y el arte/avíos que se le pasen. */
function fichaBase(
  artes: ModeloFicha['artes'] = [],
  extra: Partial<ModeloFicha> = {},
): ModeloFicha {
  return {
    id: 1,
    codigo: '501',
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
    ...extra,
  };
}

describe('<EditorBom> — secciones de la receta', () => {
  beforeEach(() => {
    guardarTelasMutate.mockReset();
    guardarAviosMutate.mockReset();
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
    await usuario.selectOptions(screen.getByTestId('selector-amarre-avio-5'), '4');
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
            nombre: 'Logo',
            descripcion: null,
            puntadas: null,
            precio: 30,
            tipo: 'BORDADO',
            idProveedor: null,
            proveedor: null,
            idArchivoFoto: null,
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
});
