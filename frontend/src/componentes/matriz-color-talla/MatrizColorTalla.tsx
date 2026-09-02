import { Trash2Icon, XIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useRef } from 'react';

import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

/**
 * MATRIZ COLOR × TALLA — componente de captura REUTILIZABLE (F2-E3, pensado para reuso en F3:
 * corte, envíos, recibos, entregas). Presentación PURA (A1): NO contiene reglas de negocio; solo
 * presenta una rejilla de filas (colores) por columnas (tallas) y emite el nuevo estado. La
 * validación REAL (color único, tallas válidas, cantidades ≥ 0…) la hace el backend; aquí solo se
 * cuida la UX (enteros ≥ 0, color duplicado bloqueado en el selector, totales en vivo).
 *
 * Es CONTROLADO en DOS ejes independientes: las COLUMNAS (`tallas` + `onTallasChange`) y las FILAS
 * (`lineas` + `onLineasChange`). El padre es dueño de ambos estados. El componente no conoce
 * órdenes ni ninguna entidad: trabaja con ids de color/talla y un nombre/etiqueta para pintar.
 * Reutilizable por cualquier flujo que capture cantidades por color × talla.
 *
 * Contrato de props: ver {@link PropsMatrizColorTalla}. Guía de reuso en el README de esta carpeta.
 */

/** Una talla = una columna de la matriz. */
export interface MatrizTalla {
  /** Id de la talla (clave de la columna). */
  idTalla: number;
  /** Etiqueta visible de la talla (p. ej. "CH", "28"). */
  etiqueta: string;
}

/** Una fila de la matriz: un color (× su pack, si el flujo los maneja) con sus cantidades por talla. */
export interface MatrizLinea {
  /**
   * Id del color de la fila.
   *
   * ⚠️ YA NO ES LA CLAVE DE LA FILA (§Post-F9.10). Con packs, la misma orden puede traer dos
   * tendidos del MISMO color y por lo tanto dos filas con el mismo `idColor`; la identidad de una
   * fila es su POSICIÓN. Sin packs sigue siendo único de hecho, y todo se ve igual que siempre.
   */
  idColor: number;
  /** Nombre visible del color. */
  color: string;
  /** Cantidades por talla: `{ [idTalla]: cantidad }`. Una talla ausente = 0. */
  cantidades: Record<number, number>;
  /**
   * Código PANTONE de este color (petición Daniel), opcional. Sólo se MUESTRA/EDITA cuando el flujo lo
   * usa (pasando `onPantoneChange` o filas con pantone); los flujos que no lo manejan lo ignoran.
   */
  pantone?: string | null;
  /**
   * PACK / TENDIDO de la fila (§Post-F9.10). Sólo se MUESTRA/EDITA cuando el flujo lo maneja
   * (pasando `onPackChange`); los demás flujos —inventario PT, órdenes de compra, calidad, entrega
   * a cliente— ni lo mandan ni lo ven, y su matriz es exactamente la de siempre.
   */
  pack?: string;
}

/** Un color disponible para elegir/agregar como fila. */
export interface MatrizColorOpcion {
  id: number;
  nombre: string;
}

