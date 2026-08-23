import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClavePermiso } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import type * as ReactRouter from 'react-router-dom';

import { OrdenesCompraPagina } from './OrdenesCompraPagina';
import { ocDePrueba } from './fixtures';

// ── Mocks de la capa de datos (sin red) ──────────────────────────────────────
const autorizarMutate = vi.fn();
const duplicarMutate = vi.fn();
const useOrdenesCompraMock = vi.fn();
// Resumen de cabecera (KPIs): cada test lo puede POBLAR; default = vacío.
let resumenOc: { data: { ocAbiertas: number; porRecibir: number } | undefined };

vi.mock('@/api/ordenes-compra', () => ({
  useOrdenesCompra: (q: unknown) => useOrdenesCompraMock(q) as unknown,
  useResumenOc: () => resumenOc,
  useAutorizarOc: () => ({ mutate: autorizarMutate, isPending: false }),
  useDuplicarOc: () => ({ mutate: duplicarMutate, isPending: false }),
  imprimirOc: vi.fn(),
}));

vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [{ id: 5, nombre: 'Telas del Norte' }] } }),
}));

// El botón "Dar entrada a la tela" navega (§Post-F9.15): se espía la navegación.
const { navegar } = vi.hoisted(() => ({ navegar: vi.fn() }));
vi.mock('react-router-dom', async () => {
  const real = await vi.importActual<typeof ReactRouter>('react-router-dom');
  return { ...real, useNavigate: () => navegar };
});

// El detalle abre estos diálogos (montados solo al usarse): se simplifican.
vi.mock('./DialogoEditarOc', () => ({ DialogoEditarOc: () => null }));
vi.mock('./DialogoCancelarOc', () => ({ DialogoCancelarOc: () => null }));
vi.mock('./DialogoDesautorizarOc', () => ({ DialogoDesautorizarOc: () => null }));

/**
 * Una OC en la lista. El default es **borrador**: es el estatus con el que nacen TODAS las OC
 * (alta, duplicado y explosión MRP). El fixture decía `pendiente_autorizacion` — un estatus que
 * NADA escribe jamás — y por eso estas pruebas nunca vieron que ninguna OC nueva se podía
 * autorizar.
 */
function paginaConUna(estatus: ReturnType<typeof ocDePrueba>['estatus'] = 'borrador') {
  useOrdenesCompraMock.mockReturnValue({
    data: {
      datos: [ocDePrueba({ estatus })],
      total: 1,
      pagina: 1,
      porPagina: 10,
      totalPaginas: 1,
    },
    isPending: false,
    isError: false,
    isFetching: false,
  });
}

