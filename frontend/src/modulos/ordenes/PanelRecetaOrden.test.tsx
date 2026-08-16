import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecetaOrden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { PanelRecetaOrden } from './PanelRecetaOrden';

const useRecetaOrdenMock = vi.fn();
const marcarMutateMock = vi.fn();
const liberarMutateMock = vi.fn();
const quitarMutateMock = vi.fn();
const restaurarMutateMock = vi.fn();

vi.mock('@/api/receta-orden', () => ({
  useRecetaOrden: (id: unknown) => useRecetaOrdenMock(id) as unknown,
  useMarcarRecetaRevisada: () => ({ mutate: marcarMutateMock, isPending: false }),
  useLiberarReceta: () => ({ mutate: liberarMutateMock, isPending: false }),
  useQuitarRenglonReceta: () => ({ mutate: quitarMutateMock, isPending: false }),
  useRestaurarRenglonReceta: () => ({ mutate: restaurarMutateMock, isPending: false }),
  useAgregarRenglonReceta: () => ({ mutate: vi.fn(), isPending: false }),
  useEditarRenglonReceta: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Receta base: una tela y dos avíos (uno de ellos, la jareta), sin revisar y sin liberar. */
function recetaDePrueba(over: Partial<RecetaOrden> = {}): RecetaOrden {
  return {
    idOrden: 50,
    folio: 7,
    idModelo: 9,
    codigoModelo: 'A-100',
    liberadaEn: null,
    liberadaPor: null,
    puedeComprar: false,
    resumen: { sinRevisar: 3, revisados: 0, ajustados: 0, excluidos: 0, total: 3 },
    telas: [
      {
        id: 1,
        tipo: 'tela',
        estado: 'sin_revisar',
        agregadoAMano: false,
        excluido: false,
        notas: null,
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
    avios: [
      {
        id: 2,
        tipo: 'avio',
        estado: 'sin_revisar',
        agregadoAMano: false,
        excluido: false,
        notas: null,
        enElModelo: true,
        cambios: [],
        idAvio: 20,
        clave: 'BOT-01',
        descripcion: 'Botón',
        unidad: 'pza',
        esGenerico: false,
        consumoPorPrenda: 2,
        precio: 2,
        paraPreCosto: true,
        paraProduccion: true,
        paraCosto: true,
        consumoPorTalla: false,
        idAvioProveedor: null,
        proveedorAmarrado: null,
        tallas: [],
        consumoModelo: 2,
        precioModelo: 2,
        precioModeloDeCompra: false,
      },
      {
        id: 3,
        tipo: 'avio',
        estado: 'sin_revisar',
        agregadoAMano: false,
        excluido: false,
        notas: null,
        enElModelo: true,
        cambios: [],
        idAvio: 21,
        clave: 'JAR-01',
        descripcion: 'Jareta',
        unidad: 'pza',
        esGenerico: false,
        consumoPorPrenda: 1,
        precio: 8,
        paraPreCosto: true,
        paraProduccion: true,
        paraCosto: true,
        consumoPorTalla: false,
        idAvioProveedor: null,
        proveedorAmarrado: null,
        tallas: [],
        consumoModelo: 1,
        precioModelo: 8,
        precioModeloDeCompra: false,
      },
    ],
    artes: [],
    desalineacion: { hayCambios: false, conOrdenCompra: false, critico: false, cambios: [] },
    ...over,
  };
}

function render(receta: RecetaOrden, puedeAdministrar = true): void {
  useRecetaOrdenMock.mockReturnValue({ data: receta, isPending: false, isError: false });
  renderConProveedores(
    <PanelRecetaOrden idOrden={50} puedeAdministrar={puedeAdministrar} ordenCancelada={false} />,
    { sesion: estadoSesionDePrueba(['ordenes.ver', 'desarrollo.administrar']) },
  );
}

/**
 * La RECETA CONGELADA DE LA ORDEN en pantalla (V1-E3d, §Post-F9.43). Lo que estas pruebas fijan es
 * lo que la pantalla NO puede dejar de decir: si la puerta de compra está abierta o cerrada, que
 * cortar y producir NO se bloquean, y que el aviso de desalineación aparece SOLO cuando el modelo
 * se movió por su cuenta (nunca por la jareta que alguien quitó a propósito).
 */
describe('<PanelRecetaOrden> (V1-E3d)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sin liberar: lo dice, y aclara que cortar y producir NO están bloqueados', () => {
    render(recetaDePrueba());

    expect(screen.getByTestId('receta-sin-liberar')).toBeInTheDocument();
    expect(screen.queryByTestId('receta-liberada')).not.toBeInTheDocument();
    expect(screen.getByText(/Cortar y producir NO están bloqueados/)).toBeInTheDocument();
  });

  it('liberada: lo dice y anuncia que ya se puede comprar', () => {
    render(
      recetaDePrueba({
        liberadaEn: '2026-08-15T10:00:00.000Z',
        liberadaPor: 'usuario-1',
        puedeComprar: true,
        resumen: { sinRevisar: 0, revisados: 3, ajustados: 0, excluidos: 0, total: 3 },
      }),
    );

    expect(screen.getByTestId('receta-liberada')).toBeInTheDocument();
    expect(screen.getByText(/ya se puede explotar el MRP/)).toBeInTheDocument();
  });

  it('⚠️ el botón de «marcar todo revisado» existe (no se pide el OK uno por uno)', async () => {
    const usuario = userEvent.setup();
    render(recetaDePrueba());

    await usuario.click(screen.getByTestId('receta-marcar-revisado'));

    expect(marcarMutateMock).toHaveBeenCalledTimes(1);
    expect(marcarMutateMock.mock.calls[0]?.[0]).toBe(50);
  });

  it('sin nada sin revisar, el botón de marcar todo se apaga (no hay qué marcar)', () => {
    render(
      recetaDePrueba({
        resumen: { sinRevisar: 0, revisados: 3, ajustados: 0, excluidos: 0, total: 3 },
      }),
    );
    expect(screen.getByTestId('receta-marcar-revisado')).toBeDisabled();
  });

  it('sin `desarrollo.administrar` la receta es de SOLO LECTURA (sin botones de acción)', () => {
    render(recetaDePrueba(), false);

    expect(screen.queryByTestId('receta-liberar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receta-marcar-revisado')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quitar-receta-avio-3')).not.toBeInTheDocument();
    // Pero SÍ se ve lo que la orden lleva.
    expect(screen.getByText(/Jareta/)).toBeInTheDocument();
  });

  it('⭐ el renglón EXCLUIDO se ve tachado y NO ofrece "quitar" otra vez', () => {
    const base = recetaDePrueba();
    const receta = {
      ...base,
      avios: base.avios.map((a) =>
        a.id === 3
          ? { ...a, excluido: true, estado: 'ajustado' as const, notas: 'Negociado fuera' }
          : a,
      ),
    };
    render(receta);

    expect(screen.getByText('No va en esta orden')).toBeInTheDocument();
    expect(screen.queryByTestId('quitar-receta-avio-3')).not.toBeInTheDocument();
    // Sí se puede traer de vuelta (sigue en el modelo).
    expect(screen.getByTestId('restaurar-receta-avio-3')).toBeInTheDocument();
  });

  it('quitar un renglón pide confirmación con motivo y explica que el modelo no se toca', async () => {
    const usuario = userEvent.setup();
    render(recetaDePrueba());

    await usuario.click(screen.getByTestId('quitar-receta-avio-3'));

    const dialogo = await screen.findByTestId('dialogo-quitar-renglon-receta');
    expect(within(dialogo).getByText(/El modelo no se toca/)).toBeInTheDocument();
    await usuario.type(screen.getByTestId('motivo-quitar-receta'), 'Negociado');
    await usuario.click(screen.getByTestId('confirmar-quitar-receta'));

    expect(quitarMutateMock).toHaveBeenCalledTimes(1);
    expect(quitarMutateMock.mock.calls[0]?.[0]).toMatchObject({
      idOrden: 50,
      tipo: 'avio',
      idRenglon: 3,
      motivo: 'Negociado',
    });
  });

  it('sin desalineación NO aparece ningún aviso (el caso normal)', () => {
    render(recetaDePrueba());
    expect(screen.queryByTestId('receta-desalineacion')).not.toBeInTheDocument();
  });

  // ⚠️ El aviso "EN EL LUGAR DE LA DECISIÓN" (al explotar el MRP / generar la OC) NO vive aquí:
  // vive en `ExplosionMaterialesPagina` y tiene su propia prueba. Este bloque cubre el SEGUNDO
  // aviso de §Post-F9.43(d): el que se ve al abrir la orden.
  it('el modelo cambió y NO hay OC: aviso normal al abrir la orden', () => {
    render(
      recetaDePrueba({
        desalineacion: {
          hayCambios: true,
          conOrdenCompra: false,
          critico: false,
          cambios: [
            {
              tipo: 'avio',
              idRenglon: 2,
              material: 'BOT-01 — Botón',
              que: 'consumo',
              detalle: 'La cantidad de "BOT-01 — Botón" pasó de 2 a 4 en el modelo.',
            },
          ],
        },
      }),
    );

    const aviso = screen.getByTestId('receta-desalineacion');
    expect(within(aviso).getByText(/Algo se movió desde que se congeló/)).toBeInTheDocument();
    expect(within(aviso).getByText(/pasó de 2 a 4/)).toBeInTheDocument();
  });

  it('⭐ con OC ya hecha el aviso se pinta como CRÍTICO (ahí ya se comprometió dinero)', () => {
    render(
      recetaDePrueba({
        desalineacion: {
          hayCambios: true,
          conOrdenCompra: true,
          critico: true,
          cambios: [
            {
              tipo: 'avio',
              idRenglon: 2,
              material: 'BOT-01 — Botón',
              que: 'precio',
              detalle: 'El precio de "BOT-01 — Botón" pasó de $2.00 a $3.00 en el modelo.',
            },
          ],
        },
      }),
    );

    const aviso = screen.getByTestId('receta-desalineacion');
    expect(
      within(aviso).getByText(/DESPUÉS de que esta orden ya tiene compras/),
    ).toBeInTheDocument();
  });

  it('⭐ un movimiento del PRECIO DE COMPRA con OC hecha NO se pinta en rojo (no es del modelo)', () => {
    render(
      recetaDePrueba({
        desalineacion: {
          hayCambios: true,
          conOrdenCompra: true,
          critico: false, // lo decide el servidor: la causa fue el mercado, no una persona
          cambios: [
            {
              tipo: 'tela',
              idRenglon: 1,
              material: 'Jersey',
              que: 'precio-mercado',
              detalle:
                'La última COMPRA REAL de "Jersey" es de $52.00 y esta orden congeló $50.00. El modelo no cambió: cambió el precio de compra.',
            },
          ],
        },
      }),
    );

    const aviso = screen.getByTestId('receta-desalineacion');
    expect(within(aviso).getByText(/Algo se movió desde que se congeló/)).toBeInTheDocument();
    expect(within(aviso).queryByText(/ya tiene compras/)).not.toBeInTheDocument();
    expect(within(aviso).getByText(/El modelo no cambió/)).toBeInTheDocument();
  });

  it('el renglón que el modelo movió lleva su propio chip "El modelo cambió"', () => {
    const base = recetaDePrueba();
    const receta = {
      ...base,
      avios: base.avios.map((a) =>
        a.id === 2 ? { ...a, cambios: ['consumo' as const], consumoModelo: 4 } : a,
      ),
    };
    render(receta);
    expect(screen.getByText('El modelo cambió')).toBeInTheDocument();
  });
});
