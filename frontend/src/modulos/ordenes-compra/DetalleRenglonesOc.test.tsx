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