describe('OrdenesCompraPagina (F4-E2)', () => {
  beforeEach(() => {
    autorizarMutate.mockReset();
    duplicarMutate.mockReset();
    useOrdenesCompraMock.mockReset();
    navegar.mockReset();
    resumenOc = { data: { ocAbiertas: 0, porRecibir: 0 } };
  });

  it('lista las OC y muestra su folio, proveedor y total', () => {
    paginaConUna();
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    expect(screen.getAllByText('OC 1001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Telas del Norte').length).toBeGreaterThan(0);
  });

  it('KPIs con datos: pinta el conteo de OC abiertas y el monto por recibir compacto con sufijo', () => {
    // Fixture POBLADO (antes solo se cubría el resumen vacío ocAbiertas:0 / porRecibir:0).
    paginaConUna();
    resumenOc = { data: { ocAbiertas: 12, porRecibir: 482_500 } };
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });

    const abiertas = screen.getByTestId('kpi-oc-abiertas');
    expect(within(abiertas).getByText('12')).toBeInTheDocument();

    // $482,500 → moneda COMPACTA del tile: "$482.5" con el sufijo "K" como unidad chica.
    const porRecibir = screen.getByTestId('kpi-por-recibir');
    expect(within(porRecibir).getByText('$482.5')).toBeInTheDocument();
    expect(within(porRecibir).getByText('K')).toBeInTheDocument();
  });

  it('muestra el estado VACÍO cuando no hay OC', () => {
    useOrdenesCompraMock.mockReturnValue({
      data: { datos: [], total: 0, pagina: 1, porPagina: 10, totalPaginas: 0 },
      isPending: false,
      isError: false,
      isFetching: false,
    });
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    expect(
      screen.getByText('No hay órdenes de compra que coincidan con la búsqueda.'),
    ).toBeInTheDocument();
  });

  it('muestra el estado de ERROR con el mensaje del backend', () => {
    useOrdenesCompraMock.mockReturnValue({
      isPending: false,
      isError: true,
      error: { message: 'Falló la consulta' },
      isFetching: false,
    });
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    expect(screen.getByText('Falló la consulta')).toBeInTheDocument();
  });

  it('SIN compras.administrar oculta el botón "Nueva OC"', () => {
    paginaConUna();
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    expect(screen.queryByTestId('nuevo-oc')).not.toBeInTheDocument();
  });

  /**
   * LA PRUEBA QUE FIJA EL FLUJO: una OC recién creada (borrador) se puede autorizar. Es el bloqueo
   * que tuvo muerta la cadena de compras — `crearOC`/`duplicarOC`/la explosión MRP dejan la OC en
   * `borrador` y la pantalla sólo ofrecía autorizar desde `pendiente_autorizacion`, que nada
   * escribe. Si alguien vuelve a atar el botón a ese estatus, esto se pone rojo.
   */
  it('una OC recién creada (BORRADOR) SÍ se puede autorizar y dispara la mutación', () => {
    paginaConUna('borrador');
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar', 'compras.autorizar']),
    });
    fireEvent.click(screen.getByTestId('fila-oc'));
    const boton = within(screen.getByTestId('detalle-oc')).getByTestId('autorizar-oc');
    fireEvent.click(boton);
    expect(autorizarMutate).toHaveBeenCalledWith(1, expect.anything());
  });

  it('el botón Autorizar SOLO aparece con compras.autorizar (borrador y pendiente)', () => {
    // Sigue apareciendo en `pendiente_autorizacion` por si algún dato migrado quedara ahí.
    paginaConUna('pendiente_autorizacion');
    const { unmount } = renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar', 'compras.autorizar']),
    });
    // El detalle es un cajón que se abre al hacer clic en el renglón (tabla-first, R9).
    fireEvent.click(screen.getByTestId('fila-oc'));
    const detalle = screen.getByTestId('detalle-oc');
    expect(within(detalle).getByTestId('autorizar-oc')).toBeInTheDocument();
    unmount();

    // Sin el permiso de autorizar, no aparece (A4).
    paginaConUna('borrador');
    const segunda = renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    fireEvent.click(screen.getByTestId('fila-oc'));
    expect(screen.queryByTestId('autorizar-oc')).not.toBeInTheDocument();
    segunda.unmount();

    // Y en una OC ya AUTORIZADA no se ofrece de nuevo.
    paginaConUna('autorizada');
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar', 'compras.autorizar']),
    });
    fireEvent.click(screen.getByTestId('fila-oc'));
    expect(screen.queryByTestId('autorizar-oc')).not.toBeInTheDocument();
  });

  it('una OC autorizada NO ofrece Editar a un no-admin (sí "Ver")', () => {
    paginaConUna('autorizada');
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']),
    });
    fireEvent.click(screen.getByTestId('fila-oc'));
    const detalle = screen.getByTestId('detalle-oc');
    expect(within(detalle).queryByTestId('editar-oc')).not.toBeInTheDocument();
    expect(within(detalle).getByTestId('ver-oc')).toBeInTheDocument();
  });

  it('un ADMIN (roles.administrar) SÍ ve "Editar" en una OC autorizada', () => {
    paginaConUna('autorizada');
    renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar', 'roles.administrar']),
    });
    fireEvent.click(screen.getByTestId('fila-oc'));
    const detalle = screen.getByTestId('detalle-oc');
    expect(within(detalle).getByTestId('editar-oc')).toBeInTheDocument();
    expect(within(detalle).queryByTestId('ver-oc')).not.toBeInTheDocument();
  });

  describe('§Post-F9.15 — dar entrada a la tela desde la OC', () => {
    /** Abre el cajón de detalle de la única OC (tabla-first, R9). */
    function abrirDetalle(): void {
      fireEvent.click(screen.getByTestId('fila-oc'));
    }

    it('con la OC AUTORIZADA y renglón de tela, el botón lleva la orden y su proveedor', () => {
      paginaConUna('autorizada');
      renderConProveedores(<OrdenesCompraPagina />, {
        sesion: estadoSesionDePrueba(['compras.ver', 'inventario-telas.mover']),
      });
      abrirDetalle();

      fireEvent.click(screen.getByTestId('entrada-tela-oc'));
      // El proveedor viaja en el enlace: la captura lo fija sin gastar otra consulta.
      expect(navegar).toHaveBeenCalledWith('/inventarios/telas/entradas/nueva', {
        state: { idOrdenCompra: 1, idProveedor: 5 },
      });
    });

    it('en una OC sin autorizar NO aparece, pero DICE por qué (§Post-F9.16)', () => {
      paginaConUna('borrador');
      renderConProveedores(<OrdenesCompraPagina />, {
        sesion: estadoSesionDePrueba(['compras.ver', 'inventario-telas.mover']),
      });
      abrirDetalle();
      expect(screen.queryByTestId('entrada-tela-oc')).not.toBeInTheDocument();
      expect(screen.getByTestId('oc-sin-entrada-tela')).toHaveTextContent('no está autorizada');
    });

    it('con renglones de TEXTO LIBRE explica que no son telas del catálogo (§Post-F9.16)', () => {
      // El caso real que reportó Daniel: OC migrada, autorizada, llena de renglones… de texto.
      useOrdenesCompraMock.mockReturnValue({
        data: {
          datos: [
            ocDePrueba({
              estatus: 'autorizada',
              lineas: [
                {
                  id: 10,
                  idTela: null,
                  tela: null,
                  nombreComplementoTela: null,
                  cantidadComplemento: null,
                  precioComplemento: null,
                  idAvio: null,
                  avio: null,
                  idAvioProveedor: null,
                  descripcionLibre: 'Terry Ibiza 52% pol.48% alg. Pantone crema 11-0507 tcx',
                  idTelaColor: null,
                  telaColor: null,
                  pantoneTelaColor: null,
                  cantidadSugerida: null,
                  avisoDesvio: null,
                  cantidad: 530,
                  unidad: 'Kilos',
                  precio: 115,
                  subtotal: 60950,
                  idOrden: null,
                  folioOrden: null,
                  tallas: [],
                },
              ],
            }),
          ],
          total: 1,
          pagina: 1,
          porPagina: 10,
          totalPaginas: 1,
        },
        isPending: false,
        isError: false,
        isFetching: false,
      });
      renderConProveedores(<OrdenesCompraPagina />, {
        sesion: estadoSesionDePrueba(['compras.ver', 'inventario-telas.mover']),
      });
      abrirDetalle();

      expect(screen.queryByTestId('entrada-tela-oc')).not.toBeInTheDocument();
      expect(screen.getByTestId('oc-sin-entrada-tela')).toHaveTextContent('TEXTO LIBRE');
    });

    it('sin permiso no aparece NI la nota (la acción no existe para ese usuario, A4)', () => {
      paginaConUna('autorizada');
      renderConProveedores(<OrdenesCompraPagina />, {
        sesion: estadoSesionDePrueba(['compras.ver']),
      });
      abrirDetalle();
      expect(screen.queryByTestId('entrada-tela-oc')).not.toBeInTheDocument();
      expect(screen.queryByTestId('oc-sin-entrada-tela')).not.toBeInTheDocument();
    });
  });
});

