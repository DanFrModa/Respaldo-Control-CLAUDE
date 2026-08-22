import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderConProveedores } from '@/pruebas/utilidades';

/**
 * Pruebas de la captura por TELA+COLOR (etapa A2 — Daniel §Post-F9.11): el color es HIJO de la
 * tela, y el CUERPO y el COMPLEMENTO se capturan JUNTOS en el mismo renglón (comprar solo
 * cardigan = cuerpo en 0). En telas sin complemento esa cantidad NO se captura.
 */

// El selector de tela se simula: emite la tela elegida (CON sus colores hijos) al hacer clic.
vi.mock('./SelectorTela', () => ({
  SelectorTela: ({ alSeleccionar }: { alSeleccionar: (t: unknown) => void }) => (
    <div>
      <button
        type="button"
        data-testid="sel-felpa"
        onClick={() =>
          alSeleccionar({
            id: 1,
            nombre: 'Felpa Suiza',
            nombreCuerpo: 'Felpa',
            nombreComplemento: 'Cardigan',
            colores: [
              { id: 11, nombre: 'Marino', pantone: '19-3920', precio: 95, precioComplemento: 130 },
              { id: 12, nombre: 'Blanco', pantone: null, precio: null, precioComplemento: null },
            ],
          })
        }
      >
        elegir felpa
      </button>
      <button
        type="button"
        data-testid="sel-lisa"
        onClick={() =>
          alSeleccionar({
            id: 2,
            nombre: 'Lisa Algodón',
            nombreCuerpo: null,
            nombreComplemento: null,
            colores: [{ id: 21, nombre: 'Negro', pantone: null }],
          })
        }
      >
        elegir lisa
      </button>
    </div>
  ),
}));

// ⭐⭐ V1-E3u: la PRECARGA desde la OC pide la tela por id para tener sus colores a mano.
vi.mock('@/api/telas', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useTela: (id: number | undefined) =>
    id === 1
      ? {
          data: {
            id: 1,
            nombre: 'Felpa Suiza',
            nombreCuerpo: 'Felpa',
            nombreComplemento: 'Cardigan',
            colores: [
              { id: 11, nombre: 'Marino', pantone: '19-3920', precio: 95, precioComplemento: 130 },
              { id: 12, nombre: 'Blanco', pantone: null, precio: null, precioComplemento: null },
            ],
          },
        }
      : { data: undefined },
}));

const { CapturaRenglonesTelaColor } = await import('./CapturaRenglonesTelaColor');

/** Un pendiente de OC de la felpa; `idTelaColor` = el color con el que la OC la pidió. */
function pendienteDeOc(idTelaColor: number | null, telaColor: string | null) {
  return {
    idOrdenCompraLinea: 500,
    numCompra: 1234,
    idTela: 1,
    tela: 'Felpa Suiza',
    idTelaColor,
    telaColor,
    pantoneTelaColor: idTelaColor === null ? null : '19-3920',
    unidad: 'kg',
    pendiente: 80,
    precio: 12,
    nombreComplemento: 'Cardigan',
    cantidadComplemento: 5,
    pendienteComplemento: 5,
  };
}

/**
 * ⭐⭐ **EL COLOR DE LA OC LLEGA A QUIEN RECIBE** (V1-E3u, §Post-F9.89 · hallazgo D1 de la revisión).
 *
 * 🔴 La etapa puso un **cruce que rechaza la factura entera** si el color no coincide con el de la
 * OC… y esta pantalla —que es donde de verdad se recibe la tela, porque §Post-F9.14 deshabilita los
 * renglones de tela en la recepción de compras— **no tenía de dónde sacar ese color**. Una tranca
 * nueva sin el dato para cumplirla no protege: se lo traslada a quien menos puede resolverlo.
 */
