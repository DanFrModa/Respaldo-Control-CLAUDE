import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClavePermiso, RecetaOrden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { PanelRecetaOrden } from './PanelRecetaOrden';

const useRecetaOrdenMock = vi.fn();
const marcarMutateMock = vi.fn();
const liberarMutateMock = vi.fn();
const quitarMutateMock = vi.fn();
const restaurarMutateMock = vi.fn();
const editarMutateMock = vi.fn();
const traerMutateMock = vi.fn();
const corregirMutateMock = vi.fn();
/** ⭐⭐ V1-E8z — el candado de compra: abrir (con motivo) y cerrar. */
const abrirMutateMock = vi.fn();
const cerrarMutateMock = vi.fn();

/**
 * El catálogo de medidas del avío (para el amarre por talla). Por defecto VACÍO: sólo las pruebas
 * del modo `medida` (V1-E3g) lo llenan.
 */
const catalogoMedidas = vi.fn<
  () => {
    data: {
      datos: {
        id: number;
        medida: string;
        valor: number | null;
        precio: number;
        activo: boolean;
      }[];
    };
  }
>(() => ({ data: { datos: [] } }));

vi.mock('@/api/medidas-avio', () => ({
  useMedidasAvio: () => catalogoMedidas(),
}));

vi.mock('@/api/receta-orden', () => ({
  useRecetaOrden: (id: unknown) => useRecetaOrdenMock(id) as unknown,
  useMarcarRecetaRevisada: () => ({ mutate: marcarMutateMock, isPending: false }),
  useLiberarReceta: () => ({ mutate: liberarMutateMock, isPending: false }),
  useQuitarRenglonReceta: () => ({ mutate: quitarMutateMock, isPending: false }),
  useRestaurarRenglonReceta: () => ({ mutate: restaurarMutateMock, isPending: false }),
  useAgregarRenglonReceta: () => ({ mutate: vi.fn(), isPending: false }),
  useEditarRenglonReceta: () => ({ mutate: editarMutateMock, isPending: false }),
  useTraerDelModelo: () => ({ mutate: traerMutateMock, isPending: false }),
  useCorregirCapturaAvio: () => ({ mutate: corregirMutateMock, isPending: false }),
  useAbrirReceta: () => ({ mutate: abrirMutateMock, isPending: false }),
  useCerrarReceta: () => ({ mutate: cerrarMutateMock, isPending: false }),
}));

/** Receta base: una tela y dos avíos (uno de ellos, la jareta), sin revisar y sin liberar. */
function recetaDePrueba(over: Partial<RecetaOrden> = {}): RecetaOrden {
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
    // ⭐⭐ V1-E8z: la receta NO está reabierta (el candado de compra, §Post-F9.160(a)).
    abiertaEn: null,
    abiertaPor: null,
    abiertaMotivo: null,
    // ⭐⭐⭐ 0.085 (§Post-F9.173(a)): por default esta orden NO tiene compra comprometida.
    ocsComprometidas: [],
    avisoCompraComprometida: null,
    avisoCambioSobreLoComprado: null,
    resumen: {
      sinRevisar: 3,
      revisados: 0,
      ajustados: 0,
      excluidos: 0,
      total: 3,
      liberados: 0,
      porLiberar: 3,
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
        ocsComprometidas: [],
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
        liberadoEn: null,
        liberadoPor: null,
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
        capturaReparable: false,
        idAvioProveedor: null,
        proveedorAmarrado: null,
        tallas: [],
        tieneTallas: false,
        consumoModelo: 2,
        precioModelo: 2,
        precioModeloDeCompra: false,
        ocsComprometidas: [],
      },
      {
        id: 3,
        tipo: 'avio',
        estado: 'sin_revisar',
        agregadoAMano: false,
        excluido: false,
        notas: null,
        liberadoEn: null,
        liberadoPor: null,
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
        capturaReparable: false,
        idAvioProveedor: null,
        proveedorAmarrado: null,
        tallas: [],
        tieneTallas: false,
        consumoModelo: 1,
        precioModelo: 8,
        precioModeloDeCompra: false,
        ocsComprometidas: [],
      },
    ],
    artes: [],
    avisoCurva: null,
    desalineacion: { hayCambios: false, conOrdenCompra: false, critico: false, cambios: [] },
    ...over,
  };
}