/**
 * ⭐ V1-E3y (§Post-F9.79) — el botón de DES-AUTORIZAR: la marcha atrás de la firma de compra.
 *
 * Fija las tres cosas que se pueden romper sin darse cuenta: que existe donde vive la firma, que
 * exige su permiso PROPIO (`compras.desautorizar`, no el de autorizar) y que **solo se ofrece sobre
 * una OC `autorizada`** — una recibida NO se des-autoriza (DANIEL, 20-ago) y una en borrador no
 * tiene sello que quitar. Esconderlo no es la defensa (eso lo hace el servidor), pero ofrecerlo
 * donde no aplica sí es mentirle al usuario.
 */
describe('OrdenesCompraPagina — des-autorizar (V1-E3y)', () => {
  beforeEach(() => {
    useOrdenesCompraMock.mockReset();
    navegar.mockReset();
    resumenOc = { data: { ocAbiertas: 0, porRecibir: 0 } };
  });

  /** Renderiza la pantalla con UNA OC del estatus dado y abre su cajón de detalle. */
  function abrirDetalleCon(
    estatus: ReturnType<typeof ocDePrueba>['estatus'],
    permisos: ClavePermiso[],
  ): { detalle: HTMLElement; unmount: () => void } {
    paginaConUna(estatus);
    const { unmount } = renderConProveedores(<OrdenesCompraPagina />, {
      sesion: estadoSesionDePrueba(permisos),
    });
    fireEvent.click(screen.getByTestId('fila-oc'));
    return { detalle: screen.getByTestId('detalle-oc'), unmount };
  }

  it('aparece en una OC AUTORIZADA cuando se tiene compras.desautorizar', () => {
    const { detalle } = abrirDetalleCon('autorizada', ['compras.ver', 'compras.desautorizar']);
    expect(within(detalle).getByTestId('desautorizar-oc')).toBeInTheDocument();
  });

  it('NO aparece sin el permiso propio (tener compras.autorizar no basta)', () => {
    // Firmar y DESfirmar son llaves distintas: la segunda es la del perfil de Daniel.
    abrirDetalleCon('autorizada', ['compras.ver', 'compras.administrar', 'compras.autorizar']);
    expect(screen.queryByTestId('desautorizar-oc')).not.toBeInTheDocument();
  });

  it('NO aparece en una OC en borrador, ni RECIBIDA, ni cancelada', () => {
    const perm: ClavePermiso[] = ['compras.ver', 'compras.desautorizar'];
    for (const estatus of [
      'borrador',
      'recibida_parcial',
      'recibida_total',
      'cancelada',
    ] as const) {
      const { detalle, unmount } = abrirDetalleCon(estatus, perm);
      expect(within(detalle).queryByTestId('desautorizar-oc')).not.toBeInTheDocument();
      unmount();
    }
  });
});
