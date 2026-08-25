import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoColoresDeTela } from './DialogoColoresDeTela';

/**
 * ⭐⭐ **V1-E4c — LA VISTA COMPLETA DE LOS COLORES DE UNA ORDEN TAMBIÉN OBEDECE LA REGLA.**
 *
 * Esta pantalla existe desde V1-E3u (§Post-F9.89) y **llegó a esta etapa sin mirar `puedeCambiar`**.
 * V1-E4c la volvió incoherente consigo misma: el renglón de la explosión pinta el campo GRIS con su
 * motivo, y este diálogo —al que se llega **desde ese mismo renglón**, con el enlace que la etapa
 * agregó— lo enseñaba ABIERTO; cambiarlo se comía un 409 que la pantalla anterior ya sabía
 * predecir. Estas pruebas fijan que las dos digan lo mismo.
 */

const useColoresDeTelaMock = vi.fn();
const asignarMutateMock = vi.fn();
vi.mock('@/api/mrp', () => ({
  useColoresDeTela: (id: unknown) => useColoresDeTelaMock(id) as unknown,
  useAsignarColorTela: () => ({ mutate: asignarMutateMock, isPending: false }) as unknown,
  useFijarPrecioColor: () => ({ mutate: vi.fn(), isPending: false }) as unknown,
}));

/** Un color de la matriz de la OP, tal como lo entrega el servidor. */
function colorDeLaOrden(over: Record<string, unknown> = {}) {
  return {
    idColor: 900,
    color: 'Azul',
    pantone: null,
    piezas: 10,
    cantidadRequerida: 15,
    idTelaColor: 77,
    telaColor: 'Grana 7700',
    propuestaIdTelaColor: null,
    propuestaTelaColor: null,
    origenPropuesta: 'sin-propuesta',
    puedeCambiar: true,
    motivoNoCambiar: null,
    ...over,
  };
}

/** La respuesta de `colores-tela` de la orden 50. */
function respuesta(colores: unknown[]) {
  return {
    data: {
      idOrden: 50,
      folio: 7,
      sinMatrizColores: false,
      telas: [
        {
          idOrdenTela: 1,
          idTela: 4,
          tela: 'Felpa 280',
          unidad: 'm',
          consumoPorPrenda: 1.5,
          excluido: false,
          liberado: true,
          colores,
          opciones: [
            {
              idTelaColor: 77,
              nombre: 'Grana 7700',
              pantone: '19-1664 TCX',
              precio: 80,
              precioComplemento: null,
            },
            {
              idTelaColor: 78,
              nombre: 'Marino Alsa 3040',
              pantone: null,
              precio: 95,
              precioComplemento: null,
            },
          ],
        },
      ],
    },
    isPending: false,
  };
}

function abrir(): void {
  renderConProveedores(
    <DialogoColoresDeTela
      abierto
      alCambiarAbierto={() => {}}
      idOrden={50}
      folioOrden={7}
      puedeEditar
    />,
    { sesion: estadoSesionDePrueba(['compras.ver', 'compras.administrar']) },
  );
}