/** Props del componente {@link MatrizColorTalla}. */
export interface PropsMatrizColorTalla {
  /** Columnas (tallas) de la matriz, en orden de presentación. Estado controlado del padre. */
  tallas: readonly MatrizTalla[];
  /** Valor controlado: las filas (colores con sus cantidades). */
  lineas: readonly MatrizLinea[];
  /** Colores del catálogo para elegir el color de una fila nueva (los ya usados se ocultan). */
  coloresDisponibles: readonly MatrizColorOpcion[];
  /** Tallas del catálogo para agregar columnas fuera de la curva (las ya presentes se ocultan). */
  tallasDisponibles: readonly MatrizTalla[];
  /** Emite el nuevo set de filas tras editar una celda o agregar/quitar un color. */
  onLineasChange: (lineas: MatrizLinea[]) => void;
  /** Emite el nuevo set de columnas tras agregar/quitar una talla. */
  onTallasChange: (tallas: MatrizTalla[]) => void;
  /**
   * Si se pasa, cada fila muestra un campo PANTONE editable (petición Daniel). Si NO se pasa, el
   * pantone sólo se MUESTRA (read-only) cuando la fila lo trae. Los flujos que no capturan pantone
   * simplemente omiten esta prop y no ven nada nuevo.
   *
   * ⚠️ Identifica la fila por su POSICIÓN, no por `idColor` (§Post-F9.10): con packs el mismo color
   * puede estar en dos filas y el id ya no las distingue.
   */
  onPantoneChange?: (indice: number, pantone: string) => void;
  /**
   * ⭐ PACK / TENDIDO por fila (§Post-F9.10). Si se pasa, la matriz muestra una columna PACK
   * editable; y, **en cuanto alguna fila trae pack**, deja de ocultar los colores ya usados en el
   * selector de agregar, para poder meter un segundo tendido del mismo color (ver
   * {@link colorRepetible}: mientras ninguna lo traiga, el color duplicado se sigue bloqueando).
   * Si NO se pasa, la matriz es idéntica a la de antes: ni columna, ni colores repetidos.
   */
  onPackChange?: (indice: number, pack: string) => void;
  /**
   * Selector de "agregar color" PROPIO del flujo, que REEMPLAZA al `<select>` nativo de la
   * matriz (p. ej. el combobox con alta de color al vuelo de la OP, §Post-F9.11). El padre es
   * dueño de agregar la fila vía `onLineasChange`; la matriz solo lo posiciona en su toolbar.
   * Los flujos que no lo pasan conservan el select de siempre.
   */
  slotAgregarColor?: React.ReactNode;
  /** Solo lectura (orden cancelada / sin permiso): oculta toda edición y deja la matriz visible. */
  soloLectura?: boolean;
  /** Base de los `data-testid` (por defecto "matriz"). */
  testid?: string;
}

/** Normaliza el texto de una celda a un entero ≥ 0 (vacío/invalidos → 0). */
function aCantidad(texto: string): number {
  const limpio = texto.trim();
  if (limpio === '') {
    return 0;
  }
  const valor = Number(limpio);
  if (!Number.isFinite(valor) || valor < 0) {
    return 0;
  }
  return Math.floor(valor);
}

/** Suma las cantidades de una fila sobre las tallas presentes (función pura). */
function totalFila(linea: MatrizLinea, tallas: readonly MatrizTalla[]): number {
  return tallas.reduce((suma, talla) => suma + (linea.cantidades[talla.idTalla] ?? 0), 0);
}

/**
 * Selecciona todo el contenido de una celda al enfocarla (para sobrescribir tecleando). En algunos
 * navegadores `select()` sobre `<input type="number">` lanza; se ignora el error (no es crítico).
 */
function seleccionarTodo(input: HTMLInputElement): void {
  try {
    input.select();
  } catch {
    // `<input type="number">` puede no soportar la selección: no pasa nada.
  }
}

/**
 * Matriz color × talla. Captura por teclado (Tab/Enter/flechas mueven entre celdas: una fila se
 * llena sin tocar el mouse), totales en vivo (por fila, por columna y total) y agregar/quitar
 * filas (colores) y columnas (tallas extra). Las celdas son enteros ≥ 0; el backend re-valida.
 */
