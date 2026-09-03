import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SaldosTelaColor } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { CapturaConteoTelaColor, type RenglonConteoTelaColor } from './CapturaConteoTelaColor';

/**
 * 🔴 Pruebas de la pieza que ES la funcionalidad de la fila 0.098. En la 1ª ronda este componente
 * —400 líneas, el corazón nuevo de la pantalla con la que se va a INICIALIZAR el inventario de
 * telas— se quedó en CERO pruebas, mockeado entero por la de la página. Su hermana
 * `CapturaRenglonesTelaColor` tiene 650 líneas de pruebas.
 *
 * Lo que se vigila: el SALDO a la vista, la PREVISIÓN de diferencia, que contar CERO sea capturable
 * (la captura de ajuste hermana exige `> 0`), el reemplazo del color duplicado, el aviso de tela
 * sin colores, y que los saldos se pidan en UNA sola llamada.
 */

/** La felpa LLEVA complemento; la lisa NO. */
const FELPA = {
  id: 1,
  nombre: 'Felpa Suiza',
  descripcion: null,
  unidadMedida: 'KG' as const,
  nombreCuerpo: 'Felpa',
  nombreComplemento: 'Cardigan',
  colores: [
    { id: 11, nombre: 'Marino', pantone: '19-3920' },
    { id: 12, nombre: 'Blanco', pantone: null },
  ],
};
const LISA = {
  id: 2,
  nombre: 'Lisa Algodón',
  descripcion: null,
  unidadMedida: 'M' as const,
  nombreCuerpo: null,
  nombreComplemento: null,
  colores: [{ id: 21, nombre: 'Negro', pantone: null }],
};
const SIN_COLORES = { ...LISA, id: 3, nombre: 'Tela Nueva', colores: [] };

const saldos: SaldosTelaColor = {
  idAlmacen: 5,
  saldos: [
    {
      idTelaColor: 11,
      idTela: 1,
      tela: 'Felpa Suiza',
      telaColor: 'Marino',
      cuerpo: 100,
      complemento: 40,
      nombreComplemento: 'Cardigan',
    },
    {
      idTelaColor: 12,
      idTela: 1,
      tela: 'Felpa Suiza',
      telaColor: 'Blanco',
      cuerpo: 0,
      complemento: 0,
      nombreComplemento: 'Cardigan',
    },
    {
      idTelaColor: 21,
      idTela: 2,
      tela: 'Lisa Algodón',
      telaColor: 'Negro',
      cuerpo: 33,
      complemento: 0,
      nombreComplemento: null,
    },
  ],
};

/** Lo que recibió `useSaldosTelaColor` en la última renderización (para contar llamadas y filtros). */
const consultaSaldos = vi.fn<(q: unknown) => void>();

vi.mock('@/api/inventario-materiales', () => ({
  useSaldosTelaColor: (query: unknown) => {
    consultaSaldos(query);
    return query === undefined
      ? { data: undefined, isPending: true, isError: false, error: null }
      : { data: saldos, isPending: false, isError: false, error: null };
  },
}));
vi.mock('@/api/telas', () => ({
  etiquetaUnidadTela: (u: 'KG' | 'M') => (u === 'KG' ? 'kg' : 'm'),
}));
// El buscador de tela se simula: tres botones que emiten cada tela.
vi.mock('./SelectorTela', () => ({
  SelectorTela: ({ alSeleccionar }: { alSeleccionar: (t: unknown) => void }) => (
    <div>
      <button type="button" data-testid="sel-felpa" onClick={() => alSeleccionar(FELPA)}>
        felpa
      </button>
      <button type="button" data-testid="sel-lisa" onClick={() => alSeleccionar(LISA)}>
        lisa
      </button>
      <button
        type="button"
        data-testid="sel-sin-colores"
        onClick={() => alSeleccionar(SIN_COLORES)}
      >
        sin colores
      </button>
    </div>
  ),
}));

const SESION = () => estadoSesionDePrueba(['inventario-telas.mover']);

/**
 * Monta la captura con un `onChange` espiado y devuelve el espía.
 *
 * ⚠️ `idAlmacen` NO lleva valor por defecto: con `= 5`, pasar `undefined` explícitamente activaba
 * el default y la prueba de «sin almacén» montaba la pantalla CON almacén — y pasaba por la
 * construcción del fixture, no por el código. Se pide siempre, aunque sea `undefined`.
 */
function montar(
  renglones: RenglonConteoTelaColor[] = [],
  opciones: { idAlmacen: number | undefined } = { idAlmacen: 5 },
) {
  const onChange = vi.fn<(r: RenglonConteoTelaColor[]) => void>();
  renderConProveedores(
    <CapturaConteoTelaColor
      idAlmacen={opciones.idAlmacen}
      renglones={renglones}
      onChange={onChange}
    />,
    { sesion: SESION() },
  );
  return onChange;
}