describe('<CapturaRenglonesTelaColor> · el COLOR sale de la orden de compra (§Post-F9.89)', () => {
  it('el panel de pendientes DICE el color con su pantone', () => {
    renderConProveedores(
      <CapturaRenglonesTelaColor
        renglones={[]}
        onChange={vi.fn()}
        conPrecios
        lineasOc={[pendienteDeOc(11, 'Marino')]}
      />,
    );
    const fila = screen.getByTestId('pendiente-color-oc');
    // Rojo si `lineasTelaPendientesDeProveedor` deja de devolver el color (como estaba cuando el
    // cruce ya rechazaba facturas).
    expect(fila).toHaveTextContent('Marino');
    expect(fila).toHaveTextContent('19-3920');
  });

  it('🔴 al pulsar «Capturar», el color de la OC viene PRESELECCIONADO', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <CapturaRenglonesTelaColor
        renglones={[]}
        onChange={vi.fn()}
        conPrecios
        lineasOc={[pendienteDeOc(11, 'Marino')]}
      />,
    );
    await usuario.click(screen.getByTestId('captura-color-capturar-oc-500'));

    // 🔴 EL VALOR QUE LO PONE ROJO: '' — el campo vacío de antes, que obligaba a acertar a ciegas
    // un color que el confirmar sí conoce y valida.
    expect(await screen.findByTestId('captura-color-color')).toHaveValue('11');
    // Y lo demás sigue saliendo de la orden, como antes.
    expect(screen.getByTestId('captura-color-cantidad')).toHaveValue(80);
  });

  it('un pendiente SIN color (OC migrada) no preselecciona nada: la persona elige', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <CapturaRenglonesTelaColor
        renglones={[]}
        onChange={vi.fn()}
        conPrecios
        lineasOc={[pendienteDeOc(null, null)]}
      />,
    );
    expect(screen.queryByTestId('pendiente-color-oc')).toBeNull();
    await usuario.click(screen.getByTestId('captura-color-capturar-oc-500'));
    // Rojo si se inventara un color: en lo migrado no hay ninguno que adivinar (§Post-F9.86).
    expect(await screen.findByTestId('captura-color-color')).toHaveValue('');
  });

  it('el color preseleccionado se puede CAMBIAR: manda lo que de verdad llegó', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <CapturaRenglonesTelaColor
        renglones={[]}
        onChange={vi.fn()}
        conPrecios
        lineasOc={[pendienteDeOc(11, 'Marino')]}
      />,
    );
    await usuario.click(screen.getByTestId('captura-color-capturar-oc-500'));
    const select = await screen.findByTestId('captura-color-color');
    await usuario.selectOptions(select, '12');
    // Rojo si el campo quedara bloqueado "para que cuadre": el catálogo no es la fuente de verdad
    // (D1), y el confirmar dirá si no coincide — que es una conversación distinta de adivinar.
    expect(select).toHaveValue('12');
  });
});