function MatrizColorTallaBase({
  tallas,
  lineas,
  coloresDisponibles,
  tallasDisponibles,
  onLineasChange,
  onTallasChange,
  onPantoneChange,
  onPackChange,
  slotAgregarColor,
  soloLectura = false,
  testid = 'matriz',
}: PropsMatrizColorTalla): React.JSX.Element {
  /** ¿Este flujo maneja tendidos? De aquí cuelga la columna PACK (y, con {@link hayPacks}, repetir color). */
  const conPacks = onPackChange !== undefined;
  // Rejilla de refs de celdas para mover el foco con el teclado (filas × columnas).
  const celdasRef = useRef<(HTMLInputElement | null)[][]>([]);

  // Colores ya usados (para ocultarlos del selector de "agregar fila") y tallas ya presentes.
  const coloresUsados = useMemo(() => new Set(lineas.map((l) => l.idColor)), [lineas]);
  const tallasPresentes = useMemo(() => new Set(tallas.map((t) => t.idTalla)), [tallas]);
  /**
   * ⭐ ¿Se puede repetir un color? (§Post-F9.10). Sólo cuando el flujo maneja tendidos **y alguna
   * fila ya trae uno**: ahí el segundo Negro es otro tendido del MISMO color, y ocultarlo dejaría
   * los dos tendidos sin manera de capturarse.
   *
   * 🔴 LAS DOS CONDICIONES SON NECESARIAS. Con sólo `conPacks` la puerta quedaría abierta en la
   * matriz de CUALQUIER orden, incluidas las que no usan tendidos — y ahí un color repetido no es un
   * tendido: es el duplicado que el servidor rechaza («Un color no puede aparecer dos veces»).
   * Mientras ningún renglón tenga pack, la protección de siempre sigue en pie.
   */
  const hayPacks = useMemo(() => lineas.some((l) => (l.pack ?? '') !== ''), [lineas]);
  const colorRepetible = conPacks && hayPacks;
  const coloresParaAgregar = colorRepetible
    ? coloresDisponibles
    : coloresDisponibles.filter((c) => !coloresUsados.has(c.id));
  const tallasParaAgregar = tallasDisponibles.filter((t) => !tallasPresentes.has(t.idTalla));

  // Totales en vivo: por columna (talla) y total general (la fila se calcula al pintar cada renglón).
  const totalesColumna = useMemo(() => {
    const acumulado: Record<number, number> = {};
    for (const talla of tallas) {
      acumulado[talla.idTalla] = lineas.reduce(
        (suma, linea) => suma + (linea.cantidades[talla.idTalla] ?? 0),
        0,
      );
    }
    return acumulado;
  }, [tallas, lineas]);

  const totalGeneral = useMemo(
    () => lineas.reduce((suma, linea) => suma + totalFila(linea, tallas), 0),
    [lineas, tallas],
  );

  /**
   * Reemplaza la cantidad de una celda (fila por POSICIÓN, columna `idTalla`) y emite el estado.
   *
   * 🔴 POR POSICIÓN Y NO POR `idColor` (§Post-F9.10): con dos tendidos del mismo color, comparar el
   * id habría escrito el número en LAS DOS filas a la vez — teclear en el pack A cambiaba el B.
   */
  const cambiarCelda = useCallback(
    (indice: number, idTalla: number, texto: string): void => {
      const siguiente = lineas.map((linea, i) =>
        i === indice
          ? { ...linea, cantidades: { ...linea.cantidades, [idTalla]: aCantidad(texto) } }
          : linea,
      );
      onLineasChange(siguiente);
    },
    [lineas, onLineasChange],
  );

  /**
   * Agrega una fila para el color elegido (al final). El color ya no aparecerá en el selector, salvo
   * cuando la matriz ya maneja tendidos (ver {@link colorRepetible}).
   */
  const agregarColor = useCallback(
    (idColor: number): void => {
      const opcion = coloresDisponibles.find((c) => c.id === idColor);
      if (opcion === undefined || (!colorRepetible && coloresUsados.has(idColor))) {
        return;
      }
      onLineasChange([...lineas, { idColor, color: opcion.nombre, cantidades: {} }]);
    },
    [coloresDisponibles, coloresUsados, colorRepetible, lineas, onLineasChange],
  );

  /** Quita la fila (por POSICIÓN: con packs, el color puede estar en más de una). */
  const quitarColor = useCallback(
    (indice: number): void => {
      onLineasChange(lineas.filter((_linea, i) => i !== indice));
    },
    [lineas, onLineasChange],
  );

  /** Agrega una columna (talla extra fuera de curva) al final. */
  const agregarTalla = useCallback(
    (idTalla: number): void => {
      const opcion = tallasDisponibles.find((t) => t.idTalla === idTalla);
      if (opcion === undefined || tallasPresentes.has(idTalla)) {
        return;
      }
      onTallasChange([...tallas, opcion]);
    },
    [tallasDisponibles, tallasPresentes, tallas, onTallasChange],
  );

  /** Quita una columna (talla) y borra sus cantidades de todas las filas. */
  const quitarTalla = useCallback(
    (idTalla: number): void => {
      onTallasChange(tallas.filter((t) => t.idTalla !== idTalla));
      const siguiente = lineas.map((linea) => {
        const { [idTalla]: _quitada, ...resto } = linea.cantidades;
        return { ...linea, cantidades: resto };
      });
      onLineasChange(siguiente);
    },
    [tallas, lineas, onTallasChange, onLineasChange],
  );

  /** Mueve el foco entre celdas con las flechas / Enter (Tab lo maneja el navegador). */
  const navegar = useCallback(
    (evento: React.KeyboardEvent<HTMLInputElement>, fila: number, columna: number): void => {
      const teclas: Record<string, [number, number]> = {
        ArrowUp: [fila - 1, columna],
        ArrowDown: [fila + 1, columna],
        Enter: [fila + 1, columna],
        ArrowLeft: [fila, columna - 1],
        ArrowRight: [fila, columna + 1],
      };
      const destino = teclas[evento.key];
      if (destino === undefined) {
        return;
      }
      // Izquierda/derecha solo navegan cuando el cursor está en el borde del texto, para no
      // estorbar la edición dentro de la celda. Los `<input type="number">` NO exponen
      // `selectionStart` (es `null`): en ese caso se navega libremente entre celdas.
      if (evento.key === 'ArrowLeft' || evento.key === 'ArrowRight') {
        const input = evento.currentTarget;
        const inicio = input.selectionStart;
        const fin = input.selectionEnd;
        if (inicio !== null && fin !== null) {
          const enInicio = inicio === 0 && fin === 0;
          const enFin = inicio === input.value.length && fin === input.value.length;
          if (
            (evento.key === 'ArrowLeft' && !enInicio) ||
            (evento.key === 'ArrowRight' && !enFin)
          ) {
            return;
          }
        }
      }
      const [filaDestino, columnaDestino] = destino;
      const celda = celdasRef.current[filaDestino]?.[columnaDestino];
      if (celda) {
        evento.preventDefault();
        celda.focus();
        seleccionarTodo(celda);
      }
    },
    [],
  );

  // Recorta la matriz de refs al número de filas actual (evita refs colgando de filas borradas).
  celdasRef.current = lineas.map((_, fila) => celdasRef.current[fila] ?? []);

  return (
    <div className="space-y-3" data-testid={testid}>
      {!soloLectura ? (
        <div className="flex flex-wrap items-center gap-2">
          {slotAgregarColor ?? (
            <SelectNativo
              className="w-auto"
              aria-label="Agregar color"
              value=""
              disabled={coloresParaAgregar.length === 0}
              onChange={(e) => {
                if (e.target.value !== '') {
                  agregarColor(Number(e.target.value));
                }
              }}
              data-testid={`${testid}-agregar-color`}
            >
              <option value="">Agregar color…</option>
              {coloresParaAgregar.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.nombre}
                </option>
              ))}
            </SelectNativo>
          )}

          <SelectNativo
            className="w-auto"
            aria-label="Agregar talla"
            value=""
            disabled={tallasParaAgregar.length === 0}
            onChange={(e) => {
              if (e.target.value !== '') {
                agregarTalla(Number(e.target.value));
              }
            }}
            data-testid={`${testid}-agregar-talla`}
          >
            <option value="">Agregar talla…</option>
            {tallasParaAgregar.map((t) => (
              <option key={t.idTalla} value={String(t.idTalla)}>
                {t.etiqueta}
              </option>
            ))}
          </SelectNativo>
        </div>
      ) : null}

      {lineas.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {soloLectura
            ? 'Esta orden no tiene matriz capturada.'
            : 'Agrega un color para empezar a capturar la matriz.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" data-testid={`${testid}-tabla`}>
            <thead>
              <tr className="border-b">
                {/* Primera columna CONGELADA en el scroll-x: `left-0` + bg opaco (bg-card, el
                    color de la superficie que la contiene) para que las tallas no se transparenten
                    debajo del color al desplazar. */}
                <th className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left font-medium text-muted-foreground">
                  Color
                </th>
                {conPacks ? (
                  <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Pack</th>
                ) : null}
                {tallas.map((talla) => (
                  <th
                    key={talla.idTalla}
                    className="px-1 py-1.5 text-center font-medium text-muted-foreground"
                  >
                    <span className="flex items-center justify-center gap-1">
                      {talla.etiqueta}
                      {!soloLectura ? (
                        <button
                          type="button"
                          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => quitarTalla(talla.idTalla)}
                          aria-label={`Quitar la talla ${talla.etiqueta}`}
                          data-testid={`${testid}-quitar-talla`}
                        >
                          <XIcon className="size-3" aria-hidden />
                        </button>
                      ) : null}
                    </span>
                  </th>
                ))}
                <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Total</th>
                {!soloLectura ? <th className="w-8" aria-hidden /> : null}
              </tr>
            </thead>
            <tbody>
              {lineas.map((linea, indiceFila) => (
                // 🔑 `key` por POSICIÓN y no por `idColor` (§Post-F9.10). Con packs el id ya no es
                // único, y llavear por `color:pack` habría REMONTADO el input del pack en cada
                // tecla —la llave cambia mientras se escribe— perdiendo el foco letra a letra.
                <tr key={indiceFila} className="border-b" data-testid={`${testid}-fila`}>
                  <td className="sticky left-0 z-10 bg-card px-2 py-1 font-medium whitespace-nowrap">
                    <span>{linea.color}</span>
                    {onPantoneChange !== undefined && !soloLectura ? (
                      <Input
                        value={linea.pantone ?? ''}
                        onChange={(e) => onPantoneChange(indiceFila, e.target.value)}
                        placeholder="PANTONE"
                        aria-label={`Pantone del color ${linea.color}`}
                        className="mt-1 h-6 w-28 text-[11px]"
                        data-testid={`${testid}-pantone`}
                      />
                    ) : linea.pantone !== null &&
                      linea.pantone !== undefined &&
                      linea.pantone !== '' ? (
                      <span
                        className="mt-0.5 block text-[11px] font-normal text-muted-foreground"
                        data-testid={`${testid}-pantone`}
                      >
                        PANTONE {linea.pantone}
                      </span>
                    ) : null}
                  </td>
                  {conPacks ? (
                    <td className="px-2 py-1">
                      {soloLectura ? (
                        <span data-testid={`${testid}-pack`}>{linea.pack ?? ''}</span>
                      ) : (
                        <Input
                          value={linea.pack ?? ''}
                          // ⚠️ LA CAJA DEL PACK NO SE TOCA, Y ESO SE DECLARA (§Post-F9.10). El texto
                          // viaja TAL CUAL: `a` y `A` serían DOS tendidos distintos —la llave del
                          // dominio (`normalizarPack`) sólo RECORTA, no cambia mayúsculas, y la
                          // `@@unique([idOrden, idColor, pack])` los toma por distintos—. Sólo este
                          // input puede producirlo: el importador de PDF emite letras `[A-Z]` del
                          // parser y no son editables en la previa.
                          //
                          // 🔑 NO se pone `toUpperCase()` aquí a propósito, por dos razones: (1) el
                          // campo admite 12 caracteres para un rótulo corto («Tendido 2»), y subirlo
                          // a mayúsculas reescribiría el texto del usuario mientras teclea; y (2) la
                          // UI no es la única puerta —el API y el ETL también escriben packs—, así
                          // que normalizar aquí daría una garantía FALSA mientras la de verdad no
                          // existe. Si algún día se quiere, el sitio es `normalizarPack` en el
                          // dominio (una sola verdad, A1), no esta caja.
                          onChange={(e) => onPackChange?.(indiceFila, e.target.value)}
                          // Espejo del `LARGO_MAX_PACK` del contrato (`contrato/esquemas/pack.ts`).
                          // Es comodidad de teclado, no un guardián: quien valida es el servidor
                          // (A1), y si algún día divergen el usuario ve el mensaje del servidor,
                          // no un rechazo mudo.
                          maxLength={12}
                          placeholder="—"
                          aria-label={`Pack del renglón ${indiceFila + 1} (${linea.color})`}
                          className="h-8 w-20"
                          data-testid={`${testid}-pack`}
                        />
                      )}
                    </td>
                  ) : null}
                  {tallas.map((talla, indiceColumna) => {
                    const cantidad = linea.cantidades[talla.idTalla] ?? 0;
                    return (
                      <td key={talla.idTalla} className="px-1 py-1 text-center">
                        {soloLectura ? (
                          <span data-testid={`${testid}-celda`}>{cantidad}</span>
                        ) : (
                          <Input
                            ref={(el) => {
                              const fila = (celdasRef.current[indiceFila] ??= []);
                              fila[indiceColumna] = el;
                            }}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            className="mx-auto h-8 w-16 text-center"
                            aria-label={
                              conPacks && (linea.pack ?? '') !== ''
                                ? `${linea.color} pack ${linea.pack}, talla ${talla.etiqueta}`
                                : `${linea.color}, talla ${talla.etiqueta}`
                            }
                            data-testid={`${testid}-celda`}
                            value={cantidad === 0 ? '' : String(cantidad)}
                            onChange={(e) =>
                              cambiarCelda(indiceFila, talla.idTalla, e.target.value)
                            }
                            onKeyDown={(e) => navegar(e, indiceFila, indiceColumna)}
                            onFocus={(e) => seleccionarTodo(e.target)}
                          />
                        )}
                      </td>
                    );
                  })}
                  <td
                    className="px-2 py-1 text-right font-medium tabular-nums"
                    data-testid={`${testid}-total-fila`}
                  >
                    {totalFila(linea, tallas).toLocaleString('es-MX')}
                  </td>
                  {!soloLectura ? (
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                        onClick={() => quitarColor(indiceFila)}
                        aria-label={
                          conPacks && (linea.pack ?? '') !== ''
                            ? `Quitar el color ${linea.color} pack ${linea.pack}`
                            : `Quitar el color ${linea.color}`
                        }
                        data-testid={`${testid}-quitar-color`}
                      >
                        <Trash2Icon className="size-4" aria-hidden />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <td className="sticky left-0 z-10 bg-card px-2 py-1.5 text-muted-foreground">
                  Total
                </td>
                {conPacks ? <td aria-hidden /> : null}
                {tallas.map((talla) => (
                  <td
                    key={talla.idTalla}
                    className="px-1 py-1.5 text-center tabular-nums"
                    data-testid={`${testid}-total-columna`}
                  >
                    {(totalesColumna[talla.idTalla] ?? 0).toLocaleString('es-MX')}
                  </td>
                ))}
                <td
                  className="px-2 py-1.5 text-right tabular-nums"
                  data-testid={`${testid}-total-general`}
                >
                  {totalGeneral.toLocaleString('es-MX')}
                </td>
                {!soloLectura ? <td aria-hidden /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!soloLectura && tallas.length === 0 && lineas.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Agrega una talla para capturar cantidades en cada color.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Memo: evita re-render de toda la matriz cuando el padre re-renderiza sin cambiar props (con
 * muchas líneas, teclear en una celda no debe re-renderizar todo el árbol del padre).
 */
export const MatrizColorTalla = memo(MatrizColorTallaBase);