/** Un renglón ya capturado del Marino (100/40 en el sistema). */
const MARINO_CAPTURADO: RenglonConteoTelaColor = {
  idTelaColor: 11,
  tela: 'Felpa Suiza',
  color: 'Marino',
  nombreComplemento: 'Cardigan',
  unidad: 'kg',
  contadoCuerpo: 130,
  contadoComplemento: 50,
};

beforeEach(() => {
  consultaSaldos.mockClear();
});

describe('CapturaConteoTelaColor — el saldo del sistema a la vista', () => {
  it('al elegir tela y color enseña lo que el sistema tiene, de AMBOS componentes', () => {
    montar();
    fireEvent.click(screen.getByTestId('sel-felpa'));
    fireEvent.change(screen.getByTestId('conteo-color'), { target: { value: '11' } });
    expect(screen.getByTestId('conteo-saldo-cuerpo')).toHaveTextContent('100');
    expect(screen.getByTestId('conteo-saldo-complemento')).toHaveTextContent('40');
  });

  it('la tela SIN complemento no enseña saldo de complemento (no pide ese número)', () => {
    montar();
    fireEvent.click(screen.getByTestId('sel-lisa'));
    fireEvent.change(screen.getByTestId('conteo-color'), { target: { value: '21' } });
    expect(screen.getByTestId('conteo-saldo-cuerpo')).toHaveTextContent('33');
    expect(screen.queryByTestId('conteo-saldo-complemento')).not.toBeInTheDocument();
  });

  it('sin almacén no hay saldo que enseñar, y lo dice en vez de callar', () => {
    montar([], { idAlmacen: undefined });
    fireEvent.click(screen.getByTestId('sel-felpa'));
    fireEvent.change(screen.getByTestId('conteo-color'), { target: { value: '11' } });
    expect(screen.getByTestId('conteo-saldo')).toHaveTextContent(/Elige primero el almacén/);
    // Y no se puede agregar a ciegas.
    expect(screen.getByTestId('conteo-agregar')).toBeDisabled();
  });

  it('⭐ ANTICIPA la diferencia mientras se teclea, con su signo', () => {
    montar();
    fireEvent.click(screen.getByTestId('sel-felpa'));
    fireEvent.change(screen.getByTestId('conteo-color'), { target: { value: '11' } });
    // Falta: contado 130 contra 100 → +30.
    fireEvent.change(screen.getByTestId('conteo-contado-cuerpo'), { target: { value: '130' } });
    expect(screen.getByTestId('conteo-diferencia-previa')).toHaveTextContent('+30');
    // Sobra: contado 80 contra 100 → −20 (menos tipográfico, no guion).
    fireEvent.change(screen.getByTestId('conteo-contado-cuerpo'), { target: { value: '80' } });
    expect(screen.getByTestId('conteo-diferencia-previa')).toHaveTextContent('−20');
    // Cuadra: sin diferencia se pinta la raya, no un "0".
    fireEvent.change(screen.getByTestId('conteo-contado-cuerpo'), { target: { value: '100' } });
    expect(screen.getByTestId('conteo-diferencia-previa')).toHaveTextContent('—');
  });

  it('pide TODOS los saldos en UNA sola consulta, no uno por renglón', () => {
    montar([MARINO_CAPTURADO]);
    fireEvent.click(screen.getByTestId('sel-lisa'));
    fireEvent.change(screen.getByTestId('conteo-color'), { target: { value: '21' } });
    // La última consulta lleva el capturado (11) Y el que se está eligiendo (21), juntos.
    const ultima = consultaSaldos.mock.calls.at(-1)?.[0] as { idTelaColor: string } | undefined;
    expect(ultima?.idTelaColor).toBe('11,21');
  });
});

