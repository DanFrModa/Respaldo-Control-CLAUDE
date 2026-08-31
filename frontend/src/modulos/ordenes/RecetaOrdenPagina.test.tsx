import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClavePermiso, RecetaOrden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { RecetaOrdenPagina } from './RecetaOrdenPagina';

// Tipado a propósito: sin la firma, `mock.calls` es `any[]` y la aserción de identidad de la orden
// —la que impide que el encabezado y las tablas miren a OPs distintas— se escribiría sobre `any`.
const useRecetaOrdenMock = vi.fn<(id: number | undefined) => unknown>();

vi.mock('@/api/receta-orden', () => ({
  useRecetaOrden: (id: number | undefined) => useRecetaOrdenMock(id),
  useMarcarRecetaRevisada: () => ({ mutate: vi.fn(), isPending: false }),
  useLiberarReceta: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarRenglonReceta: () => ({ mutate: vi.fn(), isPending: false }),
  useRestaurarRenglonReceta: () => ({ mutate: vi.fn(), isPending: false }),
  useAgregarRenglonReceta: () => ({ mutate: vi.fn(), isPending: false }),
  useEditarRenglonReceta: () => ({ mutate: vi.fn(), isPending: false }),
  useTraerDelModelo: () => ({ mutate: vi.fn(), isPending: false }),
  useCorregirCapturaAvio: () => ({ mutate: vi.fn(), isPending: false }),
  // ⭐⭐ V1-E8z — el candado de compra. `PanelRecetaOrden` los consume, así que el mock los tiene
  // que exportar o el módulo entero revienta al montar (no es un detalle del mock: es la lista
  // completa de lo que la pantalla necesita del API).
  useAbrirReceta: () => ({ mutate: vi.fn(), isPending: false }),
  useCerrarReceta: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/api/medidas-avio', () => ({
  useMedidasAvio: () => ({ data: { datos: [] } }),
}));

function receta(over: Partial<RecetaOrden> = {}): RecetaOrden {
  return {
    idOrden: 50,
    folio: 1234,
    idModelo: 9,
    codigoModelo: 'A-100',
    cliente: 'C&A',
    fechaEntrega: '2026-09-30',
    estado: 'capturada',
    totalPiezas: 1200,
    liberadaEn: null,
    liberadaPor: null,
    puedeComprar: false,
    todoLiberado: false,
    // ⭐⭐ V1-E8z: la receta NO está reabierta (el candado de compra, §Post-F9.160(a)).
    abiertaEn: null,
    abiertaPor: null,
    abiertaMotivo: null,
    resumen: {
      sinRevisar: 1,
      revisados: 0,
      ajustados: 0,
      excluidos: 0,
      total: 1,
      liberados: 0,
      porLiberar: 1,
    },
    telas: [
      {
        id: 1,
        tipo: 'tela',
        estado: 'sin_revisar',
        agregadoAMano: false,
        excluido: false,
        notas: null,
        liberadoEn: null,
        liberadoPor: null,
        enElModelo: true,
        cambios: [],
        idTela: 10,
        nombre: 'Jersey',
        unidad: 'kg',
        consumoPorPrenda: 1.5,
        precio: 50,
        paraPreCosto: true,
        paraProduccion: true,
        paraCosto: true,
        idTelaProveedor: null,
        proveedorAmarrado: null,
        consumoModelo: 1.5,
        precioModelo: 50,
        precioModeloDeCompra: false,
      },
    ],
    avios: [],
    artes: [],
    avisoCurva: null,
    desalineacion: { hayCambios: false, conOrdenCompra: false, critico: false, cambios: [] },
    ...over,
  };
}

function render(
  datos: RecetaOrden,
  permisos: ClavePermiso[] = ['desarrollo.ver', 'desarrollo.administrar', 'ordenes.ver'],
): void {
  useRecetaOrdenMock.mockReturnValue({ data: datos, isPending: false, isError: false });
  renderConProveedores(
    <Routes>
      <Route path="/produccion/ordenes/:id/receta" element={<RecetaOrdenPagina />} />
      <Route path="/produccion/ordenes" element={<p>CENTRO DE ÓRDENES</p>} />
      <Route path="/desarrollo/recetas-por-liberar" element={<p>BANDEJA</p>} />
    </Routes>,
    { sesion: estadoSesionDePrueba(permisos), rutaInicial: '/produccion/ordenes/50/receta' },
  );
}

/**
 * LA PANTALLA PROPIA DE LA RECETA (V1-E3j). Daniel: *"debería de haber una pantalla especial para ir
 * liberando. Ahí mismo en el cuadrito chiquito no se ve toda la información."*
 */
