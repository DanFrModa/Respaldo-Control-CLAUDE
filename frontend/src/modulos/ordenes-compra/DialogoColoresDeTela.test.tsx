import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
// ⭐⭐ V1-E8o: el alta del color vive AQUÍ dentro desde esta etapa, así que su hook tiene que
// existir en el doble. Contesta llamando a `onSuccess` con el color creado — que es lo que dispara
// el "queda ELEGIDO", la mitad de la deuda que de verdad importaba.
const agregarColorMutateMock = vi.fn();
vi.mock('@/api/mrp', () => ({
  useColoresDeTela: (id: unknown) => useColoresDeTelaMock(id) as unknown,
  useAsignarColorTela: () => ({ mutate: asignarMutateMock, isPending: false }) as unknown,
  useFijarPrecioColor: () => ({ mutate: vi.fn(), isPending: false }) as unknown,
  useAgregarColorDeTela: () => ({ mutate: agregarColorMutateMock, isPending: false }) as unknown,
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

function abrir(puedeEditar = true): void {
  renderConProveedores(
    <DialogoColoresDeTela
      abierto
      alCambiarAbierto={() => {}}
      idOrden={50}
      folioOrden={7}
      puedeEditar={puedeEditar}
    />,
    {
      sesion: estadoSesionDePrueba(
        puedeEditar ? ['compras.ver', 'compras.administrar'] : ['compras.ver'],
      ),
    },
  );
}

/** La misma respuesta, pero con la tela SIN colores dados de alta (el caso del arranque). */
function respuestaSinOpciones(colores: unknown[]) {
  const r = respuesta(colores);
  (r.data.telas[0] as unknown as Record<string, unknown>).opciones = [];
  return r;
}

/** Los textos del desplegable de color, en orden. */
function opcionesDelSelect(): string[] {
  return Array.from(screen.getByTestId('colores-tela-select').querySelectorAll('option')).map(
    (o) => o.textContent ?? '',
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
   * ⭐⭐⭐ **V1-E8o — LA SEGUNDA PUERTA DEL MISMO CALLEJÓN, ABIERTA DE VERDAD.**
   *
   * Este diálogo se abre **desde el renglón** («Ver todos los colores y precios de la orden N»), o
   * sea a un clic de la puerta que V1-E6b construyó — y seguía sin tenerla. V1-E6b lo dejó
   * *apuntando*: «cierra este cuadro y usa el desplegable del renglón». No cerraba el camino, pero
   * obligaba a SALIR, y la propia etapa lo anotó como deuda en el componente.
   *
   * 🔴 **La lección que estas pruebas fijan: cerrar una puerta no cierra su gemela.** Por eso ya no
   * se mide "a dónde manda el texto" sino **que el alta esté AQUÍ**: que se pinte, que respete el
   * permiso, y que al crear el color **quede elegido** — sin esto último sólo se habría movido el
   * problema de sitio.
   */
  describe('V1-E8o: dar de alta el color SIN salir de este cuadro', () => {
    /**
     * 🔴🔴 **EL CASO QUE ORIGINÓ LA ETAPA.** El aviso ya no manda a ninguna otra pantalla —ni a
     * «Catálogos › Telas» (el original) ni al renglón de la explosión (el parche de V1-E6b)—:
     * nombra la opción que está **debajo, en este mismo cuadro**.
     */
    it('🔴 la tela sin colores YA NO manda a ningún lado: la salida está en este cuadro', () => {
      useColoresDeTelaMock.mockReturnValue(
        respuestaSinOpciones([colorDeLaOrden({ idTelaColor: null, telaColor: null })]),
      );
      abrir();

      const aviso = screen.getByTestId('colores-tela-sin-opciones');
      expect(aviso).not.toHaveTextContent('Catálogos');
      expect(aviso).not.toHaveTextContent('cierra este cuadro');
      expect(aviso).toHaveTextContent('Nuevo color');
      // Y lo que convierte el aviso en verdad: la opción existe, aquí.
      expect(screen.getByTestId('colores-tela-alta-color')).toBeInTheDocument();
    });

    /**
     * ⭐ **Lo que el usuario pide VER, se prueba que SE VE.** Con el catálogo vacío el desplegable
     * ya no es un control muerto: trae la salida dentro, y la fila del caso se pinta (antes, sin
     * `opciones`, la lista de colores ni se dibujaba — de ahí que no hubiera dónde poner la puerta).
     */
    it('con el catálogo VACÍO la fila se pinta igual y trae «＋ Nuevo color…»', () => {
      useColoresDeTelaMock.mockReturnValue(
        respuestaSinOpciones([colorDeLaOrden({ idTelaColor: null, telaColor: null })]),
      );
      abrir();

      expect(screen.getByTestId('colores-tela-fila')).toBeInTheDocument();
      const textos = opcionesDelSelect();
      expect(textos[textos.length - 1]).toContain('Nuevo color');
      // Sin colores reales no hay nada que separar: el separador sobra y no se pinta.
      expect(screen.queryByTestId('colores-tela-separador')).toBeNull();
    });

    it('con colores dados de alta, «＋ Nuevo color…» va AL FINAL y separada de los reales', () => {
      useColoresDeTelaMock.mockReturnValue(respuesta([colorDeLaOrden()]));
      abrir();

      const textos = opcionesDelSelect();
      expect(textos[0]).toContain('sin decir');
      expect(textos[1]).toContain('Grana 7700');
      expect(textos[2]).toContain('Marino Alsa 3040');
      expect(textos[3]).toContain('─'); // el separador
      // 🔴 La última, siempre: si se colara entre los colores reales se elegiría por error.
      expect(textos[textos.length - 1]).toContain('Nuevo color');
      expect(screen.getByTestId('colores-tela-separador')).toBeInTheDocument();
    });

    /**
     * ⚠️ **GUARDA DE CONTRATO DEL COMPONENTE, NO CAMINO DE USUARIO — dicho para que nadie se
     * confunda con esta prueba en verde.**
     *
     * 🔴 La primera redacción de esta etapa afirmaba que *"este diálogo SÍ se abre en solo
     * lectura"*. **Es falso**, y se midió: hay **un solo mount de producción**
     * (`ExplosionMaterialesPagina`, `puedeEditar={puedeComprar}`), se abre **únicamente** por
     * `onVerTodosLosColores`, y ese botón sólo se pinta dentro del bloque gobernado por
     * `puedeDecirColor` — el MISMO `compras.administrar`. **Sin el permiso, este diálogo no se
     * abre.** O sea: el `false` de abajo **hoy sólo lo produce esta prueba**.
     *
     * Entonces, ¿por qué se conserva la guarda y su prueba? Porque `puedeEditar` entra **por
     * prop**: fija el CONTRATO del componente —*"si te dicen que no se edita, no ofrezcas el
     * alta"*— para el día que un segundo mount (una consulta, un cajón de solo lectura) lo monte
     * sin gobernar el botón. Es defensa en profundidad, no cobertura de un flujo real.
     *
     * La mitad de BLOQUEAR (§Post-F9.68) vive donde de verdad protege: el servidor
     * (`agregarColorATela` exige `compras.administrar`), con su unit en `telas.test.ts`.
     */
    it('🔴 con `puedeEditar` en false NO se pinta la puerta (contrato, no flujo)', () => {
      useColoresDeTelaMock.mockReturnValue(respuesta([colorDeLaOrden()]));
      abrir(false);

      expect(screen.getByTestId('colores-tela-select')).toBeDisabled();
      expect(screen.queryByTestId('colores-tela-alta-color')).toBeNull();
      expect(screen.queryByTestId('colores-tela-separador')).toBeNull();
    });

    /**
     * La otra mitad del MISMO contrato: el aviso no puede prometer una opción que no está pintada.
     * Un texto que señala un control invisible es la misma mentira que esta etapa vino a quitar,
     * sólo que del otro lado. (Igual que la de arriba: contrato del componente, no flujo de hoy.)
     */
    it('con `puedeEditar` en false, el aviso NO señala una opción que no está pintada', () => {
      useColoresDeTelaMock.mockReturnValue(
        respuestaSinOpciones([colorDeLaOrden({ idTelaColor: null, telaColor: null })]),
      );
      abrir(false);

      const aviso = screen.getByTestId('colores-tela-sin-opciones');
      expect(aviso).not.toHaveTextContent('Nuevo color');
      expect(aviso).toHaveTextContent('se compra sin color');
    });

    // ⭐ EL PUNTO ENTERO DE LA PETICIÓN: el pantone ya está en pantalla, no se teclea dos veces.
    it('⭐ el alta viene PRECARGADA con el color de prenda de la OP y su pantone', () => {
      useColoresDeTelaMock.mockReturnValue(
        respuestaSinOpciones([
          colorDeLaOrden({
            idTelaColor: null,
            telaColor: null,
            color: 'Marino',
            pantone: '19-4027 TCX',
          }),
        ]),
      );
      abrir();

      fireEvent.change(screen.getByTestId('colores-tela-select'), {
        target: { value: 'nuevo-color' },
      });

      expect(screen.getByTestId('dialogo-nuevo-color-tela')).toBeInTheDocument();
      expect(screen.getByTestId('nuevo-color-nombre')).toHaveValue('Marino');
      expect(screen.getByTestId('nuevo-color-pantone')).toHaveValue('19-4027 TCX');
      // Elegir «＋ Nuevo color…» NO escribe nada: sólo abre el alta.
      expect(asignarMutateMock).not.toHaveBeenCalled();
    });

    /**
     * ⭐⭐ **AL CREARLO, QUEDA ELEGIDO — y ésa es la mitad que hacía falta.** Sin esto el comprador
     * daría de alta el color y tendría que volver a buscarlo: el problema no se cierra, se mueve.
     */
    it('⭐⭐ al crear el color queda ELEGIDO para ese caso (no hay que volver a buscarlo)', async () => {
      useColoresDeTelaMock.mockReturnValue(
        respuestaSinOpciones([
          colorDeLaOrden({ idTelaColor: null, telaColor: null, idColor: 900 }),
        ]),
      );
      abrir();
      fireEvent.change(screen.getByTestId('colores-tela-select'), {
        target: { value: 'nuevo-color' },
      });
      fireEvent.click(screen.getByTestId('guardar-nuevo-color-tela'));

      // El envío pasa por la validación (react-hook-form + Zod), que es asíncrona.
      await waitFor(() => expect(agregarColorMutateMock).toHaveBeenCalledTimes(1));

      // El doble del alta contesta como el servidor: con el color recién creado.
      const [, opciones] = agregarColorMutateMock.mock.calls[0] as [
        unknown,
        { onSuccess: (c: unknown) => void },
      ];
      act(() => {
        opciones.onSuccess({ id: 4242, nombre: 'Marino Alsa 3040', pantone: null });
      });

      expect(asignarMutateMock).toHaveBeenCalledTimes(1);
      const [variables] = asignarMutateMock.mock.calls[0] as [
        { idOrden: number; cuerpo: { idTela: number; idColor: number; idTelaColor: number } },
      ];
      expect(variables.idOrden).toBe(50);
      expect(variables.cuerpo.idColor).toBe(900);
      expect(variables.cuerpo.idTela).toBe(4);
      expect(variables.cuerpo.idTelaColor).toBe(4242);
    });

    /**
     * ⭐⭐ **QUE SE VEA NO BASTA: QUE SE PUEDA USAR.**
     *
     * 🔴 Esta puerta es un diálogo **DENTRO de otro diálogo** —el del alta se abre encima del de
     * «colores y precios»—, y ésa es una diferencia REAL con el renglón de la explosión, donde el
     * alta se abre desde un bloque en línea. Radix apaga los eventos de puntero del fondo cuando un
     * modal está abierto: si el anidamiento quedara mal, la forma se **vería** y no se **podría
     * pulsar**, y `fireEvent` —que no mira `pointer-events`— lo daría por bueno.
     *
     * Por eso esta prueba usa `userEvent`, que sí respeta la semántica del puntero: elige la opción
     * y pulsa Guardar como lo haría una persona.
     */
    it('⭐⭐ el alta ANIDADA se puede USAR de verdad (puntero real, no `fireEvent`)', async () => {
      const usuario = userEvent.setup();
      useColoresDeTelaMock.mockReturnValue(
        respuestaSinOpciones([
          colorDeLaOrden({ idTelaColor: null, telaColor: null, color: 'Marino' }),
        ]),
      );
      abrir();

      await usuario.selectOptions(screen.getByTestId('colores-tela-select'), 'nuevo-color');
      expect(await screen.findByTestId('dialogo-nuevo-color-tela')).toBeInTheDocument();

      await usuario.click(screen.getByTestId('guardar-nuevo-color-tela'));
      await waitFor(() => expect(agregarColorMutateMock).toHaveBeenCalledTimes(1));
    });

    /**
     * 🔴 **Y donde el alta NO sirve, no se ofrece.** Sin matriz color×talla no existe ningún color
     * de PRENDA del que colgar el amarre (`OrdenTelaColor` amarra `(idOrdenTela, idColor)`): dar de
     * alta un color de tela que nadie podría elegir sería mandar a llenar el catálogo por gusto.
     *
     * ⚠️ Y se dice **UNA VEZ**: el dato es de la ORDEN (`sinMatrizColores`), no de cada tela, así
     * que repetirlo por cada renglón de la receta diría diez veces la misma frase. El renglón de la
     * explosión lo dice una vez por orden; aquí también.
     */
    it('🔴 sin matriz color×talla no se ofrece el alta, y se dice UNA VEZ', () => {
      const sinMatriz = respuestaSinOpciones([]);
      sinMatriz.data.sinMatrizColores = true;
      sinMatriz.data.telas.push({
        ...(sinMatriz.data.telas[0] as Record<string, unknown>),
        idOrdenTela: 2,
        idTela: 5,
        tela: 'Rib 1x1',
      } as never);
      useColoresDeTelaMock.mockReturnValue(sinMatriz);
      abrir();

      // Dos telas en la receta, UN solo aviso (`getAllBy` para que un duplicado lo delate).
      expect(screen.getAllByTestId('colores-tela-sin-matriz')).toHaveLength(1);
      expect(screen.getByTestId('colores-tela-sin-matriz')).toHaveTextContent('matriz de color');
      expect(screen.queryByTestId('colores-tela-select')).toBeNull();
      expect(screen.queryByTestId('colores-tela-alta-color')).toBeNull();
    });
  });
});
