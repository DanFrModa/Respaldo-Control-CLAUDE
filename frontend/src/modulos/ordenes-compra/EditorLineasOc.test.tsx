import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { elegirEnCombobox, renderConProveedores } from '@/pruebas/utilidades';

import { EditorLineasOc } from './EditorLineasOc';

// El buscador de color de la matriz (fila 0.192) consulta el catálogo en el SERVIDOR.
vi.mock('@/api/colores', () => ({
  useColores: () => ({ data: { datos: [{ id: 55, nombre: 'Rojo Cereza' }] }, isPending: false }),
}));
import { renglonVacio, type RenglonOcCaptura } from './captura';

/**
 * ⭐⭐ **EL COLOR EN EL EDITOR DE LA OC** (V1-E3u, §Post-F9.89 · hallazgo D3 de la revisión).
 *
 * 🔴 El problema que estas pruebas cierran: un `TelaColor` cuelga de SU tela — el "Marino" de la
 * felpa no existe en el cardigan. El editor conservaba `idTelaColor` al cambiar de tela y **nunca lo
 * mostraba**, así que el cerrojo del dominio rechazaba el guardado con *"el color «Marino» es de la
 * tela «Felpa», no de «Cardigan»"* y el usuario leía el error **sin ningún control para
 * corregirlo**: un error sin salida, y encima sobre un dato invisible.
 */
const TELAS = [
  {
    id: 30,
    nombre: 'Felpa Alsatex',
    unidadMedida: 'KG' as const,
    nombreComplemento: null,
    colores: [
      { id: 77, nombre: 'Marino Alsa 3040', pantone: '19-4023' },
      { id: 78, nombre: 'Blanco', pantone: null },
    ],
  },
  {
    id: 40,
    nombre: 'Cardigan',
    unidadMedida: 'KG' as const,
    nombreComplemento: null,
    colores: [{ id: 91, nombre: 'Negro', pantone: null }],
  },
];

/** Monta el editor con estado real (es controlado) y un renglón de felpa que YA trae color. */
function montarConColor() {
  const inicial: RenglonOcCaptura = {
    ...renglonVacio(),
    idTela: 30,
    idTelaColor: 77,
    telaColor: 'Marino Alsa 3040',
    cantidad: '100',
    precio: '12',
  };
  const vistos: RenglonOcCaptura[][] = [];
  function Envoltura() {
    const [renglones, setRenglones] = useState<RenglonOcCaptura[]>([inicial]);
    return (
      <EditorLineasOc
        renglones={renglones}
        alCambiar={(r) => {
          vistos.push(r);
          setRenglones(r);
        }}
        telas={TELAS as never}
        mensajeSinTelas="sin telas"
        avios={[]}
        ordenes={[]}
        tallas={[]}
      />
    );
  }
  renderConProveedores(<Envoltura />);
  return vistos;
}

