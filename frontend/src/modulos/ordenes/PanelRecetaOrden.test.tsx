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
const editarMutateMock = vi.fn();

vi.mock('@/api/receta-orden', () => ({
  useRecetaOrden: (id: unknown) => useRecetaOrdenMock(id) as unknown,
  useMarcarRecetaRevisada: () => ({ mutate: marcarMutateMock, isPending: false }),
  useLiberarReceta: () => ({ mutate: liberarMutateMock, isPending: false }),
  useQuitarRenglonReceta: () => ({ mutate: quitarMutateMock, isPending: false }),
  useRestaurarRenglonReceta: () => ({ mutate: restaurarMutateMock, isPending: false }),
  useAgregarRenglonReceta: () => ({ mutate: vi.fn(), isPending: false }),
  useEditarRenglonReceta: () => ({ mutate: editarMutateMock, isPending: false }),
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
        modoCaptura: 'consumo',
        unidadMedida: null,
        avisoCaptura: null,
        idAvioProveedor: null,
        proveedorAmarrado: null,
        tallas: [],
        tieneTallas: false,
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
        modoCaptura: 'consumo',
        unidadMedida: null,
        avisoCaptura: null,
        idAvioProveedor: null,
        proveedorAmarrado: null,
        tallas: [],
        tieneTallas: false,
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

describe('Medidas por talla en la OP (§Post-F9.43(c))', () => {
  /** Receta con el botón capturado POR TALLA (dos tallas, una amarrada al catálogo). */
  function conMedidas(): RecetaOrden {
    const base = recetaDePrueba();
    return {
      ...base,
      avios: base.avios.map((a) =>
        a.id === 2
          ? {
              ...a,
              consumoPorTalla: true,
              modoCaptura: 'consumo',
              unidadMedida: null,
              avisoCaptura: null,
              tieneTallas: true,
              tallas: [
                {
                  idTalla: 100,
                  etiqueta: 'CH',
                  consumo: 0.5,
                  enLaOrden: true,
                  idAvioMedida: 7,
                  medidaAmarrada: '15 cm',
                  precioMedida: 3,
                },
                // ⭐ V1-E3c en la OP: la talla G la produce la orden y NO tiene medida capturada.
                // Antes ni siquiera aparecía; ahora se puede capturar desde aquí.
                {
                  idTalla: 101,
                  etiqueta: 'G',
                  consumo: null,
                  enLaOrden: true,
                  idAvioMedida: null,
                  medidaAmarrada: null,
                  precioMedida: null,
                },
              ],
            }
          : a,
      ),
    };
  }

  it('la talla que la orden produce y NO tiene medida se puede CAPTURAR (V1-E3c en la OP)', async () => {
    render(conMedidas());
    await userEvent.click(screen.getByTestId('toggle-medidas-receta-avio-2'));

    // La talla G viene con `consumo: null` = SIN CAPTURAR: campo vacío, no un 0.
    const cajaG = screen.getByTestId('medida-receta-avio-2-101');
    expect(cajaG).toHaveValue(null);
    await userEvent.type(cajaG, '1.2');
    await userEvent.click(screen.getByTestId('guardar-medidas-receta-avio-2'));

    // Set-COMPLETO: viaja la ya capturada (con su amarre) y la recién tecleada.
    expect(editarMutateMock).toHaveBeenCalledWith(
      {
        idOrden: 50,
        tipo: 'avio',
        idRenglon: 2,
        cuerpo: {
          tallas: [
            { idTalla: 100, consumo: 0.5, idAvioMedida: 7 },
            { idTalla: 101, consumo: 1.2, idAvioMedida: null },
          ],
        },
      },
      expect.anything(),
    );
  });

  it('⭐ la talla que la orden YA NO LLEVA no se borra en silencio: viaja en el set-completo', async () => {
    // El PATCH es SET-COMPLETO: lo que no viaja, se borra. Una medida capturada de una talla que
    // esta orden dejó de producir (`enLaOrden: false`) tiene que seguir viajando al editar otra
    // talla — si no, tocar CH borraría la medida de XL sin que nadie se entere. Hoy es correcto
    // por construcción (está en `avio.tallas` y solo se filtran las vacías); esta aserción lo
    // clava para que el próximo refactor no lo rompa sin enterarse.
    const base = conMedidas();
    const conAjena: RecetaOrden = {
      ...base,
      avios: base.avios.map((a) =>
        a.id === 2
          ? {
              ...a,
              tallas: [
                ...a.tallas,
                {
                  idTalla: 102,
                  etiqueta: 'XL',
                  consumo: 0.9,
                  enLaOrden: false,
                  idAvioMedida: 8,
                  medidaAmarrada: '20 cm',
                  precioMedida: 4,
                },
              ],
            }
          : a,
      ),
    };
    render(conAjena);
    await userEvent.click(screen.getByTestId('toggle-medidas-receta-avio-2'));

    // Se ve, marcada, al final — no desaparece de la pantalla.
    expect(screen.getByTestId('medida-receta-avio-2-102')).toHaveValue(0.9);
    expect(screen.getByText('no va en esta orden')).toBeInTheDocument();

    // Y al editar OTRA talla, la de XL viaja intacta (con su amarre).
    await userEvent.type(screen.getByTestId('medida-receta-avio-2-101'), '1.2');
    await userEvent.click(screen.getByTestId('guardar-medidas-receta-avio-2'));
    expect(editarMutateMock).toHaveBeenCalledWith(
      {
        idOrden: 50,
        tipo: 'avio',
        idRenglon: 2,
        cuerpo: {
          tallas: [
            { idTalla: 100, consumo: 0.5, idAvioMedida: 7 },
            { idTalla: 101, consumo: 1.2, idAvioMedida: null },
            { idTalla: 102, consumo: 0.9, idAvioMedida: 8 },
          ],
        },
      },
      expect.anything(),
    );
  });

  it('vaciar una talla ya capturada la BORRA (no viaja como 0)', async () => {
    render(conMedidas());
    await userEvent.click(screen.getByTestId('toggle-medidas-receta-avio-2'));
    await userEvent.clear(screen.getByTestId('medida-receta-avio-2-100'));
    await userEvent.click(screen.getByTestId('guardar-medidas-receta-avio-2'));

    expect(editarMutateMock).toHaveBeenCalledWith(
      { idOrden: 50, tipo: 'avio', idRenglon: 2, cuerpo: { tallas: [] } },
      expect.anything(),
    );
  });

  it('el toggle "se consume por talla" se puede APAGAR desde la orden', async () => {
    render(conMedidas());
    await userEvent.click(screen.getByTestId('toggle-medidas-receta-avio-2'));
    await userEvent.click(screen.getByTestId('consumo-por-talla-receta-2'));

    expect(editarMutateMock).toHaveBeenCalledWith(
      { idOrden: 50, tipo: 'avio', idRenglon: 2, cuerpo: { consumoPorTalla: false } },
      expect.anything(),
    );
  });

  it('sin tallas en la matriz de la orden lo DICE en vez de fingir una matriz', async () => {
    const base = conMedidas();
    render({
      ...base,
      avios: base.avios.map((a) => (a.id === 2 ? { ...a, tieneTallas: false, tallas: [] } : a)),
    });
    await userEvent.click(screen.getByTestId('toggle-medidas-receta-avio-2'));
    expect(screen.getByTestId('sin-tallas-2')).toBeInTheDocument();
    expect(screen.queryByTestId('guardar-medidas-receta-avio-2')).not.toBeInTheDocument();
  });

  it('sin permiso de administrar se ven pero NO se editan', async () => {
    render(conMedidas(), false);
    await userEvent.click(screen.getByTestId('toggle-medidas-receta-avio-2'));
    expect(screen.getByTestId('medida-receta-avio-2-100')).toBeDisabled();
    expect(screen.getByTestId('consumo-por-talla-receta-2')).toBeDisabled();
    expect(screen.queryByTestId('guardar-medidas-receta-avio-2')).not.toBeInTheDocument();
  });
});