describe('DialogoColoresDeTela — V1-E4c: la regla de hasta cuándo se puede cambiar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('un color que SÍ se puede cambiar sale abierto y sin motivo', () => {
    useColoresDeTelaMock.mockReturnValue(respuesta([colorDeLaOrden()]));
    abrir();
    expect(screen.getByTestId('colores-tela-select')).not.toBeDisabled();
    expect(screen.queryByTestId('colores-tela-bloqueado')).toBeNull();
  });

  /**
   * 🔴 **LA INCOHERENCIA QUE INTRODUJO ESTA ETAPA.** El valor que la pone roja es exactamente el
   * código con el que el diálogo llegó: `disabled={!puedeEditar || guardando}`, sin mirar la regla.
   */
  it('🔴 con la OC AUTORIZADA el desplegable se BLOQUEA y se pinta el motivo del servidor', () => {
    const motivo =
      'El color "Grana 7700" ya está COMPRADO para esta orden en la orden de compra #812 ' +
      '(autorizada): no se puede cambiar. … hay que DES-AUTORIZAR esa orden de compra …';
    useColoresDeTelaMock.mockReturnValue(
      respuesta([colorDeLaOrden({ puedeCambiar: false, motivoNoCambiar: motivo })]),
    );
    abrir();
    expect(screen.getByTestId('colores-tela-select')).toBeDisabled();
    const bloqueado = screen.getByTestId('colores-tela-bloqueado');
    expect(bloqueado).toHaveTextContent('DES-AUTORIZAR');
    expect(bloqueado).toHaveTextContent('#812');
  });

  /**
   * El atajo «Usar «propuesta»» escribe lo mismo que el desplegable: si el desplegable no puede,
   * él tampoco. Una guarda que se salta por la puerta de al lado no es una guarda.
   */
  it('🔴 el atajo «Usar la propuesta» obedece la MISMA regla', () => {
    useColoresDeTelaMock.mockReturnValue(
      respuesta([
        colorDeLaOrden({
          idTelaColor: null,
          telaColor: null,
          propuestaIdTelaColor: 78,
          propuestaTelaColor: 'Marino Alsa 3040',
          origenPropuesta: 'mismo-pantone',
          puedeCambiar: false,
          motivoNoCambiar: 'Ya se RECIBIÓ contra la orden de compra #812.',
        }),
      ]),
    );
    abrir();
    expect(screen.getByTestId('colores-tela-usar-propuesta')).toBeDisabled();
    expect(screen.getByTestId('colores-tela-bloqueado')).toHaveTextContent('RECIBIÓ');
  });

  it('sin `compras.administrar` (solo lectura) el campo también está cerrado', () => {
    useColoresDeTelaMock.mockReturnValue(respuesta([colorDeLaOrden()]));
    renderConProveedores(
      <DialogoColoresDeTela
        abierto
        alCambiarAbierto={() => {}}
        idOrden={50}
        folioOrden={7}
        puedeEditar={false}
      />,
      { sesion: estadoSesionDePrueba(['compras.ver']) },
    );
    expect(screen.getByTestId('colores-tela-select')).toBeDisabled();
  });

  /**
   * ⭐⭐ **V1-E6b (§Post-F9.106) — LA SEGUNDA PUERTA DEL MISMO CALLEJÓN, CERRADA EN TEXTO.**
   *
   * Este diálogo se abre **desde el renglón** («Ver todos los colores y precios de la orden N»), o sea
   * a un clic de la puerta que la etapa acababa de construir — y seguía mandando a «Catálogos ›
   * Telas», **fuera de la compra**. Eso hacía que la frase del historial de la 0.025 (*"antes te
   * mandaba a Catálogos › Telas… ahora es la última opción del desplegable"*) fuera cierta **sólo en
   * una de las dos puertas**, y esa frase la lee Daniel.
   *
   * 🔴 Esta prueba existe porque **la rama no tenía ninguna**: el texto podía volver a pudrirse en
   * silencio. Fija las dos mitades — que ya NO manda a otra pantalla, y que SÍ nombra el camino que
   * de verdad existe.
   *
   * ⬜ Sigue faltando dar de alta el color **desde aquí** (montar el diálogo del alta, ~40 líneas):
   * queda dicho en el propio componente, no escondido.
   */
  it('🔴 la tela sin colores YA NO manda a «Catálogos › Telas»: nombra la puerta que sí existe', () => {
    const sinOpciones = respuesta([colorDeLaOrden({ idTelaColor: null, telaColor: null })]);
    (sinOpciones.data.telas[0] as unknown as Record<string, unknown>).opciones = [];
    useColoresDeTelaMock.mockReturnValue(sinOpciones);
    abrir();

    const aviso = screen.getByTestId('colores-tela-sin-opciones');
    expect(aviso).not.toHaveTextContent('Catálogos');
    expect(aviso).toHaveTextContent('Decir de qué color se compra');
    expect(aviso).toHaveTextContent('Nuevo color');
  });
});
