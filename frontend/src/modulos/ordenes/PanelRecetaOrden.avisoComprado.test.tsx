import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClavePermiso } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

/**
 * ⭐⭐⭐ **0.085 — EL AVISO DE «YA ESTÁ COMPRADO» TIENE QUE SOBREVIVIR AL REFETCH.**
 *
 * 🔴 **POR QUÉ ESTE ARCHIVO EXISTE, y por qué NO podía vivir en `PanelRecetaOrden.test.tsx`.**
 *
 * Aquel archivo mockea `@/api/receta-orden` ENTERO, así que el camino real
 * —*mutación → `setQueryData` → `invalidateQueries` → refetch → repintado*— **no se ejercita
 * jamás**. Y ahí estaba el defecto que tumbó la primera versión de esta etapa: `trasMutar`
 * (`api/receta-orden.ts`) mete la receta en caché y **acto seguido** invalida `CLAVE_ORDENES =
 * ['ordenes']`, que por prefijo **también casa** con `['ordenes','receta',id]`. La receta está
 * activa ⇒ se re-pide ⇒ y una LECTURA devuelve `avisoCambioSobreLoComprado: null` **por diseño**
 * (es el eco de una mutación, no estado de la receta). Resultado medido: el bloque rojo parpadeaba
 * lo que dura un round-trip y **desaparecía solo**.
 *
 * Por eso aquí se mockea **una capa más abajo** (`@/api/cliente`, el cliente tipado del OpenAPI) y
 * se usan los **hooks de verdad** con un **`QueryClient` de verdad**, con las mismas opciones que
 * `App.tsx`. Es la única forma de que una prueba pueda ponerse roja por esto.
 *
 * ⚠️ La lectura de este mock devuelve SIEMPRE `avisoCambioSobreLoComprado: null` —igual que el
 * servidor—, así que si el aviso volviera a colgarse de la caché de la query, la última aserción de
 * la primera prueba se cae.
 */

/** Respuesta cruda de `openapi-fetch` (sólo lo que usa la capa de datos). */
type RespuestaApi = { data?: unknown; error?: unknown };

const get = vi.fn<(ruta: string, opciones: unknown) => Promise<RespuestaApi>>();
const patch = vi.fn<(ruta: string, opciones: unknown) => Promise<RespuestaApi>>();

vi.mock('@/api/cliente', () => ({
  api: {
    GET: (ruta: string, opciones: unknown): Promise<RespuestaApi> => get(ruta, opciones),
    PATCH: (ruta: string, opciones: unknown): Promise<RespuestaApi> => patch(ruta, opciones),
    POST: vi.fn(),
    PUT: vi.fn(),
    DELETE: vi.fn(),
  },
}));

const { PanelRecetaOrden } = await import('./PanelRecetaOrden');

const OC = { idOrdenCompra: 900, folio: 12, estatus: 'autorizada' as const, recibida: false };
const AVISO =
  'Acabas de cambiar un material que YA ESTÁ COMPRADO para esta orden: "Jersey" (la orden de ' +
  'compra #12 (autorizada)). La orden de compra NO se corrige sola.';

/** La receta que devuelve el servidor. `aviso` sólo lo pone la MUTACIÓN, nunca la lectura. */
function receta(aviso: string | null): unknown {
  return {
    idOrden: 50,
    folio: 7,
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
    abiertaEn: null,
    abiertaPor: null,
    abiertaMotivo: null,
    ocsComprometidas: [OC],
    avisoCompraComprometida: 'Esta orden ya tiene compra comprometida con el proveedor.',
    avisoCambioSobreLoComprado: aviso,
    avisoCurva: null,
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
        ocsComprometidas: [OC],
      },
    ],
    avios: [],
    artes: [],
    desalineacion: { hayCambios: false, conOrdenCompra: false, critico: false, cambios: [] },
  };
}

const PERMISOS: ClavePermiso[] = ['ordenes.ver', 'desarrollo.administrar'];

function montar(): void {
  renderConProveedores(<PanelRecetaOrden idOrden={50} puedeAdministrar />, {
    sesion: estadoSesionDePrueba(PERMISOS),
    // Las MISMAS opciones que `App.tsx`: si el defecto depende de un reintento o de un refetch,
    // una configuración de prueba más laxa lo escondería.
    queryClient: new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
        mutations: { retry: false },
      },
    }),
  });
}

/** Teclea un precio nuevo en la fila de la tela y sale del campo (así guarda `CeldaNumero`). */
async function cambiarElPrecio(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  const campo = await screen.findByTestId('precio-receta-tela-1');
  await usuario.clear(campo);
  await usuario.type(campo, '77');
  await usuario.tab();
}

describe('⭐⭐⭐ 0.085 — el aviso sobrevive al refetch (hooks y QueryClient REALES)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // La LECTURA nunca trae el aviso: es el eco de una mutación (así contesta el servidor).
    get.mockImplementation(() => Promise.resolve({ data: receta(null) }));
    // La MUTACIÓN sí, porque tocó un renglón ya comprado.
    patch.mockImplementation(() => Promise.resolve({ data: receta(AVISO) }));
  });

  it('🔴 el bloque NO se borra cuando la invalidación re-pide la receta', async () => {
    const usuario = userEvent.setup();
    montar();
    await cambiarElPrecio(usuario);

    // Aparece con el texto REDACTADO por el servidor…
    const bloque = await screen.findByTestId('receta-aviso-ya-comprado');
    expect(bloque).toHaveTextContent('#12 (autorizada)');

    // …y sobrevive al refetch que dispara `invalidateQueries(['ordenes'])`, que casa POR PREFIJO
    // con `['ordenes','receta',50]`. Se espera a que la segunda lectura haya ocurrido de verdad:
    // sin esta espera la prueba pasaría verde midiendo el instante anterior al defecto.
    await waitFor(() => {
      expect(get.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByTestId('receta-aviso-ya-comprado')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('receta-aviso-ya-comprado')).getByTestId('oc-comprometida-12'),
    ).toBeInTheDocument();
  });

  it('la siguiente edición que NO toca nada comprado lo apaga (no se queda pegado)', async () => {
    const usuario = userEvent.setup();
    montar();
    await cambiarElPrecio(usuario);
    await screen.findByTestId('receta-aviso-ya-comprado');

    // Segunda edición: el servidor ya no avisa nada.
    patch.mockImplementation(() => Promise.resolve({ data: receta(null) }));
    const campo = screen.getByTestId('precio-receta-tela-1');
    await usuario.clear(campo);
    await usuario.type(campo, '88');
    await usuario.tab();

    await waitFor(() => {
      expect(screen.queryByTestId('receta-aviso-ya-comprado')).not.toBeInTheDocument();
    });
  });
});