describe('CapturaConteoTelaColor — captura de lo contado', () => {
  it('⭐ contar CERO es capturable (la captura de ajuste hermana exige > 0)', () => {
    // Es EL caso que más falta hacía: con 100 en el sistema, contar 0 saca 100. Si se exigiera
    // cantidad > 0 —como en el ajuste, donde la cantidad ES el movimiento— vaciar sería imposible.
    const onChange = montar();
    fireEvent.click(screen.getByTestId('sel-felpa'));
    fireEvent.change(screen.getByTestId('conteo-color'), { target: { value: '11' } });
    fireEvent.change(screen.getByTestId('conteo-contado-cuerpo'), { target: { value: '0' } });
    expect(screen.getByTestId('conteo-agregar')).toBeEnabled();
    fireEvent.click(screen.getByTestId('conteo-agregar'));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ idTelaColor: 11, contadoCuerpo: 0, contadoComplemento: 0 }),
    ]);
  });

  it('con el campo VACÍO también se puede agregar: vacío es cero contado', () => {
    const onChange = montar();
    fireEvent.click(screen.getByTestId('sel-felpa'));
    fireEvent.change(screen.getByTestId('conteo-color'), { target: { value: '11' } });
    fireEvent.click(screen.getByTestId('conteo-agregar'));
    expect(onChange.mock.calls[0]?.[0][0]).toMatchObject({ contadoCuerpo: 0 });
  });

  it('captura los dos componentes juntos, con su unidad', () => {
    const onChange = montar();
    fireEvent.click(screen.getByTestId('sel-felpa'));
    fireEvent.change(screen.getByTestId('conteo-color'), { target: { value: '11' } });
    fireEvent.change(screen.getByTestId('conteo-contado-cuerpo'), { target: { value: '130' } });
    fireEvent.change(screen.getByTestId('conteo-contado-complemento'), { target: { value: '50' } });
    fireEvent.change(screen.getByTestId('conteo-lote-prov'), { target: { value: 'L-778' } });
    fireEvent.click(screen.getByTestId('conteo-agregar'));
    expect(onChange).toHaveBeenCalledWith([
      {
        idTelaColor: 11,
        tela: 'Felpa Suiza',
        color: 'Marino',
        nombreComplemento: 'Cardigan',
        unidad: 'kg',
        contadoCuerpo: 130,
        contadoComplemento: 50,
        loteProveedor: 'L-778',
      },
    ]);
  });

  it('la tela SIN complemento no ofrece ese campo y captura complemento 0', () => {
    const onChange = montar();
    fireEvent.click(screen.getByTestId('sel-lisa'));
    fireEvent.change(screen.getByTestId('conteo-color'), { target: { value: '21' } });
    expect(screen.queryByTestId('conteo-contado-complemento')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('conteo-contado-cuerpo'), { target: { value: '40' } });
    fireEvent.click(screen.getByTestId('conteo-agregar'));
    expect(onChange.mock.calls[0]?.[0][0]).toMatchObject({
      nombreComplemento: null,
      contadoComplemento: 0,
      unidad: 'm',
    });
  });

  it('⭐ recontar un color REEMPLAZA lo contado, no lo suma, y lo avisa antes de pulsar', () => {
    // Un conteo dice «cuánto hay», no «cuánto más hay»: sumar sería falsear el físico. Y el
    // backend rechaza el color repetido, así que tampoco puede mandarse dos veces.
    const onChange = montar([MARINO_CAPTURADO]);
    fireEvent.click(screen.getByTestId('sel-felpa'));
    fireEvent.change(screen.getByTestId('conteo-color'), { target: { value: '11' } });
    expect(screen.getByTestId('conteo-ya-capturado')).toBeInTheDocument();
    expect(screen.getByTestId('conteo-agregar')).toHaveTextContent('Reemplazar');
    fireEvent.change(screen.getByTestId('conteo-contado-cuerpo'), { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('conteo-agregar'));
    const enviado = onChange.mock.calls[0]?.[0];
    expect(enviado).toHaveLength(1);
    expect(enviado?.[0]).toMatchObject({ idTelaColor: 11, contadoCuerpo: 90 });
  });

  it('un color distinto se AGREGA (no reemplaza al que ya estaba)', () => {
    const onChange = montar([MARINO_CAPTURADO]);
    fireEvent.click(screen.getByTestId('sel-felpa'));
    fireEvent.change(screen.getByTestId('conteo-color'), { target: { value: '12' } });
    expect(screen.queryByTestId('conteo-ya-capturado')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('conteo-contado-cuerpo'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('conteo-agregar'));
    expect(onChange.mock.calls[0]?.[0].map((r) => r.idTelaColor)).toEqual([11, 12]);
  });

  it('una tela SIN colores no se puede contar, y la pantalla dice a dónde ir', () => {
    montar();
    fireEvent.click(screen.getByTestId('sel-sin-colores'));
    expect(screen.getByTestId('conteo-sin-colores')).toHaveTextContent(/Catálogos › Telas/);
    expect(screen.getByTestId('conteo-agregar')).toBeDisabled();
  });

  it('sólo lectura: no se puede agregar ni quitar', () => {
    renderConProveedores(
      <CapturaConteoTelaColor
        idAlmacen={5}
        renglones={[MARINO_CAPTURADO]}
        onChange={vi.fn()}
        soloLectura
      />,
      { sesion: SESION() },
    );
    expect(screen.getByTestId('conteo-quitar-11')).toBeDisabled();
  });
});

