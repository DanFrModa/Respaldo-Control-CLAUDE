import { screen, fireEvent, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { elegirEnCombobox, renderConProveedores } from '@/pruebas/utilidades';

// ── Mock de la capa de datos: guarda la QUERY con la que el renglón pide modelos ────
const consultas: Record<string, unknown>[] = [];
const estadoConsulta = { isPending: false, isFetching: false };
type ModeloFalso = { id: number; codigo: string; descripcion: string | null; origen: string };
const respuesta = vi.fn<() => { datos: ModeloFalso[] }>();

vi.mock('@/api/modelos', () => ({
  useModelos: (query: Record<string, unknown>) => {
    consultas.push(query);
    return { data: respuesta(), isError: false, ...estadoConsulta };
  },
}));

const { EditorRenglones } = await import('./EditorRenglones');

/** La última query con la que se pidió el catálogo. */
function ultimaConsulta(): Record<string, unknown> {
  const ultima = consultas.at(-1);
  if (ultima === undefined) {
    throw new Error('El editor de renglones no consultó el catálogo de modelos.');
  }
  return ultima;
}

/**
 * Monta el editor con los renglones dados. `codigosPorModelo` simula lo que el diálogo del pedido
 * sabe de los renglones YA GUARDADOS (`pedido.lineas[].codigoModelo`).
 */
function EditorDePrueba({
  renglones = [],
  codigosPorModelo,
  errores = {},
}: {
  renglones?: { idModelo: string; cantidadPedida: string; precio: string }[];
  codigosPorModelo?: ReadonlyMap<number, string>;
  errores?: Record<string, unknown>;
}): React.JSX.Element {
  const formulario = useForm({ defaultValues: { renglones } });
  return (
    <EditorRenglones
      control={formulario.control as never}
      registrar={formulario.register as never}
      errores={errores}
      puedeVerImportes={false}
      deshabilitado={false}
      {...(codigosPorModelo === undefined ? {} : { codigosPorModelo })}
    />
  );
}

const RENGLON_VACIO = { idModelo: '', cantidadPedida: '', precio: '0' };

/**
 * ⭐ FILA 0.209 — EL MODELO DEL RENGLÓN SE BUSCA EN EL SERVIDOR.
 *
 * El defecto que cierra: el selector era un `<select>` nativo alimentado por una consulta FIJA de
 * `porPagina: 100` **sin `busqueda`**, y 100 es el tope REAL del contrato (`comun/paginacion.ts` →
 * `.max(100)`) ⇒ con ~5,400 modelos (Daniel, 19-sep-2026) sólo se alcanzaban los primeros 100
 * códigos y el resto era inalcanzable, sin aviso. Cada `it` vigila UNA invariante del arreglo.
 */
describe('EditorRenglones · selector de modelo (fila 0.209)', () => {
  beforeEach(() => {
    consultas.length = 0;
    estadoConsulta.isPending = false;
    estadoConsulta.isFetching = false;
    respuesta.mockReturnValue({
      datos: [{ id: 7, codigo: 'AAA-26-71-001', descripcion: 'Playera', origen: 'produccion' }],
    });
  });

  /**
   * 🔴 LA INVARIANTE CENTRAL: lo tecleado viaja al SERVIDOR. Sin esto el combobox sólo filtraría la
   * página ya cargada, que es exactamente el defecto que la fila vino a matar.
   */
  it('manda al servidor lo que se teclea (búsqueda server-side)', async () => {
    renderConProveedores(<EditorDePrueba renglones={[RENGLON_VACIO]} />);
    await elegirEnCombobox('renglon-modelo-0', 'AAA-26-71-001');

    expect(ultimaConsulta()['busqueda']).toBe('AAA-26-71-001');
  });

  /**
   * 🔴 Pide una página CHICA: el tope del contrato es 100 y pedirlo entero era justo el defecto.
   * Con búsqueda en el servidor da igual que el catálogo tenga 60 modelos o 5,400.
   */
  it('pide una página chica, nunca el catálogo entero', () => {
    renderConProveedores(<EditorDePrueba renglones={[RENGLON_VACIO]} />);

    expect(ultimaConsulta()['porPagina']).toBeLessThanOrEqual(10);
  });

  /**
   * ⭐ EL ORDEN ES UNA DECISIÓN DE NEGOCIO, NO UN DETALLE.
   *
   * **Daniel, 19-sep-2026:** *«todos los modelos que ya están dados de alta no se van a volver a
   * repetir… un modelo que se repite, usualmente se repite en un lapso máximo de unos 6 meses.
   * Pasado ese tiempo, el modelo no vuelve a repetirse nunca más.»* ⇒ la lista que se ve SIN teclear
   * tiene que ser la reciente. Ordenar por `codigo asc` listaba por cliente en orden de abecedario
   * y, dentro de cada uno, del año más viejo primero: justo los que ya no se repiten.
   */
  it('ofrece PRIMERO lo más reciente, no el principio del abecedario', () => {
    renderConProveedores(<EditorDePrueba renglones={[RENGLON_VACIO]} />);

    expect(ultimaConsulta()['ordenarPor']).toBe('creadoEn');
    expect(ultimaConsulta()['direccion']).toBe('desc');
  });

  /**
   * ⚠️ `origen: 'todos'` (V1-E3n): sin esto un modelo de DESARROLLO no se podría poner en un pedido.
   *
   * 🔑 **Lo que esta prueba mide, dicho con precisión: que la consulta del renglón SALE con
   * `'todos'`** — no que lo ponga el call site. **No puede distinguirlos**, porque el default de
   * `SelectorModelo` ya es `'todos'` y la query resultante es idéntica por los dos caminos: borrar el
   * `origen="todos"` explícito no cambia un solo byte de lo que viaja. El `origen="todos"` del call
   * site es **defensa en profundidad**, y quien cierra de verdad esa puerta es
   * `origen-buscadores.test.tsx`, que fija el **default del selector** en su propia prueba. Se deja
   * escrito así en vez de prometer un candado que este archivo no puede echar.
   */
  it('la consulta del renglón sale con los DOS catálogos (un modelo de desarrollo se puede pedir)', () => {
    renderConProveedores(<EditorDePrueba renglones={[RENGLON_VACIO]} />);

    expect(ultimaConsulta()['origen']).toBe('todos');
  });

  /**
   * 🔴 EL RENGLÓN GUARDADO ENSEÑA SU MODELO aunque no venga en la página de la búsqueda.
   *
   * Con typeahead server-side la primera página son 8 códigos y el modelo de un pedido guardado casi
   * nunca está entre ellos: sin la etiqueta que pasa el diálogo, al reabrir el pedido el campo se
   * vería VACÍO con el modelo puesto por dentro — que es lo contrario de lo que promete.
   */
  it('muestra el modelo ya guardado aunque NO venga en la página de la búsqueda', () => {
    // La página sólo trae el id 7; el renglón apunta al 900.
    renderConProveedores(
      <EditorDePrueba
        renglones={[{ ...RENGLON_VACIO, idModelo: '900' }]}
        codigosPorModelo={new Map([[900, 'ZZZ-24-71-009']])}
      />,
    );

    expect(screen.getByTestId('renglon-modelo-0-busqueda')).toHaveValue('ZZZ-24-71-009');
  });

  /**
   * 🔴 UN RENGLÓN RECIÉN AGREGADO ARRANCA VACÍO.
   *
   * El formulario guarda el id como TEXTO y `''` significa «sin elegir». Si esa conversión se hace a
   * la brava (`Number('')` es 0, no `undefined`), el combobox creería que hay algo seleccionado.
   */
  it('un renglón sin modelo arranca vacío Y sin aparentar que ya eligió', () => {
    renderConProveedores(<EditorDePrueba renglones={[RENGLON_VACIO]} />);

    const input = screen.getByTestId('renglon-modelo-0-busqueda');
    expect(input).toHaveValue('');
    /**
     * 🔑 **El campo vacío NO basta para probar esto.** `Number('')` es **0**, no `undefined`: si la
     * conversión se hiciera a la brava, el combobox recibiría `valor = 0` —un id que no existe— y se
     * creería CON selección. El texto se vería igual de vacío, así que un `toHaveValue('')` pasa en
     * los dos mundos. Lo que sí cambia es cómo se presenta: el kit resalta el input en negritas
     * cuando hay algo elegido (`valor !== null`), de modo que un renglón todavía vacío se pintaría
     * como si ya tuviera modelo.
     */
    // Por CLASE EXACTA, no por subcadena: la clase base del input trae `file:font-medium`, que
    // contiene el texto y daría un falso positivo.
    expect(input.className.split(/\s+/)).not.toContain('font-medium');
  });

  /**
   * 🔴 ANTI-CARRERA: mientras la búsqueda NUEVA viaja al servidor, la página ANTERIOR no se ofrece.
   *
   * `useModelos` va con `placeholderData: keepPreviousData`, así que al disparar la búsqueda nueva la
   * consulta deja de estar «pendiente» —conserva los datos de la anterior— y `isPending` se apaga:
   * sin mirar también `isFetching`, las opciones viejas siguen clickeables y se elige el modelo
   * EQUIVOCADO. En un renglón de pedido eso no es un filtro mal puesto: es un pedido mal capturado.
   */
  it('mientras la consulta viaja NO ofrece las opciones viejas (anti-carrera)', async () => {
    estadoConsulta.isFetching = true;
    renderConProveedores(<EditorDePrueba renglones={[RENGLON_VACIO]} />);

    const input = screen.getByTestId('renglon-modelo-0-busqueda');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'AAA' } });

    /**
     * ⚠️ **Hay que ESPERAR al debounce, y es la parte fina de esta prueba.** Mientras lo tecleado no
     * se ha resuelto, el combobox ya oculta las opciones por el otro motivo (`texto !== busqueda`):
     * asertar aquí mismo daría verde aunque `isFetching` no se mirara — la prueba pasaría por el
     * motivo equivocado, que es justo la cicatriz del localizador laxo (`CLAUDE.md` §8). Sólo
     * DESPUÉS de que la búsqueda llega al servidor queda `isFetching` como único guardián.
     */
    await waitFor(() => {
      expect(ultimaConsulta()['busqueda']).toBe('AAA');
    });

    expect(screen.queryAllByTestId('renglon-modelo-0-opcion')).toHaveLength(0);
  });

  /**
   * 🟡 **EL RENGLÓN CON ERROR SIGUE MARCADO PARA UN LECTOR DE PANTALLA (fila 0.209).**
   *
   * El `<select>` viejo llevaba `aria-invalid={Boolean(errorFila?.idModelo)}` y al migrar al combobox
   * esa marca se habría perdido **en silencio** — el error se sigue anunciando con `role="alert"`,
   * pero el campo dejaba de estar asociado a él. *«Se perdió al migrar» no es una razón de diseño: es
   * la descripción del accidente*, así que se recuperó con un paso APAGADO POR DEFAULT en el kit.
   */
  it('marca el campo como inválido cuando el renglón tiene error de modelo', () => {
    renderConProveedores(
      <EditorDePrueba
        renglones={[RENGLON_VACIO]}
        errores={{ renglones: [{ idModelo: { message: 'Elige un modelo' } }] }}
      />,
    );

    expect(screen.getByTestId('renglon-modelo-0-busqueda')).toHaveAttribute('aria-invalid', 'true');
  });

  /** Y sin error NO lo marca: una marca permanente no informa de nada. */
  it('sin error no marca nada', () => {
    renderConProveedores(<EditorDePrueba renglones={[RENGLON_VACIO]} />);

    expect(screen.getByTestId('renglon-modelo-0-busqueda')).not.toHaveAttribute('aria-invalid');
  });

  /**
   * 🔴 **EL CASO DE EN MEDIO — el que las dos pruebas de arriba NO cubren (fila 0.209, ronda 3).**
   *
   * Los dos extremos (error en el modelo / ningún error) los cubren las dos anteriores, y con ellas
   * **sobrevivía** cambiar `Boolean(errorFila?.idModelo)` por `Boolean(errorFila)`: bastaba con que el
   * renglón tuviera CUALQUIER error para marcar inválido **el campo Modelo**, que está bien puesto.
   * Un renglón con la cantidad mal y el modelo correcto es el caso corriente, y ahí señalar al modelo
   * manda al usuario a arreglar lo que no está roto.
   *
   * 📌 Es textual la cicatriz del 17-sep (fila 0.155): *si las pruebas cubren los dos extremos de una
   * comparación, falta el de en medio — que es justo el caso que el arreglo existe para proteger.*
   */
  it('un error en OTRA columna no marca inválido el campo Modelo', () => {
    renderConProveedores(
      <EditorDePrueba
        renglones={[{ ...RENGLON_VACIO, idModelo: '7' }]}
        errores={{ renglones: [{ cantidadPedida: { message: 'Pon una cantidad' } }] }}
      />,
    );

    expect(screen.getByTestId('renglon-modelo-0-busqueda')).not.toHaveAttribute('aria-invalid');
  });

  /**
   * Cada renglón tiene su PROPIO combobox: sin testids distintos, el segundo renglón sería
   * inalcanzable para las pruebas y ambiguo para quien navega con teclado.
   */
  it('cada renglón lleva su propio selector', () => {
    renderConProveedores(<EditorDePrueba renglones={[RENGLON_VACIO, RENGLON_VACIO]} />);

    expect(screen.getByTestId('renglon-modelo-0-busqueda')).toBeInTheDocument();
    expect(screen.getByTestId('renglon-modelo-1-busqueda')).toBeInTheDocument();
  });
});
