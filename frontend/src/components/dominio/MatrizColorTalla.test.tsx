import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import {
  claveCelda,
  estadoCaptura,
  MatrizColorTalla,
  type CeldaColor,
  type CeldaTalla,
} from './MatrizColorTalla';

const TALLAS: readonly CeldaTalla[] = [
  { idTalla: 1, etiqueta: 'CH' },
  { idTalla: 2, etiqueta: 'M' },
  { idTalla: 3, etiqueta: 'G' },
];
const COLORES: readonly CeldaColor[] = [
  { idColor: 10, nombre: 'Rojo A' },
  { idColor: 20, nombre: 'Rojo B' },
];

describe('estadoCaptura (cuadra / faltan / sobran)', () => {
  it('cuadra cuando el total es igual a la referencia', () => {
    expect(estadoCaptura(100, 100)).toEqual({ tono: 'ok', texto: 'Cuadra con el pendiente' });
  });

  it('faltan N cuando el total es menor', () => {
    const estado = estadoCaptura(80, 100);
    expect(estado.tono).toBe('warn');
    expect(estado.texto).toContain('Faltan 20');
  });

  it('sobran N cuando el total excede la referencia', () => {
    const estado = estadoCaptura(120, 100);
    expect(estado.tono).toBe('crit');
    expect(estado.texto).toContain('Sobran 20');
  });

  it('el sustantivo de la referencia es configurable (el recibo lo nombra a su manera)', () => {
    // El recibo llama a la referencia «lo que todavía se le puede recibir», que desde V1-E8v
    // (§Post-F9.147) es EL MISMO número que el pendiente del maquilero: sólo cambia el nombre, en
    // el idioma de esa pantalla.
    const recibible = 'lo que todavía se le puede recibir';
    expect(estadoCaptura(100, 100, recibible)).toEqual({
      tono: 'ok',
      texto: `Cuadra con ${recibible}`,
    });
    expect(estadoCaptura(120, 100, recibible).texto).toContain(`sobre ${recibible}`);
    // Y el default NO cambió para corte/envío, que sí siguen midiendo el pendiente.
    expect(estadoCaptura(100, 100).texto).toBe('Cuadra con el pendiente');
  });

  it('sin referencia solo informa lo capturado (tono neutro)', () => {
    const estado = estadoCaptura(15, undefined);
    expect(estado.tono).toBe('neutro');
    expect(estado.texto).toContain('15');
  });
});

/** Arnés controlado: el padre es dueño de los valores por celda. */
function Arnes({
  totalReferencia,
  referencia,
}: {
  totalReferencia?: number;
  referencia?: ReadonlyMap<string, number>;
}): React.JSX.Element {
  const [valores, setValores] = useState<Record<string, number>>({});
  return (
    <MatrizColorTalla
      tallas={TALLAS}
      colores={COLORES}
      valores={valores}
      onCambiar={(idColor, idTalla, cantidad) =>
        setValores((v) => ({ ...v, [claveCelda(idColor, idTalla)]: cantidad }))
      }
      {...(totalReferencia === undefined ? {} : { totalReferencia })}
      {...(referencia === undefined ? {} : { referencia })}
      testid="mc"
    />
  );
}

describe('<MatrizColorTalla> (candado)', () => {
  it('pinta EXACTAMENTE las filas/columnas de la orden, sin controles de agregar/quitar', () => {
    render(<Arnes />);
    expect(screen.getAllByTestId('mc-fila')).toHaveLength(2);
    expect(screen.getAllByTestId('mc-celda')).toHaveLength(6); // 2 colores × 3 tallas
    expect(screen.queryByText(/Agregar color/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Agregar talla/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Candado: solo colores y tallas de la orden/)).toBeInTheDocument();
  });

  it('capturar celdas suma solos los totales de fila, columna y general', async () => {
    const usuario = userEvent.setup();
    render(<Arnes />);
    const celdas = screen.getAllByTestId('mc-celda');
    await usuario.type(celdas[0] as HTMLElement, '10'); // Rojo A · CH
    await usuario.type(celdas[1] as HTMLElement, '5'); // Rojo A · M
    await usuario.type(celdas[3] as HTMLElement, '7'); // Rojo B · CH

    const totalesFila = screen.getAllByTestId('mc-total-fila');
    expect(totalesFila[0]).toHaveTextContent('15');
    expect(totalesFila[1]).toHaveTextContent('7');
    const totalesColumna = screen.getAllByTestId('mc-total-columna');
    expect(totalesColumna[0]).toHaveTextContent('17');
    expect(screen.getByTestId('mc-total-general')).toHaveTextContent('22');
  });

  it('valida contra la referencia: faltan → parcial; igual → cuadra; más → sobran', async () => {
    const usuario = userEvent.setup();
    render(<Arnes totalReferencia={20} />);
    const celdas = screen.getAllByTestId('mc-celda');

    await usuario.type(celdas[0] as HTMLElement, '15');
    expect(screen.getByTestId('mc-estado')).toHaveTextContent('Faltan 5');

    await usuario.type(celdas[1] as HTMLElement, '5');
    expect(screen.getByTestId('mc-estado')).toHaveTextContent('Cuadra con el pendiente');

    await usuario.type(celdas[2] as HTMLElement, '9');
    expect(screen.getByTestId('mc-estado')).toHaveTextContent('Sobran 9');
  });

  it('muestra el hint "de N" por celda cuando hay referencia por celda', () => {
    const referencia = new Map([[claveCelda(10, 1), 40]]);
    render(<Arnes referencia={referencia} />);
    const hints = screen.getAllByTestId('mc-hint');
    expect(hints).toHaveLength(1);
    expect(hints[0]).toHaveTextContent('de 40');
  });

  it('un pendiente NEGATIVO (sobre-corte) se clampa a "de 0", nunca "de -N"', () => {
    const referencia = new Map([[claveCelda(10, 1), -2]]);
    render(<Arnes referencia={referencia} />);
    expect(screen.getByTestId('mc-hint')).toHaveTextContent('de 0');
  });
});
