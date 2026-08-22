import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderConProveedores } from '@/pruebas/utilidades';

import { EditorLineasOc } from './EditorLineasOc';
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
  { id: 30, nombre: 'Felpa Alsatex', unidadMedida: 'KG' as const, nombreComplemento: null },
  { id: 40, nombre: 'Cardigan', unidadMedida: 'KG' as const, nombreComplemento: null },
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
        colores={[]}
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
    expect(screen.getByTestId('color-renglon-oc')).toHaveTextContent('Marino Alsa 3040');
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
    // Y deja de enseñarse, porque ya no hay color que enseñar.
    expect(screen.queryByTestId('color-renglon-oc')).toBeNull();
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
    fireEvent.click(screen.getByTestId('quitar-color-renglon-oc'));

    const ultimo = vistos.at(-1)?.[0];
    expect(ultimo?.idTelaColor).toBeNull();
    expect(ultimo?.idTela).toBe(30); // la tela se queda: sólo se soltó el color
  });

  it('en SOLO LECTURA no se ofrece quitar el color (§Post-F9.68: esconder Y bloquear)', () => {
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
        colores={[]}
        tallas={[]}
        soloLectura
      />,
    );
    expect(screen.getByTestId('color-renglon-oc')).toBeInTheDocument();
    expect(screen.queryByTestId('quitar-color-renglon-oc')).toBeNull();
  });
});
