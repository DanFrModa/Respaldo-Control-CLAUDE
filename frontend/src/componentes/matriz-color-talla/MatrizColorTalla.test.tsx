import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { MatrizColorTalla, type MatrizLinea, type MatrizTalla } from './MatrizColorTalla';

/** Tallas y colores de ejemplo. */
const TALLAS: MatrizTalla[] = [
  { idTalla: 1, etiqueta: 'CH' },
  { idTalla: 2, etiqueta: 'M' },
  { idTalla: 3, etiqueta: 'G' },
];
const COLORES = [
  { id: 10, nombre: 'Rojo' },
  { id: 20, nombre: 'Azul' },
  { id: 30, nombre: 'Verde' },
];

/** Envoltorio controlado: refleja los cambios igual que la pantalla real. */
function Anfitrion({
  tallasIniciales = TALLAS,
  lineasIniciales = [],
  soloLectura = false,
}: {
  tallasIniciales?: MatrizTalla[];
  lineasIniciales?: MatrizLinea[];
  soloLectura?: boolean;
}): React.JSX.Element {
  const [tallas, setTallas] = useState<MatrizTalla[]>(tallasIniciales);
  const [lineas, setLineas] = useState<MatrizLinea[]>(lineasIniciales);
  return (
    <MatrizColorTalla
      tallas={tallas}
      lineas={lineas}
      coloresDisponibles={COLORES}
      tallasDisponibles={[...TALLAS, { idTalla: 4, etiqueta: 'XG' }]}
      onTallasChange={setTallas}
      onLineasChange={setLineas}
      soloLectura={soloLectura}
      testid="m"
    />
  );
}

/** Una línea de ejemplo (Rojo con CH=2, M=3). */
function lineaRojo(): MatrizLinea {
  return { idColor: 10, color: 'Rojo', cantidades: { 1: 2, 2: 3 } };
}

describe('<MatrizColorTalla>', () => {
  it('calcula los totales en vivo por fila, columna y total al teclear', async () => {
    const usuario = userEvent.setup();
    render(
      <Anfitrion lineasIniciales={[lineaRojo(), { idColor: 20, color: 'Azul', cantidades: {} }]} />,
    );

    // Total de la primera fila (2 + 3 = 5).
    const totalesFila = screen.getAllByTestId('m-total-fila');
    expect(totalesFila[0]).toHaveTextContent('5');

    // Captura Azul/CH = 4 → total columna CH = 2 + 4 = 6, total general = 9.
    const celdas = screen.getAllByTestId('m-celda');
    // Fila Azul (segunda fila), columna CH (primera). Tres columnas por fila → índice 3.
    const celdaAzulCh = celdas[3];
    if (celdaAzulCh) {
      await usuario.type(celdaAzulCh, '4');
    }

    const totalesColumna = screen.getAllByTestId('m-total-columna');
    expect(totalesColumna[0]).toHaveTextContent('6');
    expect(screen.getByTestId('m-total-general')).toHaveTextContent('9');
  });

  it('permite capturar una fila completa SOLO con teclado (Enter/flechas mueven el foco)', async () => {
    const usuario = userEvent.setup();
    render(<Anfitrion lineasIniciales={[lineaRojo()]} />);

    const celdas = screen.getAllByTestId('m-celda');
    // Enfoca la primera celda y escribe; ArrowRight pasa a la siguiente columna sin mouse.
    celdas[0]?.focus();
    await usuario.keyboard('7');
    await usuario.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(celdas[1]);
    await usuario.keyboard('8');
    await usuario.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(celdas[2]);

    // La fila quedó 7 + 8 + 0 = 15 (G estaba vacío).
    expect(screen.getByTestId('m-total-fila')).toHaveTextContent('15');
  });

  it('agrega una talla fuera de curva y entra en el total', async () => {
    const usuario = userEvent.setup();
    render(<Anfitrion lineasIniciales={[lineaRojo()]} />);

    // Agrega la talla XG (fuera de la curva inicial).
    await usuario.selectOptions(screen.getByTestId('m-agregar-talla'), '4');

    // Ahora hay 4 columnas; captura la nueva (XG) de Rojo con 5.
    const celdas = screen.getAllByTestId('m-celda');
    expect(celdas).toHaveLength(4);
    const celdaXg = celdas[3];
    if (celdaXg) {
      await usuario.type(celdaXg, '5');
    }
    // Total de la fila: 2 + 3 + 0 + 5 = 10.
    expect(screen.getByTestId('m-total-fila')).toHaveTextContent('10');
  });

  it('bloquea el color duplicado en la UX (no aparece en el selector si ya se usó)', () => {
    render(<Anfitrion lineasIniciales={[lineaRojo()]} />);
    const selector = screen.getByTestId('m-agregar-color');
    // Rojo ya está usado → no es opción; Azul y Verde sí.
    expect(within(selector).queryByRole('option', { name: 'Rojo' })).not.toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: 'Azul' })).toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: 'Verde' })).toBeInTheDocument();
  });

  it('agrega y quita un color (fila)', async () => {
    const usuario = userEvent.setup();
    render(<Anfitrion lineasIniciales={[]} />);

    // Sin filas: mensaje de ayuda.
    expect(screen.getByText(/Agrega un color para empezar/)).toBeInTheDocument();

    await usuario.selectOptions(screen.getByTestId('m-agregar-color'), '20');
    expect(screen.getAllByTestId('m-fila')).toHaveLength(1);
    expect(screen.getByText('Azul')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('m-quitar-color'));
    expect(screen.queryByTestId('m-fila')).not.toBeInTheDocument();
  });

  it('renderiza una matriz grande sin error (muchas filas y columnas)', () => {
    const muchasTallas: MatrizTalla[] = Array.from({ length: 8 }, (_, i) => ({
      idTalla: i + 1,
      etiqueta: `T${i + 1}`,
    }));
    const muchasLineas: MatrizLinea[] = Array.from({ length: 30 }, (_, i) => ({
      idColor: 1000 + i,
      color: `Color ${i}`,
      cantidades: { 1: i, 2: i * 2 },
    }));
    render(
      <MatrizColorTalla
        tallas={muchasTallas}
        lineas={muchasLineas}
        coloresDisponibles={[]}
        tallasDisponibles={[]}
        onTallasChange={() => undefined}
        onLineasChange={() => undefined}
        testid="big"
      />,
    );
    // 30 filas × 8 columnas = 240 celdas.
    expect(screen.getAllByTestId('big-celda')).toHaveLength(240);
    expect(screen.getAllByTestId('big-fila')).toHaveLength(30);
  });

  it('en solo lectura muestra valores sin inputs ni controles de edición', () => {
    render(<Anfitrion lineasIniciales={[lineaRojo()]} soloLectura />);
    // No hay selectores de agregar ni botones de quitar.
    expect(screen.queryByTestId('m-agregar-color')).not.toBeInTheDocument();
    expect(screen.queryByTestId('m-quitar-color')).not.toBeInTheDocument();
    // Las celdas son texto (no inputs).
    const celdas = screen.getAllByTestId('m-celda');
    expect(celdas[0]?.tagName).not.toBe('INPUT');
    expect(celdas[0]).toHaveTextContent('2');
  });
});
