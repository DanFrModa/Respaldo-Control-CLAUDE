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
  conPantone = false,
  conPacks = false,
}: {
  tallasIniciales?: MatrizTalla[];
  lineasIniciales?: MatrizLinea[];
  soloLectura?: boolean;
  conPantone?: boolean;
  conPacks?: boolean;
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
      {...(conPantone
        ? {
            // La fila se identifica por POSICIÓN (§Post-F9.10): con packs el `idColor` se repite.
            onPantoneChange: (indice: number, pantone: string) =>
              setLineas((prev) => prev.map((l, i) => (i === indice ? { ...l, pantone } : l))),
          }
        : {})}
      {...(conPacks
        ? {
            onPackChange: (indice: number, pack: string) =>
              setLineas((prev) => prev.map((l, i) => (i === indice ? { ...l, pack } : l))),
          }
        : {})}
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

  it('captura el PANTONE por color cuando el flujo lo habilita (petición Daniel)', async () => {
    const usuario = userEvent.setup();
    render(<Anfitrion lineasIniciales={[lineaRojo()]} conPantone />);
    const pantone = screen.getByTestId('m-pantone');
    expect(pantone.tagName).toBe('INPUT');
    await usuario.type(pantone, '11-0601 TCX');
    expect(pantone).toHaveValue('11-0601 TCX');
  });

  // ── EL PACK / TENDIDO (§Post-F9.10) ──────────────────────────────────────────────────────────

  /** Dos tendidos del MISMO color: el caso que el `idColor` como llave de fila no sabía distinguir. */
  function dosTendidos(): MatrizLinea[] {
    return [
      { idColor: 10, color: 'Rojo', cantidades: { 1: 2 }, pack: 'A' },
      { idColor: 10, color: 'Rojo', cantidades: { 1: 7 }, pack: 'B' },
    ];
  }

  it('sin `onPackChange` NO hay columna Pack (los demás flujos no ven nada nuevo)', () => {
    render(<Anfitrion lineasIniciales={[lineaRojo()]} />);
    expect(screen.queryByTestId('m-pack')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Pack' })).not.toBeInTheDocument();
  });

  it('con packs, teclear en un tendido NO toca el otro del mismo color', async () => {
    const usuario = userEvent.setup();
    render(<Anfitrion lineasIniciales={dosTendidos()} conPacks />);
    const celdas = screen.getAllByTestId('m-celda');

    // Fila 1 (pack A), columna CH. Con la fila llaveada por `idColor` esto habría escrito en LAS DOS.
    await usuario.type(celdas[0] as HTMLElement, '{selectall}5');

    const totalesFila = screen.getAllByTestId('m-total-fila');
    expect(totalesFila[0]).toHaveTextContent('5');
    expect(totalesFila[1]).toHaveTextContent('7');
    expect(screen.getByTestId('m-total-general')).toHaveTextContent('12');
  });

  it('con un tendido ya capturado, el color YA USADO se sigue ofreciendo (el 2º tendido es otra fila)', () => {
    render(<Anfitrion lineasIniciales={[{ ...lineaRojo(), pack: 'A' }]} conPacks />);
    const selector = screen.getByTestId('m-agregar-color');
    // Sin packs, Rojo se ocultaba (y su prueba de al lado lo sigue exigiendo). Con un tendido ya
    // puesto NO: ocultarlo dejaría el segundo tendido del Rojo sin manera de capturarse.
    expect(within(selector).getByRole('option', { name: 'Rojo' })).toBeInTheDocument();
  });

  it('con la columna Pack pero SIN ningún tendido capturado, el color usado se sigue ocultando', () => {
    // La protección de siempre contra el color duplicado no se pierde por el mero hecho de que el
    // flujo pueda manejar tendidos: casi ninguna orden los usa, y ahí repetir un color es el
    // duplicado que el servidor rechaza.
    render(<Anfitrion lineasIniciales={[lineaRojo()]} conPacks />);
    const selector = screen.getByTestId('m-agregar-color');
    expect(within(selector).queryByRole('option', { name: 'Rojo' })).not.toBeInTheDocument();
  });

  it('el PACK se teclea entero sin perder el foco (la fila no se remonta por tecla)', async () => {
    const usuario = userEvent.setup();
    render(
      <Anfitrion
        lineasIniciales={[{ idColor: 10, color: 'Rojo', cantidades: { 1: 2 }, pack: '' }]}
        conPacks
      />,
    );
    const pack = screen.getByTestId('m-pack');
    await usuario.type(pack, 'AB');
    // Si la `key` de la fila incluyera el pack, la fila se remontaría al escribir la "A", el foco
    // se perdería y la "B" no llegaría: quedaría "A".
    expect(pack).toHaveValue('AB');
    expect(document.activeElement).toBe(pack);
  });

  it('quitar el SEGUNDO tendido deja vivo al primero (se quita por posición, no por color)', async () => {
    const usuario = userEvent.setup();
    render(<Anfitrion lineasIniciales={dosTendidos()} conPacks />);
    const botones = screen.getAllByTestId('m-quitar-color');
    await usuario.click(botones[1] as HTMLElement);

    // Quitar "por idColor" habría borrado LAS DOS filas del Rojo.
    expect(screen.getAllByTestId('m-fila')).toHaveLength(1);
    expect(screen.getByTestId('m-pack')).toHaveValue('A');
  });

  it('en solo lectura muestra el PANTONE de la fila como texto (sin input)', () => {
    render(
      <Anfitrion
        lineasIniciales={[
          { idColor: 10, color: 'Rojo', cantidades: { 1: 2 }, pantone: '19-3920 TCX' },
        ]}
        soloLectura
      />,
    );
    const pantone = screen.getByTestId('m-pantone');
    expect(pantone.tagName).not.toBe('INPUT');
    expect(pantone).toHaveTextContent('PANTONE 19-3920 TCX');
  });
});