describe('CapturaConteoTelaColor — la tabla de lo capturado', () => {
  it('cada renglón enseña sistema, contado y diferencia', () => {
    montar([MARINO_CAPTURADO]);
    const fila = screen.getByTestId('conteo-fila-11');
    expect(within(fila).getByText('Felpa Suiza')).toBeInTheDocument();
    // Sistema 100 · contado 130 · diferencia +30 (y en complemento 40 / 50 / +10).
    expect(fila).toHaveTextContent('100');
    expect(fila).toHaveTextContent('130');
    expect(fila).toHaveTextContent('+30');
    expect(fila).toHaveTextContent('+10');
  });

  it('un color con saldo 0 enseña CERO, no blanco (en el arranque no son lo mismo)', () => {
    montar([
      {
        idTelaColor: 12,
        tela: 'Felpa Suiza',
        color: 'Blanco',
        nombreComplemento: 'Cardigan',
        unidad: 'kg',
        contadoCuerpo: 25,
        contadoComplemento: 0,
      },
    ]);
    const fila = screen.getByTestId('conteo-fila-12');
    expect(fila).toHaveTextContent('0');
    // Con el sistema en 0, contar 25 es una diferencia de +25 (el caso del arranque desde cero).
    expect(fila).toHaveTextContent('+25');
    // Y NO se queda en el "…" de "todavía no llegó".
    expect(fila).not.toHaveTextContent('…');
  });

  /**
   * Las TRES celdas de complemento de una fila, por posición. Se mira la celda y no la fila entera:
   * la columna «Lote prov.» también pinta «—» cuando no hay lote, así que una aserción sobre el
   * renglón completo pasaría por la razón equivocada (me pasó: la primera versión de estas dos
   * pruebas leía la fila y una de ellas se caía por el guion del lote).
   * Orden: Tela · Color · Sistema · Contado · Dif · **Sistema(c) · Contado(c) · Dif(c)** · Lote · ✕
   */
  function celdasComplemento(fila: HTMLElement): string[] {
    const celdas = [...fila.querySelectorAll('td')].map((c) => c.textContent ?? '');
    return celdas.slice(5, 8);
  }

  it('⭐ «—» y «…» dicen cosas distintas también en las columnas de complemento', () => {
    // «—» = la tela no lleva complemento. «…» = el saldo todavía no llegó. Antes las dos se
    // pintaban «—», mientras la columna de cuerpo sí las distinguía — el mismo principio que el
    // componente enuncia para el 0, roto en el hueco de al lado.
    montar([
      MARINO_CAPTURADO, // felpa: LLEVA complemento y su saldo llegó (40)
      {
        idTelaColor: 21,
        tela: 'Lisa Algodón',
        color: 'Negro',
        nombreComplemento: null, // NO lleva
        unidad: 'm',
        contadoCuerpo: 40,
        contadoComplemento: 0,
      },
    ]);
    // La que lleva complemento enseña sus números, no rayas.
    expect(celdasComplemento(screen.getByTestId('conteo-fila-11'))).toEqual(['40', '50', '+10']);
    // La que NO lleva enseña «—» en las TRES… y nunca «…», que significaría «se está cargando»
    // (aquí no hay nada que cargar: esa tela no tiene complemento y punto).
    expect(celdasComplemento(screen.getByTestId('conteo-fila-21'))).toEqual(['—', '—', '—']);
  });

  it('⭐ y el otro mundo: tela CON complemento cuyo saldo aún NO llegó enseña «…», no «—»', () => {
    // Sin esta mitad la prueba de arriba pasaba con las dos ramas fundidas otra vez (lo cazó
    // MUT-O4): en aquel montaje TODOS los saldos habían llegado, así que la rama «…» no se
    // ejercitaba nunca. Este color (99) no viene en la respuesta del servidor.
    montar([
      {
        idTelaColor: 99,
        tela: 'Felpa Suiza',
        color: 'Aún sin saldo',
        nombreComplemento: 'Cardigan', // SÍ lleva
        unidad: 'kg',
        contadoCuerpo: 12,
        contadoComplemento: 3,
      },
    ]);
    const fila = screen.getByTestId('conteo-fila-99');
    // Lleva complemento, así que «—» («no lleva») sería mentira: lo que pasa es que NO HA LLEGADO.
    // El contado sí se conoce —lo tecleó el usuario—; lo que falta es el saldo y la diferencia.
    expect(celdasComplemento(fila)).toEqual(['…', '3', '…']);
  });

  it('quitar un renglón lo saca de la lista', () => {
    const onChange = montar([MARINO_CAPTURADO]);
    fireEvent.click(screen.getByTestId('conteo-quitar-11'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('sin renglones explica qué se espera que se capture', () => {
    montar();
    expect(screen.getByTestId('conteo-sin-renglones')).toHaveTextContent(/lo que contaste/i);
  });
});