describe('<EditorLineasOc> · el color de la tela (§Post-F9.89)', () => {
  it('el renglón ENSEÑA el color que pide (antes viajaba invisible)', () => {
    montarConColor();
    expect(screen.getByTestId('selector-color-tela-oc')).toHaveValue('77');
  });

  it('🔴 cambiar de TELA suelta el color: el color era de la tela anterior', () => {
    const vistos = montarConColor();
    fireEvent.change(screen.getByTestId('selector-tela-oc'), { target: { value: '40' } });

    const ultimo = vistos.at(-1)?.[0];
    // 🔴 EL VALOR QUE LO PONE ROJO: `idTelaColor: 77` conservado — que es lo que hacía que el
    // dominio rechazara el guardado con un error que el usuario no podía corregir desde aquí.
    expect(ultimo?.idTela).toBe(40);
    expect(ultimo?.idTelaColor).toBeNull();
    expect(ultimo?.telaColor).toBeNull();
    // Y el combo pasa a ser el de la tela NUEVA: sin color elegido y con los colores del cardigan.
    expect(screen.getByTestId('selector-color-tela-oc')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Negro' })).toBeInTheDocument();
  });

  it('re-elegir la MISMA tela NO pierde el color (no es un cambio)', () => {
    const vistos = montarConColor();
    fireEvent.change(screen.getByTestId('selector-tela-oc'), { target: { value: '30' } });

    const ultimo = vistos.at(-1)?.[0];
    // Rojo si se limpiara siempre: tocar el combo sin cambiar nada tiraría un dato bueno.
    expect(ultimo?.idTelaColor).toBe(77);
  });

  it('cambiar de TIPO (a avío) suelta el color: el color es de la TELA', () => {
    const vistos = montarConColor();
    fireEvent.change(screen.getByLabelText('Tipo de material del renglón 1'), {
      target: { value: 'avio' },
    });

    const ultimo = vistos.at(-1)?.[0];
    // El dominio rechaza un renglón de avío con color ("no es de tela; no puede llevar color").
    expect(ultimo?.tipo).toBe('avio');
    expect(ultimo?.idTelaColor).toBeNull();
  });

  it('se puede QUITAR el color a mano, sin cambiar de tela', () => {
    const vistos = montarConColor();
    fireEvent.change(screen.getByTestId('selector-color-tela-oc'), { target: { value: '' } });

    const ultimo = vistos.at(-1)?.[0];
    expect(ultimo?.idTelaColor).toBeNull();
    expect(ultimo?.telaColor).toBeNull();
    expect(ultimo?.idTela).toBe(30); // la tela se queda: sólo se soltó el color
  });

  it('en SOLO LECTURA el color se VE pero no se toca (§Post-F9.68: esconder Y bloquear)', () => {
    renderConProveedores(
      <EditorLineasOc
        renglones={[
          { ...renglonVacio(), idTela: 30, idTelaColor: 77, telaColor: 'Marino Alsa 3040' },
        ]}
        alCambiar={vi.fn()}
        telas={TELAS as never}
        mensajeSinTelas="sin telas"
        avios={[]}
        ordenes={[]}
        tallas={[]}
        soloLectura
      />,
    );
    expect(screen.getByTestId('selector-color-tela-oc')).toHaveValue('77');
    expect(screen.getByTestId('selector-color-tela-oc')).toBeDisabled();
  });
});

/**
 * ⭐⭐ **FILA 0.160 (§Post-F9.213·B) — EL COLOR DEL RENGLÓN AÑADIDO A MANO.**
 *
 * 🔴 El agujero que estas pruebas cierran: el único camino manual que resuelve el caso de las
 * mangas (*"es la misma tela, pero las mangas van de otro color"*) es agregar a mano un SEGUNDO
 * renglón de la misma tela… y ese renglón **nacía sin color y sin control para ponérselo**. Sin
 * color, la recepción no cruza nada (`recepciones.ts`: el cruce sólo se hace si el renglón lo trae)
 * y esos kilos entran de cualquier tono — justo el mal que V1-E3u cerró.
 */
describe('<EditorLineasOc> · fila 0.160 — elegir el color del renglón', () => {
  /** Dos renglones de LA MISMA tela: el primero con color, el segundo (a mano) sin él. */
  function montarDosRenglonesDeLaMismaTela() {
    const vistos: RenglonOcCaptura[][] = [];
    function Envoltura() {
      const [renglones, setRenglones] = useState<RenglonOcCaptura[]>([
        { ...renglonVacio(), idTela: 30, idTelaColor: 77, telaColor: 'Marino Alsa 3040' },
        { ...renglonVacio(), idTela: 30 },
      ]);
      return (
        <EditorLineasOc
          renglones={renglones}
          alCambiar={(r) => {
            vistos.push(r);
            setRenglones(r);
          }}
          telas={TELAS as never}
          mensajeSinTelas="sin telas"
          avios={[]}
          ordenes={[]}
          tallas={[]}
        />
      );
    }
    renderConProveedores(<Envoltura />);
    return vistos;
  }

  it('🔴 el renglón SIN color se le puede PONER desde el selector (el agujero de la fila)', () => {
    const vistos = montarDosRenglonesDeLaMismaTela();
    // 🔴 El valor que la pone roja: antes de la fila este control NO EXISTÍA.
    const selectores = screen.getAllByTestId('selector-color-tela-oc');
    expect(selectores[1]).toHaveValue('');
    fireEvent.change(selectores[1] as HTMLElement, { target: { value: '78' } });

    const ultimo = vistos.at(-1);
    expect(ultimo?.[1]?.idTelaColor).toBe(78);
    // El NOMBRE viaja con él: es lo que se lee mientras se edita y lo que el impreso enseña.
    expect(ultimo?.[1]?.telaColor).toBe('Blanco');
    // Y no tocó a su hermano.
    expect(ultimo?.[0]?.idTelaColor).toBe(77);
  });

  it('el selector ofrece SOLO los colores de ESA tela, con su pantone', () => {
    montarDosRenglonesDeLaMismaTela();
    const opciones = [
      ...(screen.getAllByTestId('selector-color-tela-oc')[0] as HTMLSelectElement).options,
    ].map((o) => o.textContent);
    expect(opciones).toEqual([
      'Sin color (no se podrá cuadrar al recibir)',
      'Marino Alsa 3040 (19-4023)',
      'Blanco',
    ]);
    // El "Negro" es del Cardigan (tela 40): no puede aparecer aquí (el dominio lo rechazaría).
    expect(opciones).not.toContain('Negro');
  });

  it('avisa cuando la MISMA tela se repite y este renglón se quedó mudo', () => {
    const vistos = montarDosRenglonesDeLaMismaTela();
    // Sólo en el renglón sin color: el que sí lo dice no tiene nada que corregir.
    expect(screen.getAllByTestId('aviso-color-tela-repetida-oc')).toHaveLength(1);

    fireEvent.change(screen.getAllByTestId('selector-color-tela-oc')[1] as HTMLElement, {
      target: { value: '78' },
    });
    expect(vistos.at(-1)?.[1]?.idTelaColor).toBe(78);
    expect(screen.queryByTestId('aviso-color-tela-repetida-oc')).toBeNull();
  });

  it('con la tela SIN repetir no hay aviso (comprar sin color sigue siendo legítimo)', () => {
    renderConProveedores(
      <EditorLineasOc
        renglones={[{ ...renglonVacio(), idTela: 30 }]}
        alCambiar={vi.fn()}
        telas={TELAS as never}
        mensajeSinTelas="sin telas"
        avios={[]}
        ordenes={[]}
        tallas={[]}
      />,
    );
    expect(screen.getByTestId('selector-color-tela-oc')).toHaveValue('');
    expect(screen.queryByTestId('aviso-color-tela-repetida-oc')).toBeNull();
  });

  it('una tela que ya no está en la lista se VE en sólo lectura (no se pierde el dato)', () => {
    renderConProveedores(
      <EditorLineasOc
        renglones={[{ ...renglonVacio(), idTela: 99, idTelaColor: 5, telaColor: 'Arena' }]}
        alCambiar={vi.fn()}
        telas={TELAS as never}
        mensajeSinTelas="sin telas"
        avios={[]}
        ordenes={[]}
        tallas={[]}
      />,
    );
    expect(screen.queryByTestId('selector-color-tela-oc')).toBeNull();
    expect(screen.getByTestId('color-renglon-oc')).toHaveTextContent('Arena');
  });
});

/**
 * ⭐ FILA 0.192 — LA MATRIZ TALLA × COLOR DE LA OC BUSCA EL COLOR EN EL SERVIDOR.
 *
 * Antes el diálogo pre-cargaba `useColores({ porPagina: 100 })` y se lo pasaba a la matriz, y **100
 * es el tope del contrato** (`contrato/esquemas/color.ts`): con más de cien colores activos, los del
 * final del alfabeto no aparecían en el desplegable y la compra no se podía desglosar por ellos.
 */
describe('<EditorLineasOc> · el color de la matriz (fila 0.192)', () => {
  it('agrega la fila del color elegido en el buscador', async () => {
    montarConColor();
    fireEvent.click(screen.getByTestId('alternar-matriz-oc'));

    await elegirEnCombobox('matriz-oc-0-agregar-color', 'Rojo Cereza');

    expect(screen.getByTestId('matriz-oc-0-fila')).toHaveTextContent('Rojo Cereza');
  });

  /**
   * El color que ya es fila no se vuelve a ofrecer: quien lo esconde dejó de ser el `<select>` de la
   * matriz y pasó a ser el `excluirIds` que este editor le pasa al buscador. Sin él, el editor
   * invita a capturar dos veces el mismo color y el servidor rechaza la OC al guardar.
   */
  it('el color YA capturado desaparece del buscador (no se puede repetir la fila)', async () => {
    montarConColor();
    fireEvent.click(screen.getByTestId('alternar-matriz-oc'));
    await elegirEnCombobox('matriz-oc-0-agregar-color', 'Rojo Cereza');

    const input = screen.getByTestId('matriz-oc-0-agregar-color-busqueda');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Rojo' } });
    expect(await screen.findByText('No hay colores que coincidan.')).toBeInTheDocument();
  });
});