describe('<CapturaRenglonesTelaColor> · cuerpo y complemento juntos (A2)', () => {
  it('al elegir la tela ofrece SUS colores y el campo del complemento con su nombre', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaRenglonesTelaColor renglones={[]} onChange={vi.fn()} />);
    await usuario.click(screen.getByTestId('sel-felpa'));

    // Los colores del select son los HIJOS de la tela (con su pantone).
    const select = screen.getByTestId('captura-color-color');
    expect(select).toHaveTextContent('Marino · 19-3920');
    expect(select).toHaveTextContent('Blanco');
    // El campo del complemento usa el NOMBRE de la tela ("Cardigan").
    expect(screen.getByLabelText('Cardigan')).toBeInTheDocument();
    expect(screen.getByLabelText('Felpa')).toBeInTheDocument();
  });

  it('agrega el renglón con AMBAS cantidades y el lote del proveedor (entrada)', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    renderConProveedores(
      <CapturaRenglonesTelaColor renglones={[]} onChange={onChange} conLoteProveedor />,
    );
    await usuario.click(screen.getByTestId('sel-felpa'));
    await usuario.selectOptions(screen.getByTestId('captura-color-color'), '11');
    await usuario.type(screen.getByTestId('captura-color-cantidad'), '100');
    await usuario.type(screen.getByTestId('captura-color-complemento'), '40');
    await usuario.type(screen.getByTestId('captura-color-lote-prov'), 'L-778');
    await usuario.click(screen.getByTestId('captura-color-agregar'));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        idTelaColor: 11,
        tela: 'Felpa Suiza',
        color: 'Marino',
        cantidad: 100,
        cantidadComplemento: 40,
        loteProveedor: 'L-778',
      }),
    ]);
  });

  it('acepta SOLO complemento (cuerpo en 0) — comprar solo cardigan', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    renderConProveedores(<CapturaRenglonesTelaColor renglones={[]} onChange={onChange} />);
    await usuario.click(screen.getByTestId('sel-felpa'));
    await usuario.selectOptions(screen.getByTestId('captura-color-color'), '12');
    await usuario.type(screen.getByTestId('captura-color-complemento'), '25');
    await usuario.click(screen.getByTestId('captura-color-agregar'));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ idTelaColor: 12, cantidad: 0, cantidadComplemento: 25 }),
    ]);
  });

  it('con ambas cantidades en 0 el botón queda deshabilitado', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaRenglonesTelaColor renglones={[]} onChange={vi.fn()} />);
    await usuario.click(screen.getByTestId('sel-felpa'));
    await usuario.selectOptions(screen.getByTestId('captura-color-color'), '11');
    expect(screen.getByTestId('captura-color-agregar')).toBeDisabled();
  });

  it('en una tela SIN complemento no ofrece esa cantidad y exige cuerpo > 0', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    renderConProveedores(<CapturaRenglonesTelaColor renglones={[]} onChange={onChange} />);
    await usuario.click(screen.getByTestId('sel-lisa'));
    expect(screen.queryByTestId('captura-color-complemento')).not.toBeInTheDocument();
    await usuario.selectOptions(screen.getByTestId('captura-color-color'), '21');
    // Sin cuerpo no se puede agregar (no hay complemento que lo salve).
    expect(screen.getByTestId('captura-color-agregar')).toBeDisabled();
    await usuario.type(screen.getByTestId('captura-color-cantidad'), '33');
    await usuario.click(screen.getByTestId('captura-color-agregar'));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ idTelaColor: 21, cantidad: 33, cantidadComplemento: 0 }),
    ]);
  });

  it('en ENTRADA el mismo tela+color se AGREGA como renglón nuevo (dos lotes = dos partidas)', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    renderConProveedores(
      <CapturaRenglonesTelaColor
        renglones={[
          {
            idTelaColor: 11,
            tela: 'Felpa Suiza',
            color: 'Marino',
            nombreComplemento: 'Cardigan',
            cantidad: 60,
            cantidadComplemento: 20,
            loteProveedor: 'L-A',
          },
        ]}
        onChange={onChange}
        conLoteProveedor
      />,
    );
    await usuario.click(screen.getByTestId('sel-felpa'));
    await usuario.selectOptions(screen.getByTestId('captura-color-color'), '11');
    await usuario.type(screen.getByTestId('captura-color-cantidad'), '35');
    await usuario.type(screen.getByTestId('captura-color-complemento'), '10');
    await usuario.type(screen.getByTestId('captura-color-lote-prov'), 'L-B');
    await usuario.click(screen.getByTestId('captura-color-agregar'));

    // NO se fusiona: quedan DOS renglones del mismo color, cada uno con SU lote del proveedor.
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ idTelaColor: 11, cantidad: 60, loteProveedor: 'L-A' }),
      expect.objectContaining({ idTelaColor: 11, cantidad: 35, loteProveedor: 'L-B' }),
    ]);
  });

  it('en salida/traspaso repetir la misma tela+color SUMA las cantidades (no duplica)', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    renderConProveedores(
      <CapturaRenglonesTelaColor
        renglones={[
          {
            idTelaColor: 11,
            tela: 'Felpa Suiza',
            color: 'Marino',
            nombreComplemento: 'Cardigan',
            cantidad: 10,
            cantidadComplemento: 5,
          },
        ]}
        onChange={onChange}
      />,
    );
    await usuario.click(screen.getByTestId('sel-felpa'));
    await usuario.selectOptions(screen.getByTestId('captura-color-color'), '11');
    await usuario.type(screen.getByTestId('captura-color-cantidad'), '15');
    await usuario.click(screen.getByTestId('captura-color-agregar'));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ idTelaColor: 11, cantidad: 25, cantidadComplemento: 5 }),
    ]);
  });
  it('B1 · con `conPrecios` pre-llena los precios del catálogo y los manda en el renglón', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    renderConProveedores(
      <CapturaRenglonesTelaColor renglones={[]} onChange={onChange} conLoteProveedor conPrecios />,
    );
    await usuario.click(screen.getByTestId('sel-felpa'));
    await usuario.selectOptions(screen.getByTestId('captura-color-color'), '11');

    // Pre-llenado (SUGERENCIA del catálogo del color; editable — la factura manda, D1).
    expect(screen.getByTestId('captura-color-precio')).toHaveValue(95);
    expect(screen.getByTestId('captura-color-precio-compl')).toHaveValue(130);

    // Se corrige el precio del cuerpo con el REAL de la factura y se agrega.
    await usuario.clear(screen.getByTestId('captura-color-precio'));
    await usuario.type(screen.getByTestId('captura-color-precio'), '99.5');
    await usuario.type(screen.getByTestId('captura-color-cantidad'), '20');
    await usuario.click(screen.getByTestId('captura-color-agregar'));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        idTelaColor: 11,
        cantidad: 20,
        precioUnit: 99.5,
        precioUnitComplemento: 130,
      }),
    ]);
  });

  it('B1 · sin `conPrecios` no se piden precios (ajustes/traspasos siguen igual)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CapturaRenglonesTelaColor renglones={[]} onChange={vi.fn()} />);
    await usuario.click(screen.getByTestId('sel-felpa'));
    await usuario.selectOptions(screen.getByTestId('captura-color-color'), '11');
    expect(screen.queryByTestId('captura-color-precio')).not.toBeInTheDocument();
  });
});