function render(
  receta: RecetaOrden,
  puedeAdministrar = true,
  // ⭐ 0.085: `compras.ver` decide si los chips de «ya comprado» llevan a la OC o solo informan.
  // ⚠️ Tipado como `ClavePermiso[]`: un `as never` apagaba la comprobación de que el permiso
  // EXISTE, que es justo lo que hace útil a esta lista (un typo pasaría verde sin permisos).
  permisos: ClavePermiso[] = ['ordenes.ver', 'desarrollo.administrar'],
): void {
  useRecetaOrdenMock.mockReturnValue({ data: receta, isPending: false, isError: false });
  renderConProveedores(<PanelRecetaOrden idOrden={50} puedeAdministrar={puedeAdministrar} />, {
    sesion: estadoSesionDePrueba(permisos),
  });
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

  it('liberada COMPLETA: lo dice y anuncia que ya se puede comprar', () => {
    render(
      recetaDePrueba({
        liberadaEn: '2026-08-15T10:00:00.000Z',
        liberadaPor: 'usuario-1',
        puedeComprar: true,
        todoLiberado: true,
        resumen: {
          sinRevisar: 0,
          revisados: 3,
          ajustados: 0,
          excluidos: 0,
          total: 3,
          liberados: 3,
          porLiberar: 0,
        },
      }),
    );

    expect(screen.getByTestId('receta-liberada')).toBeInTheDocument();
    expect(screen.getByText(/ya se puede explotar el MRP/)).toBeInTheDocument();
  });

  it('⭐ V1-E3h: LIBERADA EN PARTE es un tercer estado, y dice cuánto falta firmar', () => {
    render(
      recetaDePrueba({
        // Hay algo firmado (se puede comprar) pero NO todo: el caso que la etapa vino a habilitar.
        puedeComprar: true,
        todoLiberado: false,
        resumen: {
          sinRevisar: 0,
          revisados: 3,
          ajustados: 0,
          excluidos: 0,
          total: 3,
          liberados: 1,
          porLiberar: 2,
        },
      }),
    );

    expect(screen.getByTestId('receta-en-parte')).toHaveTextContent('2 por firmar');
    expect(screen.queryByTestId('receta-liberada')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receta-sin-liberar')).not.toBeInTheDocument();
    // Y se dice lo que de verdad importa: lo pendiente NO entra a la explosión del comprador.
    expect(screen.getByText(/NO entran a la explosión de materiales/)).toBeInTheDocument();
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
        resumen: {
          sinRevisar: 0,
          revisados: 3,
          ajustados: 0,
          excluidos: 0,
          total: 3,
          liberados: 0,
          porLiberar: 3,
        },
      }),
    );
    expect(screen.getByTestId('receta-marcar-revisado')).toBeDisabled();
  });

  it('sin `desarrollo.administrar` la receta es de SOLO LECTURA (sin botones de acción)', () => {
    render(recetaDePrueba(), false);

    // El botón de firmar vive AHORA en cada renglón (V1-E3k): es ése el que no debe aparecer.
    expect(screen.queryByTestId('liberar-receta-avio-3')).not.toBeInTheDocument();
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

  /*
   * ⭐ V1-E3r (§Post-F9.81) — EL AVISO DE CURVA DISTINTA. Es el caso de Daniel: un modelo dado de
   * alta desde una OC de bebés con la receta capturada en tallas de caballero. El texto lo redacta
   * el SERVIDOR; esta pantalla sólo lo pinta — si lo re-escribiera, la receta y la ficha del modelo
   * acabarían diciendo cosas distintas del mismo desajuste.
   */
  describe('aviso de curva distinta (V1-E3r)', () => {
    const texto =
      'La curva del modelo («Caballero básica»: XC, CH, M, G, XG) no coincide con las tallas de ' +
      'esta orden («Curva 3M-6M-9M»: 3M, 6M, 9M): … No bloquea.';

    it('sin aviso no pinta el banner', () => {
      render(recetaDePrueba());
      expect(screen.queryByTestId('receta-aviso-curva')).not.toBeInTheDocument();
    });

    it('pinta el texto del servidor TAL CUAL', () => {
      render(recetaDePrueba({ avisoCurva: texto }));
      expect(screen.getByTestId('receta-aviso-curva')).toHaveTextContent('Caballero básica');
      expect(screen.getByText(texto)).toBeInTheDocument();
    });

    it('🔴 NO bloquea: la receta se sigue pintando y se sigue pudiendo operar', () => {
      render(recetaDePrueba({ avisoCurva: texto }));
      expect(screen.getByTestId('receta-orden')).toBeInTheDocument();
      expect(screen.getByTestId('receta-aviso-curva')).toBeInTheDocument();
    });
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
              idMaterialModelo: null,
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
              idMaterialModelo: null,
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
              idMaterialModelo: null,
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

/**
 * ⭐ V1-E3g (§Post-F9.66) — el renglón de avío captura por talla UNA cosa, no dos: la CANTIDAD
 * (elástico, con la unidad pegada) o la MEDIDA (cierres). El modo lo manda el servidor.
 */
describe('PanelRecetaOrden — modo de captura por talla (V1-E3g)', () => {
  beforeEach(() => {
    editarMutateMock.mockReset();
    catalogoMedidas.mockReturnValue({
      data: { datos: [{ id: 7, medida: '53 cm', valor: 53, precio: 6, activo: true }] },
    });
  });

  /** La receta con el botón en modo `medida` y una talla en la orden. */
  function enModoMedida(): RecetaOrden {
    const base = recetaDePrueba();
    return {
      ...base,
      avios: base.avios.map((a) =>
        a.id === 2
          ? {
              ...a,
              modoCaptura: 'medida' as const,
              unidadMedida: 'cm',
              tieneTallas: true,
              tallas: [
                {
                  idTalla: 100,
                  etiqueta: 'CH',
                  consumo: 1,
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

  it('en modo `medida` no hay checkbox ni campo de cantidad; guarda SIN consumo', async () => {
    render(enModoMedida());
    await userEvent.click(screen.getByTestId('toggle-medidas-receta-avio-2'));

    expect(screen.queryByTestId('consumo-por-talla-receta-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('medida-receta-avio-2-100')).not.toBeInTheDocument();
    expect(screen.getByTestId('modo-medida-receta-2')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByTestId('medida-amarre-receta-avio-2-100'), '7');
    await userEvent.click(screen.getByTestId('guardar-medidas-receta-avio-2'));

    const args = editarMutateMock.mock.calls[0]?.[0] as {
      cuerpo: { consumoPorTalla: boolean; tallas: { idTalla: number; idAvioMedida: number }[] };
    };
    expect(args.cuerpo.consumoPorTalla).toBe(false);
    expect(args.cuerpo.tallas).toEqual([{ idTalla: 100, idAvioMedida: 7 }]);
  });

  /**
   * ⭐⭐ §Post-F9.105 — **SIN ABRIR NADA.** Antes este aviso se pintaba DENTRO del desplegable «(por
   * talla: …)», que nace cerrado: se podía tener la contradicción delante durante meses —y comprar
   * 53 veces el cierre— sin verla nunca. La prueba vieja hacía clic en el toggle antes de mirar, o
   * sea que certificaba justo el defecto. Ahora se exige lo contrario: que esté a la vista **de
   * entrada**, en la fila.
   */
  it('⭐ el aviso de la contradicción se ve SIN abrir el desplegable (§Post-F9.105)', async () => {
    const base = enModoMedida();
    render({
      ...base,
      avios: base.avios.map((a) =>
        a.id === 2
          ? {
              ...a,
              consumoPorTalla: true,
              avisoCaptura:
                'Este avío se compra POR MEDIDA… se están pidiendo 530 pza en vez de 20 pza.',
            }
          : a,
      ),
    });
    // Nadie ha tocado el desplegable: el aviso ya está en pantalla, con su magnitud.
    expect(screen.queryByTestId('panel-medidas-receta-avio-2')).not.toBeInTheDocument();
    const aviso = screen.getByTestId('aviso-captura-receta-avio-2');
    expect(aviso).toHaveTextContent('POR MEDIDA');
    expect(aviso).toHaveTextContent('530 pza');

    // Y sigue sin bloquear: se puede abrir y guardar (avisa, NO frena — §Post-F9.64).
    await userEvent.click(screen.getByTestId('toggle-medidas-receta-avio-2'));
    expect(screen.getByTestId('guardar-medidas-receta-avio-2')).toBeEnabled();
    // No se repite dentro del cajón: dos copias del mismo texto se leen como dos problemas.
    expect(screen.getAllByTestId('aviso-captura-receta-avio-2')).toHaveLength(1);
  });

  /**
   * ⭐⭐⭐ **V1-E8h (§Post-F9.130) — EL AVISO TRAE SU REMEDIO.** Daniel, 27-ago-2026: *"Siento que
   * estamos atorados en lo mismo desde hace varias versiones. No podemos desatorarlo."* No estaba
   * atorado el cálculo —el motor lleva sano desde el 18-ago—, sino el **remedio**: el aviso cerraba
   * con *"guarda el renglón para normalizarlo"*, un conjuro que un no-programador no puede adivinar.
   * Lo que esta prueba fija es que el botón viva **pegado al aviso**, no en un menú aparte.
   */
  it('⭐⭐ el aviso trae el botón «Corregir» AL LADO, y repara ese renglón', async () => {
    const base = enModoMedida();
    render({
      ...base,
      avios: base.avios.map((a) =>
        a.id === 2
          ? {
              ...a,
              consumoPorTalla: true,
              capturaReparable: true,
              avisoCaptura: 'Esta orden pide 53,095 pza y deberían ser 3,200 pza…',
            }
          : a,
      ),
    });

    // El botón está DENTRO de la caja del aviso: es la parte que no se puede perder.
    const aviso = screen.getByTestId('aviso-captura-receta-avio-2');
    const boton = within(aviso).getByTestId('corregir-captura-receta-avio-2');
    expect(boton).toHaveTextContent('Corregir');

    await userEvent.click(boton);

    expect(corregirMutateMock).toHaveBeenCalledTimes(1);
    expect(corregirMutateMock.mock.calls[0]?.[0]).toEqual({ idOrden: 50, idRenglon: 2 });
  });

  /**
   * 🔴 **NO todo aviso es reparable, y quién lo decide es el SERVIDOR.** `avisoCaptura` también
   * cubre un número absurdo para la unidad, que se arregla capturando bien — no con un botón. La
   * pantalla NO lee el texto para adivinarlo (A1): mira `capturaReparable`.
   */
  it('🔴 con aviso pero SIN `capturaReparable` no hay botón (ese aviso no se repara solo)', () => {
    const base = enModoMedida();
    render({
      ...base,
      avios: base.avios.map((a) =>
        a.id === 2
          ? {
              ...a,
              capturaReparable: false,
              avisoCaptura: 'El consumo de la talla CH (500 cm) queda fuera de lo normal…',
            }
          : a,
      ),
    });
    expect(screen.getByTestId('aviso-captura-receta-avio-2')).toBeInTheDocument();
    expect(screen.queryByTestId('corregir-captura-receta-avio-2')).not.toBeInTheDocument();
  });

  /** Sin `desarrollo.administrar` el aviso se LEE (hay que saberlo) pero no se puede reparar. */
  it('🔴 sin permiso de administrar la receta el aviso se ve, pero sin botón', () => {
    const base = enModoMedida();
    render(
      {
        ...base,
        avios: base.avios.map((a) =>
          a.id === 2
            ? {
                ...a,
                consumoPorTalla: true,
                capturaReparable: true,
                avisoCaptura: 'Esta orden pide 53,095 pza y deberían ser 3,200 pza…',
              }
            : a,
        ),
      },
      false,
    );
    expect(screen.getByTestId('aviso-captura-receta-avio-2')).toBeInTheDocument();
    expect(screen.queryByTestId('corregir-captura-receta-avio-2')).not.toBeInTheDocument();
  });

  it('en modo `consumo` la unidad del avío se ve pegada al campo', async () => {
    const base = recetaDePrueba();
    render({
      ...base,
      avios: base.avios.map((a) =>
        a.id === 2
          ? {
              ...a,
              consumoPorTalla: true,
              tieneTallas: true,
              tallas: [
                {
                  idTalla: 100,
                  etiqueta: 'CH',
                  consumo: 0.5,
                  enLaOrden: true,
                  idAvioMedida: null,
                  medidaAmarrada: null,
                  precioMedida: null,
                },
              ],
            }
          : a,
      ),
    });
    await userEvent.click(screen.getByTestId('toggle-medidas-receta-avio-2'));
    const fila = screen.getByTestId('medida-receta-avio-2-100').closest('span');
    expect(fila).not.toBeNull();
    expect(within(fila as HTMLElement).getByText('pza')).toBeInTheDocument();
  });
});

/**
 * ⭐ V1-E3h — LA RECETA SE LIBERA POR PARTES (§Post-F9.72) y lo que falta SE JALA DEL MODELO
 * (§Post-F9.73). Lo que estas pruebas fijan es lo que la pantalla no puede dejar de hacer:
 *
 *  • que la firma se vea y se ponga POR RENGLÓN (sin esto, Desarrollo no puede liberar "el resto"
 *    dejando fuera el cierre que el cliente no ha autorizado — el caso de Daniel);
 *  • ⭐ V1-E3k (§Post-F9.80): que NO exista ninguna forma de firmar en bloque — ni «Liberar todo lo
 *    que falta» ni los tres botones por sección. Se comprueban POR NOMBRE, uno por uno: una prueba
 *    que solo dijera "algún botón desapareció" no probaría nada;
 *  • que el aviso de "el modelo lleva X y esta orden no" traiga SU botón, y que mande el material
 *    correcto — el `idMaterialModelo` es lo único que distingue "traer éste" de "traer todo".
 */
describe('<PanelRecetaOrden> · liberar por partes y traer del modelo (V1-E3h)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cada renglón dice si está firmado o no', () => {
    const base = recetaDePrueba();
    render({
      ...base,
      telas: base.telas.map((t) => ({
        ...t,
        liberadoEn: '2026-08-19T10:00:00.000Z',
        liberadoPor: 'u1',
      })),
    });

    const filaTela = screen.getByTestId('consumo-receta-tela-1').closest('tr');
    expect(within(filaTela as HTMLElement).getByText('Liberado')).toBeInTheDocument();
    const filaAvio = screen.getByTestId('consumo-receta-avio-2').closest('tr');
    expect(within(filaAvio as HTMLElement).getByText('Sin firmar')).toBeInTheDocument();
  });

  it('⭐ se firma UN renglón, y viaja NOMBRADO: solo ese id, sin comodín', async () => {
    const usuario = userEvent.setup();
    render(recetaDePrueba());

    await usuario.click(screen.getByTestId('liberar-receta-avio-3'));

    expect(liberarMutateMock).toHaveBeenCalledTimes(1);
    // `toEqual` es lo que da valor a esta prueba: si el cuerpo volviera a llevar `alcance` (o el
    // renglón del vecino), la comparación falla. El id 3 es la JARETA; el 2, el otro avío.
    expect(liberarMutateMock.mock.calls[0]?.[0]).toEqual({
      idOrden: 50,
      cuerpo: { renglones: [{ tipo: 'avio', id: 3 }] },
    });
  });

  it('⭐ y el renglón de al lado manda SU id, no el mismo (la firma identifica, no solo dispara)', async () => {
    const usuario = userEvent.setup();
    render(recetaDePrueba());

    await usuario.click(screen.getByTestId('liberar-receta-avio-2'));

    expect(liberarMutateMock.mock.calls[0]?.[0]).toEqual({
      idOrden: 50,
      cuerpo: { renglones: [{ tipo: 'avio', id: 2 }] },
    });
  });

  it('⭐ y la TELA manda tipo `tela` con su propio id (los tres tipos no se confunden)', async () => {
    const usuario = userEvent.setup();
    render(recetaDePrueba());

    await usuario.click(screen.getByTestId('liberar-receta-tela-1'));

    expect(liberarMutateMock.mock.calls[0]?.[0]).toEqual({
      idOrden: 50,
      cuerpo: { renglones: [{ tipo: 'tela', id: 1 }] },
    });
  });

  it('el renglón YA firmado no vuelve a ofrecer el botón de firmar', () => {
    const base = recetaDePrueba();
    render({
      ...base,
      avios: base.avios.map((a) =>
        a.id === 3 ? { ...a, liberadoEn: '2026-08-19T10:00:00.000Z', liberadoPor: 'u1' } : a,
      ),
    });
    expect(screen.queryByTestId('liberar-receta-avio-3')).not.toBeInTheDocument();
    expect(screen.getByTestId('liberar-receta-avio-2')).toBeInTheDocument();
  });

  /**
   * ⭐⭐ V1-E3k (§Post-F9.80) — **YA NO SE OFRECE FIRMAR EN BLOQUE**, y se comprueba NOMBRANDO los
   * cuatro botones que existían. DANIEL, 20-ago-2026: *"me parece una mala idea el botón de «Liberar
   * todo lo que falta»… no tiene sentido liberar las cosas sin ver"*.
   *
   * Los cuatro testids son los que tenía la pantalla en V1-E3j: si alguien los reintroduce, esta
   * prueba se pone roja. Y va acompañada de la gemela POSITIVA —la firma por renglón sigue viva—
   * para que no pueda pasar por el trivial "no se montó nada".
   */
  it('⭐ NO existe ningún botón de firmar en bloque: ni el global ni los tres por sección', () => {
    render(recetaDePrueba());

    expect(screen.queryByTestId('receta-liberar')).toBeNull(); // «Liberar todo lo que falta»
    expect(screen.queryByTestId('receta-liberar-telas')).toBeNull(); // «Liberar todas las telas»
    expect(screen.queryByTestId('receta-liberar-avios')).toBeNull(); // «Liberar todos los avíos»
    expect(screen.queryByTestId('receta-liberar-artes')).toBeNull(); // «Liberar todo el arte»
    // …y no es que la pantalla esté vacía: la firma UNO POR UNO sigue ahí, en cada renglón vivo.
    expect(screen.getByTestId('liberar-receta-tela-1')).toBeInTheDocument();
    expect(screen.getByTestId('liberar-receta-avio-2')).toBeInTheDocument();
    expect(screen.getByTestId('liberar-receta-avio-3')).toBeInTheDocument();
  });

  it('⭐ y tampoco por texto: no hay nada que diga «liberar todo/todas/todos» (§Post-F9.68)', () => {
    render(recetaDePrueba());

    // Por si el botón volviera con otro testid: lo que Daniel vio y rechazó fue el TEXTO.
    expect(screen.queryByText(/liberar todo/i)).toBeNull();
    expect(screen.queryByText(/liberar todas/i)).toBeNull();
    // Lo que SÍ sobrevive —Daniel lo eligió— es «marcar todo revisado»: no libera nada.
    expect(screen.getByTestId('receta-marcar-revisado')).toHaveTextContent('Marcar todo revisado');
  });

  it('sin `desarrollo.administrar` no se pinta NINGÚN botón de firmar', () => {
    render(recetaDePrueba(), false);
    expect(screen.queryByTestId('liberar-receta-tela-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('liberar-receta-avio-3')).not.toBeInTheDocument();
  });

  /**
   * ⭐ LA LÁPIDA NO SE FIRMA (§Post-F9.72). Un renglón excluido no se compra, así que no le falta
   * firma a nadie: no pinta chip de firma ni ofrece firmarse. (Hasta V1-E3k esto también cuidaba
   * el conteo del botón de bloque «Liberar todas las telas (2)», que ya no existe.)
   */
  function conLapida(): RecetaOrden {
    const base = recetaDePrueba();
    return {
      ...base,
      // La JARETA queda quitada de esta orden (el caso de negocio de la etapa).
      avios: base.avios.map((a) =>
        a.id === 3 ? { ...a, excluido: true, estado: 'ajustado' as const } : a,
      ),
    };
  }

  it('⭐ la LÁPIDA no pinta chip de firma ni ofrece firmarse', () => {
    render(conLapida());

    // Un renglón excluido no es editable, así que su celda numérica no lleva testid: la fila se
    // encuentra por el nombre del avío, que es lo que de verdad la identifica en pantalla.
    const filaLapida = screen.getByText(/JAR-01/).closest('tr');
    expect(within(filaLapida as HTMLElement).getByText('No va en esta orden')).toBeInTheDocument();
    expect(within(filaLapida as HTMLElement).queryByText('Sin firmar')).toBeNull();
    expect(within(filaLapida as HTMLElement).queryByText('Liberado')).toBeNull();
    expect(screen.queryByTestId('liberar-receta-avio-3')).toBeNull();
    // El renglón VIVO de al lado sí las tiene (si no, la prueba pasaría por no montarse nada).
    expect(screen.getByTestId('liberar-receta-avio-2')).toBeInTheDocument();
  });

  /** Receta con DOS faltantes del modelo (los únicos que «traer del modelo» resuelve). */
  function conFaltantes(): RecetaOrden {
    return recetaDePrueba({
      desalineacion: {
        hayCambios: true,
        conOrdenCompra: false,
        critico: false,
        cambios: [
          {
            tipo: 'avio',
            idRenglon: null,
            material: 'E01 — Etiqueta de lavado',
            idMaterialModelo: 77,
            que: 'agregado',
            detalle: 'El modelo ahora lleva "E01 — Etiqueta de lavado", y esta orden no lo tiene.',
          },
          {
            tipo: 'tela',
            idRenglon: null,
            material: 'Rib',
            idMaterialModelo: 88,
            que: 'agregado',
            detalle: 'El modelo ahora lleva "Rib", y esta orden no lo tiene.',
          },
        ],
      },
    });
  }

  it('⭐ el aviso del FALTANTE trae su botón, y manda ESE material (§Post-F9.73)', async () => {
    const usuario = userEvent.setup();
    render(conFaltantes());

    await usuario.click(screen.getByTestId('traer-del-modelo-avio-77'));

    expect(traerMutateMock.mock.calls[0]?.[0]).toEqual({
      idOrden: 50,
      cuerpo: { materiales: [{ tipo: 'avio', idAvio: 77 }] },
    });
  });

  it('con varios faltantes hay además el botón de traerlos TODOS de un jalón', async () => {
    const usuario = userEvent.setup();
    render(conFaltantes());

    const todos = screen.getByTestId('traer-del-modelo-todo');
    expect(todos).toHaveTextContent('(2)');
    await usuario.click(todos);

    // Sin `cuerpo` = "todo lo que falte" (lo decide el servidor, no esta pantalla).
    expect(traerMutateMock.mock.calls[0]?.[0]).toEqual({ idOrden: 50 });
  });

  it('un cambio que NO es faltante (el modelo movió el consumo) no ofrece traer nada', () => {
    render(
      recetaDePrueba({
        desalineacion: {
          hayCambios: true,
          conOrdenCompra: false,
          critico: false,
          cambios: [
            {
              tipo: 'tela',
              idRenglon: 1,
              material: 'Jersey',
              idMaterialModelo: null,
              que: 'consumo',
              detalle: 'La cantidad de "Jersey" pasó de 1.5 a 2 en el modelo.',
            },
          ],
        },
      }),
    );
    expect(screen.queryByTestId('traer-del-modelo-todo')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^traer-del-modelo-/)).not.toBeInTheDocument();
  });

  it('sin `desarrollo.administrar` el aviso se ve pero SIN botones de traer (§Post-F9.68)', () => {
    render(conFaltantes(), false);
    expect(screen.getByTestId('receta-desalineacion')).toBeInTheDocument();
    expect(screen.queryByTestId('traer-del-modelo-avio-77')).not.toBeInTheDocument();
    expect(screen.queryByTestId('traer-del-modelo-todo')).not.toBeInTheDocument();
    // …y como el llamado no se pinta, el aviso SÍ tiene que seguir enumerando los faltantes: si se
    // los "omitiera" también aquí, un usuario de solo lectura no se enteraría de que faltan.
    expect(screen.getByText(/El modelo ahora lleva "Rib"/)).toBeInTheDocument();
  });

  // ══ V1-E3j · LA JERARQUÍA ES EL ENTREGABLE ═══════════════════════════════════════════════════
  //
  // El defecto que originó la etapa NO fue de lógica: el botón que resolvía el problema de Daniel
  // estaba en pantalla y no lo vio, porque un mensaje más ruidoso se llevó la atención. Estas
  // pruebas fijan el ORDEN y el TONO, que es lo único que puede volver a romperse en silencio: un
  // refactor que "solo mueve bloques" pasaría todas las demás pruebas de este archivo.

  it('⭐ V1-E3j: el llamado de «traer del modelo» va ANTES del estado de la receta, en el DOM', () => {
    render(conFaltantes());

    const llamado = screen.getByTestId('receta-traer-llamado');
    const cabecera = screen.getByTestId('receta-cabecera');
    // `DOCUMENT_POSITION_FOLLOWING` = la cabecera viene DESPUÉS del llamado. Si alguien vuelve a
    // poner el aviso arriba y la salida abajo, esto se pone rojo — que es el punto entero.
    expect(llamado.compareDocumentPosition(cabecera) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('⭐ V1-E3j: con el llamado arriba, el aviso amarillo NO repite los mismos faltantes', () => {
    render(conFaltantes());

    // Los dos cambios de `conFaltantes()` son faltantes: el aviso se queda sin nada que decir y no
    // se pinta. Un recuadro de alarma junto a la salida es exactamente lo que la escondió.
    expect(screen.getByTestId('receta-traer-llamado')).toBeInTheDocument();
    expect(screen.queryByTestId('receta-desalineacion')).not.toBeInTheDocument();
  });

  it('⭐ V1-E3j: un faltante y un cambio normal → el faltante arriba, el otro en el aviso', () => {
    const base = conFaltantes();
    render({
      ...base,
      desalineacion: {
        ...base.desalineacion,
        cambios: [
          base.desalineacion.cambios[0] as (typeof base.desalineacion.cambios)[number],
          {
            tipo: 'tela',
            idRenglon: 1,
            material: 'Jersey',
            idMaterialModelo: null,
            que: 'consumo',
            detalle: 'La cantidad de "Jersey" pasó de 1.5 a 2 en el modelo.',
          },
        ],
      },
    });

    const llamado = screen.getByTestId('receta-traer-llamado');
    expect(within(llamado).getByText(/Etiqueta de lavado/)).toBeInTheDocument();
    expect(within(llamado).queryByText(/Jersey/)).toBeNull();
    const aviso = screen.getByTestId('receta-desalineacion');
    expect(within(aviso).getByText(/pasó de 1.5 a 2/)).toBeInTheDocument();
    expect(within(aviso).queryByText(/Etiqueta de lavado/)).toBeNull();
  });

  it('⭐ V1-E3j: con UN SOLO faltante ya hay botón de «traer»; antes exigía dos', () => {
    const base = conFaltantes();
    render({
      ...base,
      desalineacion: {
        ...base.desalineacion,
        cambios: [base.desalineacion.cambios[0] as (typeof base.desalineacion.cambios)[number]],
      },
    });

    // El caso de Daniel era EXACTAMENTE éste (unos avíos que el modelo ganó después): con un solo
    // faltante, la única salida era un enlacito de texto dentro de una viñeta.
    expect(screen.getByTestId('traer-del-modelo-todo')).toHaveTextContent('(1)');
  });

  it('⭐ V1-E3j: un «agregado» SIN id de material no se ofrece traer (no hay qué pedirle al servidor)', () => {
    const base = conFaltantes();
    render({
      ...base,
      desalineacion: {
        ...base.desalineacion,
        cambios: [
          {
            tipo: 'avio',
            idRenglon: null,
            material: 'Fantasma',
            // Sin traza al BOM no hay material que mandar: pedirlo con un id inventado sería una
            // llamada que el backend tendría que rechazar. Se informa, pero no se ofrece.
            idMaterialModelo: null,
            que: 'agregado',
            detalle: 'El modelo ahora lleva "Fantasma", y esta orden no lo tiene.',
          },
        ],
      },
    });

    expect(screen.queryByTestId('receta-traer-llamado')).not.toBeInTheDocument();
    expect(screen.queryByTestId('traer-del-modelo-todo')).not.toBeInTheDocument();
    // Pero NO se calla (D3): sigue enunciado en el aviso.
    expect(
      within(screen.getByTestId('receta-desalineacion')).getByText(/Fantasma/),
    ).toBeInTheDocument();
  });

  /**
   * ⭐ V1-E3j — ORDEN CANCELADA + FALTANTES (hallazgo del reviewer). El llamado cuelga de
   * `editable`, que es `puedeAdministrar` **y** orden viva; el código era correcto pero NADA lo
   * sostenía: relajarlo a solo `puedeAdministrar` dejaba las 51 pruebas verdes. Con esa mutación,
   * una OP cancelada con faltantes pinta «Traer del modelo» — y el backend los rechaza por
   * `exigirOrdenViva`, o sea el letrero de error que esta etapa vino a eliminar.
   */
  it('⭐ V1-E3j: una orden CANCELADA con faltantes NO ofrece traer del modelo', () => {
    render({ ...conFaltantes(), estado: 'cancelada' });

    expect(screen.queryByTestId('receta-traer-llamado')).not.toBeInTheDocument();
    expect(screen.queryByTestId('traer-del-modelo-todo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('traer-del-modelo-avio-77')).not.toBeInTheDocument();
    // Pero NO se calla lo que pasa (D3): el aviso vuelve a hacerse cargo de enunciar los faltantes.
    expect(screen.getByText(/El modelo ahora lleva "Rib"/)).toBeInTheDocument();
  });

  it('…y la MISMA receta con la orden VIVA sí lo ofrece (la gemela positiva)', () => {
    render(conFaltantes());
    expect(screen.getByTestId('receta-traer-llamado')).toBeInTheDocument();
  });

  /**
   * ⭐ V1-E3j — §Post-F9.68 regla 1 (hallazgo del reviewer). La columna de acciones se ensanchó y
   * ganó título («Acciones»), y con eso se volvió VISIBLE que existía siempre: quien solo tiene
   * `desarrollo.ver` —o cualquiera mirando una OP cancelada— veía tres tablas con una columna de
   * 13rem enteramente vacía. Daniel: *"si un dato desaparece por permiso, se va con su encabezado;
   * una celda vacía haría creer que falló"*.
   */
  it('⭐ V1-E3j: sin poder firmar, la columna «Acciones» se va CON SU ENCABEZADO', () => {
    render(recetaDePrueba(), false);

    expect(screen.queryByText('Acciones')).toBeNull();
    // Y no queda una celda huérfana: la fila tiene una columna menos que su encabezado si se rompe.
    const filaTela = screen.getByText('Jersey').closest('tr') as HTMLElement;
    const encabezados = screen.getAllByRole('columnheader');
    expect(filaTela.querySelectorAll('td')).toHaveLength(
      encabezados.filter((h) => h.closest('table') === filaTela.closest('table')).length,
    );
  });

  it('…y CON `desarrollo.administrar` la columna «Acciones» sí está (gemela positiva)', () => {
    render(recetaDePrueba());
    // Dos, no tres: la receta base no lleva arte, y una sección vacía no pinta tabla.
    expect(screen.getAllByText('Acciones')).toHaveLength(2);
  });

  it('⭐ V1-E3j: con la orden CANCELADA tampoco hay columna de acciones (no es solo el permiso)', () => {
    render({ ...recetaDePrueba(), estado: 'cancelada' });
    expect(screen.queryByText('Acciones')).toBeNull();
  });

  it('⭐ V1-E3j: una receta VACÍA lo dice en tono neutro, y no ofrece firmar nada', () => {
    render(
      recetaDePrueba({
        telas: [],
        avios: [],
        artes: [],
        resumen: {
          sinRevisar: 0,
          revisados: 0,
          ajustados: 0,
          excluidos: 0,
          total: 0,
          liberados: 0,
          porLiberar: 0,
        },
      }),
    );

    expect(screen.getByText(/todavía no tiene ningún material/)).toBeInTheDocument();
    // Sin renglones no hay botón de firmar, porque el botón vive EN el renglón (V1-E3k).
    expect(screen.queryByTestId('liberar-receta-tela-1')).toBeNull();
    expect(screen.queryByTestId('liberar-receta-avio-2')).toBeNull();
  });

  it('…y con renglones sí hay dónde firmar, uno por uno (la gemela positiva de la de arriba)', () => {
    render(recetaDePrueba());
    expect(screen.getByTestId('liberar-receta-tela-1')).toBeInTheDocument();
    expect(screen.getByTestId('liberar-receta-avio-2')).toBeInTheDocument();
    expect(screen.queryByText(/todavía no tiene ningún material/)).toBeNull();
  });

  it('⭐ V1-E3j: firmar UNO POR UNO es un botón CON TEXTO, no un ícono mudo', () => {
    render(recetaDePrueba());

    // Daniel, sobre la bandeja: *"no veo dónde pueda ver todo completo e ir liberando una por
    // una"*. El nombre accesible es lo que hace visible la acción.
    expect(screen.getByTestId('liberar-receta-avio-2')).toHaveAccessibleName(/liberar/i);
    expect(screen.getByTestId('liberar-receta-avio-2')).toHaveTextContent('Liberar');
  });
});

/**
 * ⭐⭐⭐ EL CANDADO DE COMPRA EN PANTALLA (V1-E8z, §Post-F9.160(a)) — DANIEL: *"pongamos un candado
 * que no se pueda comprar nada hasta que esté cerrado otra vez"*.
 *
 * 🔴 LO QUE ESTAS PRUEBAS EXISTEN PARA IMPEDIR, y es el defecto natural de esta etapa: como reabrir
 * **sólo marca y no desfirma**, `todoLiberado` sigue en `true` mientras la receta está abierta. Una
 * pantalla que lea sólo esa bandera enseña **«Receta liberada · ya se puede comprar»** mientras el
 * servidor rechaza toda compra con un 409. El letrero mintiendo justo sobre lo único que importa.
 */
describe('<PanelRecetaOrden> · el candado de compra (V1-E8z)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Receta liberada COMPLETA — el único estado desde el que el servidor deja reabrir. */
  function liberadaCompleta(over: Partial<RecetaOrden> = {}): RecetaOrden {
    return recetaDePrueba({
      liberadaEn: '2026-08-30T10:00:00.000Z',
      liberadaPor: 'usuario-1',
      puedeComprar: true,
      todoLiberado: true,
      resumen: {
        sinRevisar: 0,
        revisados: 3,
        ajustados: 0,
        excluidos: 0,
        total: 3,
        liberados: 3,
        porLiberar: 0,
      },
      ...over,
    });
  }

  it('🔴 con la receta ABIERTA no dice «liberada»: dice que la compra está CONGELADA', () => {
    render(
      liberadaCompleta({
        // Reabrir NO desfirma: `todoLiberado` sigue en true y ésa es toda la trampa.
        abiertaEn: '2026-08-31T09:00:00.000Z',
        abiertaPor: 'usuario-1',
        abiertaMotivo: 'el cliente cambió el cierre',
        puedeComprar: false,
      }),
    );

    expect(screen.getByTestId('receta-en-correccion')).toBeInTheDocument();
    expect(screen.queryByTestId('receta-liberada')).not.toBeInTheDocument();
    expect(screen.getByTestId('receta-aviso-en-correccion')).toHaveTextContent(/congelada/);
    // El motivo se ENSEÑA: es lo que el comprador va a leer en su 409, y quien mira la orden tiene
    // que poder saber qué está esperando sin ir a preguntar.
    expect(screen.getByText(/el cliente cambió el cierre/)).toBeInTheDocument();
    // Y NO se repite el letrero viejo, que aquí sería falso de facto.
    expect(screen.queryByText(/ya se puede explotar el MRP/)).not.toBeInTheDocument();
  });

  it('abierta: se ofrece CERRAR y desaparece «Abrir» (son los dos lados del mismo interruptor)', () => {
    render(liberadaCompleta({ abiertaEn: '2026-08-31T09:00:00.000Z', puedeComprar: false }));

    expect(screen.getByTestId('receta-cerrar')).toBeInTheDocument();
    expect(screen.queryByTestId('receta-abrir')).not.toBeInTheDocument();
  });

  it('cerrada y liberada completa: se ofrece ABRIR y no CERRAR', () => {
    render(liberadaCompleta());

    expect(screen.getByTestId('receta-abrir')).toBeInTheDocument();
    expect(screen.queryByTestId('receta-cerrar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receta-en-correccion')).not.toBeInTheDocument();
  });

  it('⚠️ sin liberar NO se ofrece abrir: el servidor lo rechazaría (no hay nada que reabrir)', () => {
    render(recetaDePrueba());

    expect(screen.queryByTestId('receta-abrir')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receta-cerrar')).not.toBeInTheDocument();
  });

  it('sin `desarrollo.administrar` la receta es de solo lectura: ni abrir ni cerrar', () => {
    render(liberadaCompleta({ abiertaEn: '2026-08-31T09:00:00.000Z' }), false);

    expect(screen.queryByTestId('receta-abrir')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receta-cerrar')).not.toBeInTheDocument();
    // Pero el estado SÍ se ve: la compra congelada le importa a quien sólo mira.
    expect(screen.getByTestId('receta-en-correccion')).toBeInTheDocument();
  });

  it('⭐ abrir EXIGE motivo: el botón no se habilita vacío, y el motivo viaja tal cual', async () => {
    const usuario = userEvent.setup();
    render(liberadaCompleta());

    await usuario.click(screen.getByTestId('receta-abrir'));
    const confirmar = screen.getByTestId('confirmar-abrir-receta');
    expect(confirmar).toBeDisabled();
    expect(abrirMutateMock).not.toHaveBeenCalled();

    await usuario.type(
      screen.getByTestId('motivo-abrir-receta'),
      '  el cliente cambió el cierre  ',
    );
    expect(confirmar).toBeEnabled();
    await usuario.click(confirmar);

    expect(abrirMutateMock).toHaveBeenCalledTimes(1);
    expect(abrirMutateMock.mock.calls[0]?.[0]).toEqual({
      idOrden: 50,
      cuerpo: { motivo: 'el cliente cambió el cierre' },
    });
  });

  /**
   * 🔴🔴 **H2 — LA SALIDA DEL CANDADO EN UNA ORDEN CANCELADA** (hallazgo del reviewer).
   *
   * El dominio permite cerrar una receta abierta aunque la OP esté cancelada
   * (`permitirOrdenCancelada`) **exactamente para que el candado no sea una trampa**… y la pantalla
   * escondía el botón, porque colgaba de `editable = puedeAdministrar && estado !== 'cancelada'`.
   *
   * Escenario del reviewer: una OC borrador agrupa la OP 500 y la 501 (§Post-F9.86). Desarrollo abre
   * la receta de la 500 y el cliente cancela esa OP. `autorizarOC` contesta 409 nombrando la 500
   * **para siempre**: no hay botón aquí, no hay fila en la bandeja (excluye canceladas) y ningún
   * mensaje sugiere la única salida real. Sin esta prueba, `permitirOrdenCancelada` era código
   * muerto.
   */
  it('🔴 H2: la orden CANCELADA con la receta abierta SIGUE ofreciendo «Cerrar»', () => {
    render(
      liberadaCompleta({
        estado: 'cancelada',
        abiertaEn: '2026-08-31T09:00:00.000Z',
        abiertaMotivo: 'el cliente cambió el cierre',
        puedeComprar: false,
      }),
    );

    expect(screen.getByTestId('receta-cerrar')).toBeInTheDocument();
    // …y el estado se sigue viendo: la compra de esa OP está congelada y hay que decirlo.
    expect(screen.getByTestId('receta-en-correccion')).toBeInTheDocument();
  });

  it('…pero en esa MISMA cancelada abierta no se cuela «Abrir» ni «marcar revisado»', () => {
    // ⚠️ El escenario tiene que ser el de ARRIBA (cancelada **y abierta**), no una cancelada a
    // secas: en ésa no se pinta ningún botón y la prueba pasaría sin comprobar nada. Aquí el bloque
    // SÍ se pinta —por el candado— y lo que se afirma es que sólo trae la salida, no el resto de
    // la edición, que sobre una orden cancelada sigue prohibida.
    render(
      liberadaCompleta({
        estado: 'cancelada',
        abiertaEn: '2026-08-31T09:00:00.000Z',
        puedeComprar: false,
        resumen: {
          sinRevisar: 1,
          revisados: 2,
          ajustados: 0,
          excluidos: 0,
          total: 3,
          liberados: 3,
          porLiberar: 0,
        },
      }),
    );

    expect(screen.getByTestId('receta-cerrar')).toBeInTheDocument();
    expect(screen.queryByTestId('receta-abrir')).not.toBeInTheDocument();
    // `sinRevisar: 1` a propósito: sin el filtro por `editable`, este botón se habilitaría.
    expect(screen.queryByTestId('receta-marcar-revisado')).not.toBeInTheDocument();
  });

  it('⚠️ y sin `desarrollo.administrar` la cancelada tampoco ofrece cerrar (el permiso manda)', () => {
    render(liberadaCompleta({ estado: 'cancelada', abiertaEn: '2026-08-31T09:00:00.000Z' }), false);

    expect(screen.queryByTestId('receta-cerrar')).not.toBeInTheDocument();
  });

  it('cerrar no pide nada: la razón ya se dio al abrir', async () => {
    const usuario = userEvent.setup();
    render(liberadaCompleta({ abiertaEn: '2026-08-31T09:00:00.000Z', puedeComprar: false }));

    await usuario.click(screen.getByTestId('receta-cerrar'));

    expect(cerrarMutateMock).toHaveBeenCalledTimes(1);
    expect(cerrarMutateMock.mock.calls[0]?.[0]).toBe(50);
  });
});

/**
 * ⭐⭐⭐ **0.085 (§Post-F9.173(a)) — SI YA SE COMPRÓ, AVISA.**
 *
 * DANIEL, textual: *"Si ya está comprado, **solo avisa que ya está comprado** para ver si se puede
 * cancelar la OC interna, o que **el comprador sepa que cambió**, para hacer lo que tenga que hacer.
 * **No se puede cancelar la OC en automático… eso hay que negociarlo con el proveedor.**"*
 *
 * Lo que estas pruebas fijan son los TRES sitios donde el aviso tiene que aparecer, y —tan
 * importante— los tres donde NO puede aparecer cuando no hay nada comprometido.
 */
describe('⭐⭐⭐ 0.085 — «ya está comprado» en la receta (§Post-F9.173(a))', () => {
  const OC_AUTORIZADA = {
    idOrdenCompra: 900,
    folio: 12,
    estatus: 'autorizada' as const,
    // ⭐ `recibida` lo calcula el DOMINIO (`algunaRecibida`) y VIAJA: la pantalla no lo deduce.
    recibida: false,
  };
  const AVISO_DEL_SERVIDOR =
    'Acabas de cambiar un material que YA ESTÁ COMPRADO para esta orden: "Jersey" (la orden de ' +
    'compra #12 (autorizada)). La orden de compra NO se corrige sola.';

  /**
   * ⭐⭐ **DISPARA UNA EDICIÓN DE VERDAD** y deja que el mock de la mutación conteste con el aviso.
   *
   * 🔴 Nace de un hallazgo del reviewer: las dos primeras versiones de estas pruebas renderizaban
   * una receta **con el campo ya puesto**, así que su nombre prometía el flujo y el cuerpo sólo
   * comprobaba el pintado. Hoy el aviso NO viene de la receta —vive en el estado del panel, porque
   * la invalidación borraba el de la caché—, de modo que la única manera de verlo es **provocarlo**.
   */
  async function editarElPrecioDeLaTela(
    usuario: ReturnType<typeof userEvent.setup>,
    respuesta: RecetaOrden,
  ): Promise<void> {
    editarMutateMock.mockImplementation(
      (_vars: unknown, opciones?: { onSuccess?: (r: RecetaOrden) => void }) => {
        opciones?.onSuccess?.(respuesta);
      },
    );
    const campo = screen.getByTestId('precio-receta-tela-1');
    await usuario.clear(campo);
    await usuario.type(campo, '77');
    await usuario.tab();
  }

  /** La receta con su(s) TELA(S) ya compradas en la OC #12 (y la orden, en consecuencia). */
  function conTelaComprada(
    extra: Partial<RecetaOrden['telas'][number]> = {},
    over: Partial<RecetaOrden> = {},
  ): RecetaOrden {
    const r = recetaDePrueba();
    return {
      ...r,
      telas: r.telas.map((t) => ({ ...t, ocsComprometidas: [OC_AUTORIZADA], ...extra })),
      ocsComprometidas: [OC_AUTORIZADA],
      ...over,
    };
  }

  /** Receta LIBERADA COMPLETA: la única que el servidor deja reabrir (§Post-F9.165 punto 4). */
  function liberadaCompleta(over: Partial<RecetaOrden> = {}): RecetaOrden {
    return recetaDePrueba({
      liberadaEn: '2026-08-30T10:00:00.000Z',
      liberadaPor: 'usuario-1',
      puedeComprar: true,
      todoLiberado: true,
      resumen: {
        sinRevisar: 0,
        revisados: 3,
        ajustados: 0,
        excluidos: 0,
        total: 3,
        liberados: 3,
        porLiberar: 0,
      },
      ...over,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('el RENGLÓN comprado lo dice en su fila, con folio y estado', () => {
    render(conTelaComprada());

    expect(screen.getByTestId('oc-comprometida-12')).toHaveTextContent('OC 12');
    expect(screen.getByTestId('oc-comprometida-12')).toHaveTextContent('Autorizada');
  });

  it('🔴 EL GEMELO: sin OC comprometidas la fila no lleva chip (nada de gritar en falso)', () => {
    render(recetaDePrueba());
    expect(screen.queryByTestId('oc-comprometida-12')).not.toBeInTheDocument();
  });

  it('⭐ en una LÁPIDA SÍ se pinta: ahí el dato es una CONTRADICCIÓN, no un adorno', () => {
    // 🔴 Al revés que la firma, que en una lápida se calla. Aquí el hecho es: existe una OC viva
    // contra un material que esta orden dice que NO lleva — y quien vaya a REVIVIRLO (lo que le
    // reescribe consumo, precio y amarre) tiene que verlo ANTES. Callarlo en el único renglón donde
    // el dato es una contradicción sería callarlo justo donde más grita (hallazgo del reviewer).
    render(conTelaComprada({ excluido: true }));
    expect(screen.getByTestId('oc-comprometida-12')).toBeInTheDocument();
  });

  it('⭐⭐ EDITAR algo comprado pinta el aviso del SERVIDOR entero (y no como toast)', async () => {
    // 🔴 Un toast se va en cuatro segundos; esto no es un «guardado ✓», es «acabas de descuadrar
    // una OC que ya está con el proveedor». Va como bloque, y el texto viaja REDACTADO (A1).
    const usuario = userEvent.setup();
    render(conTelaComprada());
    // Antes de tocar nada NO hay bloque: es el eco de una acción, no un estado de la receta.
    expect(screen.queryByTestId('receta-aviso-ya-comprado')).not.toBeInTheDocument();

    await editarElPrecioDeLaTela(
      usuario,
      conTelaComprada({}, { avisoCambioSobreLoComprado: AVISO_DEL_SERVIDOR }),
    );

    const bloque = screen.getByTestId('receta-aviso-ya-comprado');
    expect(bloque).toHaveTextContent('"Jersey"');
    expect(bloque).toHaveTextContent('#12 (autorizada)');
    // La pantalla NO arma la frase: si la armara, este texto exacto no podría salir de aquí.
    expect(within(bloque).getByTestId('oc-comprometida-12')).toBeInTheDocument();
  });

  it('🔴 EL GEMELO: si la respuesta NO trae aviso, no se pinta el bloque aunque haya OC', async () => {
    // Rojo si el bloque se colgara de `ocsComprometidas` en vez del aviso: entonces toda orden con
    // una compra viva llevaría permanentemente un cartel rojo que nadie provocó.
    const usuario = userEvent.setup();
    render(conTelaComprada());

    await editarElPrecioDeLaTela(usuario, conTelaComprada());

    expect(screen.queryByTestId('receta-aviso-ya-comprado')).not.toBeInTheDocument();
  });

  it('⭐⭐ el diálogo de REABRIR nombra las OC ANTES de confirmar (§Post-F9.145(a))', async () => {
    const usuario = userEvent.setup();
    render(
      liberadaCompleta({
        ocsComprometidas: [OC_AUTORIZADA],
        avisoCompraComprometida:
          'Esta orden ya tiene compra comprometida con el proveedor: la orden de compra #12 ' +
          '(autorizada). Reabrir la receta NO las cancela ni las toca: siguen su curso.',
      }),
    );

    await usuario.click(screen.getByTestId('receta-abrir'));
    const bloque = screen.getByTestId('abrir-receta-compra-comprometida');
    expect(bloque).toHaveTextContent('#12 (autorizada)');
    expect(bloque).toHaveTextContent('NO las cancela');
    // Y sigue siendo posible reabrir: AVISA, no bloquea.
    expect(screen.getByTestId('motivo-abrir-receta')).toBeInTheDocument();
  });

  it('🔴 EL GEMELO: sin compra comprometida el diálogo no inventa un aviso', async () => {
    const usuario = userEvent.setup();
    render(liberadaCompleta());

    await usuario.click(screen.getByTestId('receta-abrir'));
    expect(screen.queryByTestId('abrir-receta-compra-comprometida')).not.toBeInTheDocument();
    expect(screen.getByTestId('motivo-abrir-receta')).toBeInTheDocument();
  });

  it('🔴 SIN `compras.ver` el chip informa pero NO es enlace (no se pinta un 403)', () => {
    render(conTelaComprada());
    expect(screen.getByTestId('oc-comprometida-12').closest('button')).toBeNull();
  });

  /**
   * ⭐⭐⭐ **LA DÉCIMA MUTACIÓN: «traer del modelo» TAMBIÉN tiene que apagar el eco** (remate del
   * reviewer).
   *
   * 🔴 `useTraerDelModelo` es la ÚNICA que `recordandoElAviso` no puede envolver —devuelve
   * `TraerDelModeloResultado`, no `RecetaOrden`—, así que reporta a mano. Sin esa línea el bloque
   * rojo sobrevivía a la siguiente acción y seguía diciendo *«acabas de cambiar…»* de algo que ya
   * no era lo último: el *gritar en falso* que este mismo módulo dice que enseña a ignorar avisos.
   */
  it('⭐⭐ «Traer del modelo» APAGA el aviso: es otra acción, y el eco es de la ÚLTIMA', async () => {
    const usuario = userEvent.setup();
    const conFaltante = conTelaComprada(
      {},
      {
        desalineacion: {
          hayCambios: true,
          conOrdenCompra: false,
          critico: false,
          cambios: [
            {
              tipo: 'avio',
              idRenglon: null,
              material: 'E01 — Etiqueta de lavado',
              idMaterialModelo: 77,
              que: 'agregado',
              detalle:
                'El modelo ahora lleva "E01 — Etiqueta de lavado", y esta orden no lo tiene.',
            },
          ],
        },
      },
    );
    render(conFaltante);

    // 1) Una edición sobre lo comprado enciende el bloque…
    await editarElPrecioDeLaTela(usuario, {
      ...conFaltante,
      avisoCambioSobreLoComprado: AVISO_DEL_SERVIDOR,
    });
    expect(screen.getByTestId('receta-aviso-ya-comprado')).toBeInTheDocument();

    // 2) …y la SIGUIENTE acción, que no toca nada comprado, lo apaga.
    traerMutateMock.mockImplementation(
      (
        _vars: unknown,
        opciones?: {
          onSuccess?: (r: {
            receta: RecetaOrden;
            traidos: unknown[];
            respetados: unknown[];
          }) => void;
        },
      ) => {
        opciones?.onSuccess?.({
          receta: conFaltante, // sin aviso: traer del modelo sólo CREA renglones
          traidos: [{ tipo: 'avio', material: 'E01 — Etiqueta de lavado' }],
          respetados: [],
        });
      },
    );
    await usuario.click(screen.getByTestId('traer-del-modelo-todo'));

    expect(screen.queryByTestId('receta-aviso-ya-comprado')).not.toBeInTheDocument();
  });

  it('⭐ con `compras.ver` el chip del AVISO sí es la puerta a las compras de la orden', async () => {
    const usuario = userEvent.setup();
    render(conTelaComprada(), true, ['ordenes.ver', 'desarrollo.administrar', 'compras.ver']);

    await editarElPrecioDeLaTela(
      usuario,
      conTelaComprada({}, { avisoCambioSobreLoComprado: AVISO_DEL_SERVIDOR }),
    );

    const bloque = screen.getByTestId('receta-aviso-ya-comprado');
    // ⛔ Y lo que NUNCA se le ofrece: des-autorizar la OC (es de Dirección; sería un 403 en la cara).
    expect(bloque).not.toHaveTextContent(/Des-?autorizar la/i);
    expect(within(bloque).getByTestId('oc-comprometida-12').closest('button')).not.toBeNull();
  });
});
