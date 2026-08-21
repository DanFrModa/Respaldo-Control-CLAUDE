import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecetaOrden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ResumenRecetaOrden } from './ResumenRecetaOrden';

const useRecetaOrdenMock = vi.fn();

vi.mock('@/api/receta-orden', () => ({
  useRecetaOrden: (id: unknown) => useRecetaOrdenMock(id) as unknown,
}));

/** El destino de la navegación, que DELATA a qué orden llegó (nunca un rótulo fijo). */
function DestinoReceta(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  return <p>PANTALLA COMPLETA de la OP con id {id}</p>;
}

/** Receta mínima: los conteos y la desalineación son los únicos datos que este bloque lee. */
function receta(over: Partial<RecetaOrden> = {}): RecetaOrden {
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
    resumen: {
      sinRevisar: 3,
      revisados: 0,
      ajustados: 0,
      excluidos: 0,
      total: 3,
      liberados: 0,
      porLiberar: 3,
    },
    telas: [],
    avios: [],
    artes: [],
    avisoCurva: null,
    desalineacion: { hayCambios: false, conOrdenCompra: false, critico: false, cambios: [] },
    ...over,
  };
}

/**
 * Una TELA de verdad. Existe para UNA sola prueba, y por una razón concreta: sin renglones, afirmar
 * que «el resumen no ofrece firmar» sería afirmar la ausencia de un testid que no podría existir de
 * ninguna forma — una aserción incapaz de ponerse roja. Con esta tela, `liberar-receta-tela-1` es
 * exactamente el botón que aparecería si el resumen se convirtiera en la pantalla completa.
 */
function unaTela(): RecetaOrden['telas'][number] {
  return {
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
  };
}

function render(datos: RecetaOrden): void {
  useRecetaOrdenMock.mockReturnValue({ data: datos, isPending: false, isError: false });
  renderConProveedores(
    <Routes>
      <Route path="/produccion/ordenes" element={<ResumenRecetaOrden idOrden={50} />} />
      {/* ⚠️ El destino PINTA EL ID (hallazgo del reviewer): `:id` matchea cualquier valor, así que
          un rótulo fijo solo probaba que *alguna* pantalla de receta montó — y esta pantalla es
          donde se firma el material que abre la compra. */}
      <Route path="/produccion/ordenes/:id/receta" element={<DestinoReceta />} />
    </Routes>,
    {
      sesion: estadoSesionDePrueba(['ordenes.ver', 'desarrollo.ver']),
      rutaInicial: '/produccion/ordenes',
    },
  );
}

/**
 * EL RESUMEN de la receta en el detalle de la OP (V1-E3j). Lo que estas pruebas fijan es que sigue
 * siendo un VISTAZO y un CAMINO —nunca un segundo lugar donde se trabaja— y que lo que hay que ver
 * de un golpe (si falta firmar, si el modelo trae algo que esta orden no tiene) se ve.
 */
describe('<ResumenRecetaOrden> (V1-E3j)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lleva a la pantalla completa de la receta de ESA orden', async () => {
    const usuario = userEvent.setup();
    render(receta());

    await usuario.click(screen.getByTestId('receta-abrir-pantalla'));

    expect(screen.getByText('PANTALLA COMPLETA de la OP con id 50')).toBeInTheDocument();
  });

  it('enseña el estado de firma y cuántos renglones faltan', () => {
    render(receta());
    expect(screen.getByTestId('receta-sin-liberar')).toBeInTheDocument();
    expect(screen.getByTestId('receta-resumen-conteo')).toHaveTextContent(
      '3 renglones · 3 por firmar',
    );
  });

  it('⭐ anuncia lo que falta traer del modelo: es la razón nº 1 para entrar', () => {
    render(
      receta({
        desalineacion: {
          hayCambios: true,
          conOrdenCompra: false,
          critico: false,
          cambios: [
            {
              tipo: 'avio',
              idRenglon: null,
              material: 'E01',
              idMaterialModelo: 77,
              que: 'agregado',
              detalle: 'El modelo ahora lleva "E01", y esta orden no lo tiene.',
            },
            // Un cambio que NO es faltante: no se cuenta (traerlo no lo resuelve).
            {
              tipo: 'tela',
              idRenglon: 1,
              material: 'Jersey',
              idMaterialModelo: null,
              que: 'consumo',
              detalle: 'La cantidad de "Jersey" pasó de 1.5 a 2 en el modelo.',
            },
            // Y un «agregado» SIN traza al BOM: tampoco cuenta (no hay material que pedir). Va
            // aquí a propósito: sin él, relajar el predicado compartido a `que === 'agregado'`
            // seguiría dando 1 y ESTA suite no se enteraría — que es justo lo que pasaba cuando
            // el resumen tenía su propia copia del predicado.
            {
              tipo: 'avio',
              idRenglon: null,
              material: 'Fantasma',
              idMaterialModelo: null,
              que: 'agregado',
              detalle: 'El modelo ahora lleva "Fantasma", y esta orden no lo tiene.',
            },
          ],
        },
      }),
    );

    expect(screen.getByTestId('receta-resumen-faltantes')).toHaveTextContent(
      'El modelo lleva 1 material que esta orden no tiene',
    );
  });

  it('sin desalineación no inventa avisos (el caso normal)', () => {
    render(receta());
    expect(screen.queryByTestId('receta-resumen-faltantes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receta-resumen-critico')).not.toBeInTheDocument();
  });

  it('⭐ el aviso CRÍTICO (ya hay OC) sí se asoma al detalle de la OP: es dinero comprometido', () => {
    render(
      receta({
        desalineacion: {
          hayCambios: true,
          conOrdenCompra: true,
          critico: true,
          cambios: [
            {
              tipo: 'tela',
              idRenglon: 1,
              material: 'Jersey',
              idMaterialModelo: null,
              que: 'precio',
              detalle: 'El precio de "Jersey" cambió en el modelo.',
            },
          ],
        },
      }),
    );
    expect(screen.getByTestId('receta-resumen-critico')).toBeInTheDocument();
  });

  it('⚠️ el resumen NO ofrece firmar ni editar: el trabajo se hace en la pantalla completa', () => {
    // ⭐ V1-E3k (§Post-F9.80): se le pasa una receta CON tela a propósito. Antes esta prueba corría
    // sobre una receta vacía y preguntaba por `receta-liberar` —el botón de bloque de la cabecera—,
    // y hoy ese testid no existe en NINGUNA pantalla: la aserción no podía ponerse roja nunca. Lo
    // que el resumen no debe ofrecer es la firma POR RENGLÓN, y para poder afirmarlo tiene que
    // haber un renglón cuyo botón fuese posible.
    render(receta({ telas: [unaTela()] }));
    expect(screen.queryByTestId('liberar-receta-tela-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receta-marcar-revisado')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receta-seccion-telas')).not.toBeInTheDocument();
  });

  it('una receta sin materiales lo dice, en tono neutro (no como alarma)', () => {
    render(
      receta({
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
    expect(screen.getByTestId('receta-resumen-conteo')).toHaveTextContent('sin materiales todavía');
  });
});