describe('<RecetaOrdenPagina> (V1-E3j)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * ⚠️ ESTA PANTALLA LEE LA ORDEN **DOS VECES**, y las dos tienen que ser la misma: una para el
   * ENCABEZADO (aquí) y otra dentro de `PanelRecetaOrden` para las TABLAS. Son dos call sites
   * distintos sobre un mock compartido, así que un `toHaveBeenCalledWith(50)` a secas —lo que había—
   * lo satisface CUALQUIERA de las dos: apuntar el encabezado a otra orden dejaba las 9 pruebas
   * verdes, y apuntar las tablas también (las dos mutaciones sobrevivían).
   *
   * Lo que eso deja pasar: el encabezado dice *«Receta de la OP 1234 · C&A · 1,200 pzas»* y las
   * tablas de abajo —con sus botones «Liberar»— son de OTRA OP. En la pantalla donde se firma el
   * material que abre la compra.
   *
   * Por eso se afirma la LISTA COMPLETA de llamadas: dos, y las dos con la orden de la ruta.
   */
  it('lee la orden de la RUTA y pide SU receta en SUS DOS lecturas (encabezado y tablas)', () => {
    render(receta());

    const ordenesPedidas = useRecetaOrdenMock.mock.calls.map((c) => c[0]);
    expect(ordenesPedidas).toEqual([50, 50]);
    // La gemela negativa, explícita: ninguna lectura mira a otra orden.
    expect(ordenesPedidas.some((id) => id !== 50)).toBe(false);
  });

  it('⭐ el encabezado dice en qué OP estás sin volver atrás', () => {
    render(receta());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Receta de la OP 1234');
    const encabezado = screen.getByTestId('receta-encabezado-orden');
    expect(encabezado).toHaveTextContent('A-100');
    expect(encabezado).toHaveTextContent('C&A');
    expect(encabezado).toHaveTextContent('1,200');
    expect(encabezado).toHaveTextContent('2026-09-30');
  });

  it('monta la receta completa (tablas, no un resumen)', () => {
    render(receta());
    expect(screen.getByTestId('receta-orden')).toBeInTheDocument();
    expect(screen.getByTestId('receta-seccion-telas')).toBeInTheDocument();
    expect(screen.getByTestId('liberar-receta-tela-1')).toBeInTheDocument();
  });

  it('una ORDEN CANCELADA se marca y su receta queda de solo lectura (lo dice el servidor)', () => {
    render(receta({ estado: 'cancelada' }));

    expect(screen.getByTestId('receta-orden-cancelada')).toBeInTheDocument();
    // Con `desarrollo.administrar` en la sesión: lo que apaga la edición es el ESTADO de la orden.
    // (V1-E3k: se mira el botón DEL RENGLÓN; `receta-liberar`, el de bloque, ya no existe para
    // nadie, así que preguntar por él aquí sería una aserción que nunca puede ponerse roja.)
    expect(screen.queryByTestId('liberar-receta-tela-1')).not.toBeInTheDocument();
  });

  it('sin `desarrollo.administrar` se VE pero no se toca (§Post-F9.68)', () => {
    render(receta(), ['desarrollo.ver', 'ordenes.ver']);

    expect(screen.getByTestId('receta-orden')).toBeInTheDocument();
    expect(screen.queryByTestId('liberar-receta-tela-1')).not.toBeInTheDocument();
  });

  /**
   * ⚠️ V1-E3j (hallazgo del reviewer): `Number('abc')` es NaN y NaN **no** es `undefined`, así que
   * el `enabled` del hook lo dejaba pasar y salía una petición a `/api/ordenes/NaN/receta` mientras
   * la pantalla ya decía que la dirección no sirve.
   */
  it('⭐ una dirección con id no numérico lo dice y NO consulta al servidor', () => {
    useRecetaOrdenMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    renderConProveedores(
      <Routes>
        <Route path="/produccion/ordenes/:id/receta" element={<RecetaOrdenPagina />} />
      </Routes>,
      {
        sesion: estadoSesionDePrueba(['desarrollo.ver']),
        rutaInicial: '/produccion/ordenes/abc/receta',
      },
    );

    expect(screen.getByTestId('receta-orden-invalida')).toBeInTheDocument();
    // El hook se llama, pero SIN orden: así queda deshabilitado y no sale ninguna petición.
    expect(useRecetaOrdenMock).toHaveBeenCalledWith(undefined);
    expect(useRecetaOrdenMock).not.toHaveBeenCalledWith(NaN);
  });

  it('vuelve a la bandeja de Desarrollo', async () => {
    const usuario = userEvent.setup();
    render(receta());
    await usuario.click(screen.getByTestId('receta-ir-bandeja'));
    expect(screen.getByText('BANDEJA')).toBeInTheDocument();
  });

  it('⭐ «Ver la orden» solo se pinta con `ordenes.ver` (nunca un enlace muerto)', async () => {
    const usuario = userEvent.setup();
    render(receta());
    await usuario.click(screen.getByTestId('receta-ir-orden'));
    expect(screen.getByText('CENTRO DE ÓRDENES')).toBeInTheDocument();
  });

  it('…y SIN `ordenes.ver` esa salida no existe, pero la receta sigue abriéndose', () => {
    // El caso que la etapa vino a habilitar: Desarrollo puro, sin permiso sobre la OP.
    render(receta(), ['desarrollo.ver', 'desarrollo.administrar']);

    expect(screen.queryByTestId('receta-ir-orden')).not.toBeInTheDocument();
    expect(screen.getByTestId('receta-orden')).toBeInTheDocument();
    // ⭐ V1-E3k (§Post-F9.80): la prueba de que la receta llegó OPERABLE es el botón de firmar DEL
    // RENGLÓN (antes se miraba `receta-liberar`, el botón de bloque, que ya no existe).
    expect(screen.getByTestId('liberar-receta-tela-1')).toBeInTheDocument();
  });
});
