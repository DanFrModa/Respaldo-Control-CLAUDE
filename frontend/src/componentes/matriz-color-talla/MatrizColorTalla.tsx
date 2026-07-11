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

/** Una fila de la matriz: un color con sus cantidades por talla. */
export interface MatrizLinea {
  /** Id del color (clave de la fila; ÚNICO por matriz). */
  idColor: number;
  /** Nombre visible del color. */
  color: string;
  /** Cantidades por talla: `{ [idTalla]: cantidad }`. Una talla ausente = 0. */
  cantidades: Record<number, number>;
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
  soloLectura = false,
  testid = 'matriz',
}: PropsMatrizColorTalla): React.JSX.Element {
  // Rejilla de refs de celdas para mover el foco con el teclado (filas × columnas).
  const celdasRef = useRef<(HTMLInputElement | null)[][]>([]);

  // Colores ya usados (para ocultarlos del selector de "agregar fila") y tallas ya presentes.
  const coloresUsados = useMemo(() => new Set(lineas.map((l) => l.idColor)), [lineas]);
  const tallasPresentes = useMemo(() => new Set(tallas.map((t) => t.idTalla)), [tallas]);
  const coloresParaAgregar = coloresDisponibles.filter((c) => !coloresUsados.has(c.id));
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

  /** Reemplaza la cantidad de una celda (fila `idColor`, columna `idTalla`) y emite el estado. */
  const cambiarCelda = useCallback(
    (idColor: number, idTalla: number, texto: string): void => {
      const siguiente = lineas.map((linea) =>
        linea.idColor === idColor
          ? { ...linea, cantidades: { ...linea.cantidades, [idTalla]: aCantidad(texto) } }
          : linea,
      );
      onLineasChange(siguiente);
    },
    [lineas, onLineasChange],
  );

  /** Agrega una fila para el color elegido (al final). El color ya no aparecerá en el selector. */
  const agregarColor = useCallback(
    (idColor: number): void => {
      const opcion = coloresDisponibles.find((c) => c.id === idColor);
      if (opcion === undefined || coloresUsados.has(idColor)) {
        return;
      }
      onLineasChange([...lineas, { idColor, color: opcion.nombre, cantidades: {} }]);
    },
    [coloresDisponibles, coloresUsados, lineas, onLineasChange],
  );

  /** Quita la fila de un color. */
  const quitarColor = useCallback(
    (idColor: number): void => {
      onLineasChange(lineas.filter((linea) => linea.idColor !== idColor));
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
                <tr key={linea.idColor} className="border-b" data-testid={`${testid}-fila`}>
                  <td className="sticky left-0 z-10 bg-card px-2 py-1 font-medium whitespace-nowrap">
                    {linea.color}
                  </td>
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
                            aria-label={`${linea.color}, talla ${talla.etiqueta}`}
                            data-testid={`${testid}-celda`}
                            value={cantidad === 0 ? '' : String(cantidad)}
                            onChange={(e) =>
                              cambiarCelda(linea.idColor, talla.idTalla, e.target.value)
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
                        onClick={() => quitarColor(linea.idColor)}
                        aria-label={`Quitar el color ${linea.color}`}
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
