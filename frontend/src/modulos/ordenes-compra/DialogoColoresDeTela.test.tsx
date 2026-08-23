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
});
