import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderConProveedores } from '@/pruebas/utilidades';

import { DetalleRenglonesOc } from './DetalleRenglonesOc';
import { ocDePrueba } from './fixtures';

describe('DetalleRenglonesOc (F4-E2)', () => {
  it('pinta los renglones con material, cantidad, subtotal y el total derivado', () => {
    renderConProveedores(<DetalleRenglonesOc oc={ocDePrueba()} />);
    expect(screen.getByText('Felpa francesa')).toBeInTheDocument();
    expect(screen.getByTestId('total-detalle-oc')).toHaveTextContent('$2,500.00');
  });

  it('imprime la matriz talla×color como tabla para los renglones que la usan', () => {
    const oc = ocDePrueba({
      lineas: [
        {
          id: 10,
          idTela: 3,
          tela: 'Felpa',
          nombreComplementoTela: null,
          cantidadComplemento: null,
          precioComplemento: null,
          idAvio: null,
          avio: null,
          idAvioProveedor: null,
          descripcionLibre: null,
          idTelaColor: null,
          telaColor: null,
          idColorPrenda: null,
          colorPrenda: null,
          colorAvio: null,
          medidas: [],
          pantoneTelaColor: null,
          cantidadSugerida: null,
          avisoDesvio: null,
          cantidad: 8,
          unidad: 'pza',
          precio: 1,
          subtotal: 8,
          idOrden: null,
          folioOrden: null,
          tallas: [
            { idColor: 1, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad: 5 },
            { idColor: 1, color: 'Rojo', idTalla: 12, etiquetaTalla: 'M', cantidad: 3 },
          ],
        },
      ],
    });
    renderConProveedores(<DetalleRenglonesOc oc={oc} />);
    expect(screen.getByTestId('matriz-detalle-oc')).toBeInTheDocument();
    expect(screen.getByText('CH')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
  });

  it('estado vacío cuando la OC no tiene renglones', () => {
    renderConProveedores(<DetalleRenglonesOc oc={ocDePrueba({ lineas: [], total: 0 })} />);
    expect(screen.getByText('Esta orden de compra no tiene renglones.')).toBeInTheDocument();
  });
});

/**
 * ⭐⭐ V1-E3u (§Post-F9.89) — **EL COLOR Y EL DESVÍO SE VEN EN EL RENGLÓN.**
 *
 * El impreso de la OC ya decía el color con su pantone; la PANTALLA no lo decía en ninguna parte, y
 * el `avisoDesvio` que arma el servidor no se pintaba. Quien recibe comparaba la factura contra una
 * OC que en pantalla no decía de qué color era — la fricción exacta que la etapa vino a quitar.
 */
describe('DetalleRenglonesOc — V1-E3u: la tela se compra POR COLOR (§Post-F9.89)', () => {
  /** Una OC de una tela pedida en un color, con lo propuesto y (opcional) el aviso del servidor. */
  function ocConColor(aviso: string | null) {
    const base = ocDePrueba();
    return {
      ...base,
      lineas: base.lineas.map((l) => ({
        ...l,
        idTelaColor: 77,
        telaColor: 'Marino Alsa 3040',
        idColorPrenda: null,
        colorPrenda: null,
        colorAvio: null,
        medidas: [],
        pantoneTelaColor: '19-4052 TCX',
        cantidad: 70,
        cantidadSugerida: 45,
        avisoDesvio: aviso,
      })),
    };
  }

  it('el renglón DICE el color junto a la tela', () => {
    renderConProveedores(<DetalleRenglonesOc oc={ocConColor(null)} />);
    // 🔴 Rojo si `descripcionMaterial` vuelve a soltar el color: diría 'Felpa francesa' a secas.
    expect(screen.getByText('Felpa francesa · Marino Alsa 3040')).toBeInTheDocument();
  });

  it('enseña lo que el sistema CALCULÓ al lado de lo que se pidió', () => {
    renderConProveedores(<DetalleRenglonesOc oc={ocConColor(null)} />);
    expect(screen.getByTestId('sugerida-detalle-oc')).toHaveTextContent('calculado: 45');
  });

  it('una línea capturada a mano no compara con nada (sin `cantidadSugerida`, sin leyenda)', () => {
    // Rojo si la pantalla inventa un "calculado: 0" donde el servidor mandó null — "no se sabe" no
    // es "no hubo desvío" (la misma regla que `porcentajeDeDesvio` guarda en el dominio).
    renderConProveedores(<DetalleRenglonesOc oc={ocDePrueba()} />);
    expect(screen.queryByTestId('sugerida-detalle-oc')).not.toBeInTheDocument();
  });

  it('🔴 el AVISO del servidor se lee completo en su propia fila', () => {
    const aviso =
      '"Felpa francesa · Marino Alsa 3040": se está pidiendo 70 m y el sistema calculó 45 m — ' +
      'un 55.6% de MÁS (el aviso salta arriba del 10%). No impide autorizar: decide tú.';
    renderConProveedores(<DetalleRenglonesOc oc={ocConColor(aviso)} />);
    expect(screen.getByTestId('fila-aviso-desvio-oc')).toHaveTextContent('55.6% de MÁS');
    expect(screen.getByTestId('fila-aviso-desvio-oc')).toHaveTextContent('No impide autorizar');
  });

  it('sin aviso no hay fila de aviso', () => {
    renderConProveedores(<DetalleRenglonesOc oc={ocConColor(null)} />);
    expect(screen.queryByTestId('fila-aviso-desvio-oc')).not.toBeInTheDocument();
  });
});

/**
 * ⭐⭐ **V1-E8c (§Post-F9.126)** — Daniel: *"al hacer la OC **no me aparece cantidad por medida…
 * sólo veo un solo renglón**"*. El desglose tiene que llegar a donde se mira la OC, no sólo a la
 * base: aquí, junto al material, y pegado a su renglón (la medida es del renglón, no un documento
 * aparte — no se recibe por medida).
 */
describe('DetalleRenglonesOc — V1-E8c: el color y el desglose por medida del avío', () => {
  /** Una OC con un renglón de cierre rojo desglosado por medida. */
  function ocConCierre() {
    return ocDePrueba({
      lineas: [
        {
          id: 10,
          idTela: null,
          tela: null,
          nombreComplementoTela: null,
          cantidadComplemento: null,
          precioComplemento: null,
          idAvio: 7,
          avio: 'CIE-53 — Cierre',
          idAvioProveedor: null,
          descripcionLibre: null,
          idTelaColor: null,
          telaColor: null,
          idColorPrenda: 9,
          colorPrenda: 'Rojo',
          colorAvio: 'Rojo',
          medidas: [
            { idAvioMedida: 100, etiqueta: '53 cm', cantidad: 1200, orden: 1 },
            { idAvioMedida: 200, etiqueta: '60 cm', cantidad: 800, orden: 2 },
          ],
          pantoneTelaColor: null,
          cantidadSugerida: null,
          avisoDesvio: null,
          cantidad: 2000,
          unidad: 'pza',
          precio: 6,
          subtotal: 12000,
          idOrden: null,
          folioOrden: null,
          tallas: [],
        },
      ],
      total: 12000,
    });
  }

  it('⭐ el material lleva su COLOR pegado (cuatro cierres no se leen idénticos)', () => {
    renderConProveedores(<DetalleRenglonesOc oc={ocConCierre()} />);
    expect(screen.getByText('CIE-53 — Cierre · Rojo')).toBeInTheDocument();
  });

  it('⭐ el DESGLOSE POR MEDIDA se pinta bajo el renglón, con etiqueta y cantidad', () => {
    renderConProveedores(<DetalleRenglonesOc oc={ocConCierre()} />);
    // 🔴 El valor que la pone roja: que el bloque no se pinte (el desglose viviría sólo en la base,
    // que es exactamente no haber resuelto lo que Daniel pidió).
    expect(screen.getByTestId('medidas-detalle-oc')).toHaveTextContent('53 cm: 1,200');
    expect(screen.getByTestId('medidas-detalle-oc')).toHaveTextContent('60 cm: 800');
  });

  it('un renglón SIN medidas no gana bloque (no se pinta una tablita vacía)', () => {
    renderConProveedores(<DetalleRenglonesOc oc={ocDePrueba()} />);
    expect(screen.queryByTestId('medidas-detalle-oc')).not.toBeInTheDocument();
  });
});

/**
 * ⭐ **LO QUE YA LLEGÓ Y LO QUE FALTA, POR RENGLÓN** (DANIEL, 23-sep-2026: *"estoy viendo las
 * órdenes con recibo parcial; no veo dónde diga que ya se recibió y qué falta por recibir"*).
 *
 * 🔑 **Lo que estas pruebas fijan es que la pantalla NO CALCULA.** Los tres números —pedido,
 * recibido, falta— y el veredicto `surtido` los sirve el dominio (`lineasPendientesDeOC`, el mismo
 * que precarga la captura de la recepción y el mismo `faltantePorRecibir` del estatus y del KPI).
 * Por eso el caso central manda un `pendiente` que **NO es** `cantidad − recibido`: si alguien
 * sustituyera esto por una resta local, la prueba se pondría roja — que es justo lo que una prueba
 * de «no dupliques el cálculo» tiene que hacer.
 */
describe('DetalleRenglonesOc — el avance de recepción por renglón (23-sep-2026)', () => {
  /** Una OC de tela con complemento (Cardigan), para medir las dos mitades del renglón. */
  function ocConComplemento() {
    const base = ocDePrueba();
    return {
      ...base,
      estatus: 'recibida_parcial' as const,
      lineas: base.lineas.map((l) => ({
        ...l,
        nombreComplementoTela: 'Cardigan',
        cantidadComplemento: 20,
        precioComplemento: 30,
      })),
    };
  }

  /** El avance del renglón 10, con overrides por caso. */
  function avance(over: Record<string, unknown> = {}) {
    return [
      {
        idOrdenCompraLinea: 10,
        tipo: 'tela' as const,
        cantidad: 100,
        recibido: 60,
        pendiente: 40,
        cantidadComplemento: null,
        recibidoComplemento: 0,
        pendienteComplemento: 0,
        surtido: false,
        ...over,
      },
    ];
  }

  it('sin `recepcion` la tabla queda EXACTAMENTE como estaba (ni columnas ni nota)', () => {
    renderConProveedores(<DetalleRenglonesOc oc={ocDePrueba()} />);
    expect(screen.queryByText('Recibido')).not.toBeInTheDocument();
    expect(screen.queryByText('Falta')).not.toBeInTheDocument();
    expect(screen.queryByTestId('recibido-renglon-oc')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nota-banda-recepcion')).not.toBeInTheDocument();
  });

  it('🔴 pinta lo RECIBIDO y lo que FALTA tal como los manda el servidor (no los calcula)', () => {
    renderConProveedores(
      <DetalleRenglonesOc
        oc={ocDePrueba()}
        // 🔴 `pendiente: 33` NO es `100 − 60`: es el número del dominio. Una resta local daría 40 y
        // esta aserción se pondría roja — que es el punto.
        recepcion={{ porLinea: avance({ pendiente: 33 }), cargando: false, error: false }}
      />,
    );
    expect(screen.getByText('Recibido')).toBeInTheDocument();
    expect(screen.getByTestId('recibido-renglon-oc')).toHaveTextContent('60');
    expect(screen.getByTestId('falta-renglon-oc')).toHaveTextContent('33');
    // Y lo PEDIDO sigue en su columna: los tres se leen juntos.
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('⭐ un renglón SURTIDO lo dice con letras, aunque lo recibido no cuadre exacto', () => {
    // La banda de tolerancia vive en el dominio: 96 de 100 puede venir con `surtido: true`. La
    // pantalla NO decide eso; lo obedece.
    renderConProveedores(
      <DetalleRenglonesOc
        oc={ocDePrueba()}
        recepcion={{
          porLinea: avance({ recibido: 96, pendiente: 0, surtido: true }),
          cargando: false,
          error: false,
        }}
      />,
    );
    expect(screen.getByTestId('falta-renglon-oc')).toHaveTextContent('Ya surtido');
    // Y se explica por qué un renglón puede estar surtido con menos de lo pedido.
    expect(screen.getByTestId('nota-banda-recepcion')).toHaveTextContent('banda de tolerancia');
  });

  it('⭐ el COMPLEMENTO (Cardigan) trae su propio recibido/falta, pegado a su cantidad', () => {
    renderConProveedores(
      <DetalleRenglonesOc
        oc={ocConComplemento()}
        recepcion={{
          porLinea: avance({
            cantidadComplemento: 20,
            recibidoComplemento: 8,
            pendienteComplemento: 12,
          }),
          cargando: false,
          error: false,
        }}
      />,
    );
    const complemento = screen.getByTestId('complemento-detalle-oc');
    expect(complemento).toHaveTextContent('recibido 8');
    expect(complemento).toHaveTextContent('falta 12');
  });

  it('🔴 un complemento ANUNCIADO pero SIN cantidad capturada tampoco gana la coletilla', () => {
    // El caso DE EN MEDIO, que es el que faltaba: no es «sin complemento» ni «complemento completo»,
    // sino uno que existe por nombre y al que nadie le puso cantidad. Sin la sub-condición
    // `cantidadComplemento !== null`, aquí se imprimiría «recibido 0 · falta 0» sobre algo que nadie
    // pidió. Lo cazó el reviewer mutando la condición (quitándola, no rompiendo el camino feliz).
    const base = ocDePrueba();
    renderConProveedores(
      <DetalleRenglonesOc
        oc={{
          ...base,
          estatus: 'recibida_parcial' as const,
          lineas: base.lineas.map((l) => ({
            ...l,
            nombreComplementoTela: 'Cardigan',
            cantidadComplemento: null,
            precioComplemento: null,
          })),
        }}
        recepcion={{ porLinea: avance(), cargando: false, error: false }}
      />,
    );
    expect(screen.getByTestId('complemento-detalle-oc')).toHaveTextContent(
      'falta capturar la cantidad',
    );
    expect(screen.queryByTestId('complemento-avance-oc')).not.toBeInTheDocument();
  });

  it('un renglón SIN complemento no gana esa coletilla', () => {
    renderConProveedores(
      <DetalleRenglonesOc
        oc={ocDePrueba()}
        recepcion={{ porLinea: avance(), cargando: false, error: false }}
      />,
    );
    expect(screen.queryByTestId('complemento-avance-oc')).not.toBeInTheDocument();
  });

  it('🔴 si la consulta FALLA se dice, y las celdas quedan en «—» (no se inventa una resta)', () => {
    renderConProveedores(
      <DetalleRenglonesOc
        oc={ocDePrueba()}
        recepcion={{ porLinea: undefined, cargando: false, error: true }}
      />,
    );
    expect(screen.getByTestId('avance-recepcion-error')).toHaveTextContent(
      'No se pudo consultar lo ya recibido',
    );
    expect(screen.getByTestId('recibido-renglon-oc')).toHaveTextContent('—');
    expect(screen.getByTestId('falta-renglon-oc')).toHaveTextContent('—');
  });

  it('mientras carga, las celdas dicen «…» y NO se anuncia ningún error', () => {
    renderConProveedores(
      <DetalleRenglonesOc
        oc={ocDePrueba()}
        recepcion={{ porLinea: undefined, cargando: true, error: false }}
      />,
    );
    expect(screen.getByTestId('recibido-renglon-oc')).toHaveTextContent('…');
    expect(screen.queryByTestId('avance-recepcion-error')).not.toBeInTheDocument();
  });

  it('un renglón que el servidor no trae queda en «—», no en cero (no se sabe ≠ no llegó nada)', () => {
    renderConProveedores(
      <DetalleRenglonesOc
        oc={ocDePrueba()}
        recepcion={{ porLinea: [], cargando: false, error: false }}
      />,
    );
    expect(screen.getByTestId('recibido-renglon-oc')).toHaveTextContent('—');
  });
});
