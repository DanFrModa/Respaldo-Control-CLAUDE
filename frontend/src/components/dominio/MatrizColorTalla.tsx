import { Lock } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * MATRIZ COLOR × TALLA con CANDADO (rediseño R2, §4.3 — proto `.proc-matrix`): la captura de un
 * movimiento de avance (corte / envío / recibo) SOLO sobre los renglones y tallas DE LA ORDEN — las
 * filas y columnas son FIJAS (nada de agregar/quitar: ese es el candado que pidió Daniel). Los
 * totales (fila, columna y general) se suman solos, y el estado cuadra/faltan/sobran se deriva
 * contra una REFERENCIA (p. ej. el pendiente por cortar/enviar de esa etapa).
 *
 * ⭐ UNA FILA ES UN COLOR × PACK (§Post-F9.10): en una orden con dos tendidos del mismo color hay
 * DOS filas, cada una con su propia cuenta y su propio pendiente. En una orden sin packs el pack va
 * vacío, la fila es la de siempre y nada en pantalla cambia.
 *
 * Distinta de `componentes/matriz-color-talla` (la captura de la MATRIZ de la orden, F2-E3, que sí
 * agrega/quita colores y tallas): aquí la orden manda y la captura solo llena celdas.
 *
 * Presentación PURA (A1): no conoce órdenes; el backend re-valida el candado (D4) y las reglas
 * (sobre-corte libre / sobre-envío estricto).
 */

/** Una columna (talla) de la matriz. */
export interface CeldaTalla {
  idTalla: number;
  etiqueta: string;
}

/**
 * Una fila de la matriz: un COLOR × su PACK (§Post-F9.10). En una orden sin packs `pack` va vacío y
 * la fila es la de siempre, «un renglón por color».
 */
export interface CeldaColor {
  idColor: number;
  nombre: string;
  /** PACK / TENDIDO de la fila. CADENA VACÍA = la orden no maneja packs (o la etapa no lo maneja). */
  pack: string;
}

/**
 * Clave estable de una celda color×talla×PACK — la MISMA convención `color:talla:pack` que
 * `packs.ts::claveCeldaPack` en el backend, que es de donde vienen los pendientes y las sugerencias
 * que esta matriz lee. Si las dos convenciones divergieran, la referencia de cada celda se buscaría
 * con una llave que el servidor nunca escribió y saldría siempre `undefined`.
 *
 * ⚠️ El `pack` es OBLIGATORIO a propósito (no tiene default `''`). Antes de §Post-F9.10 la llave era
 * de dos partes y los ~15 sitios que la construyen en `AvanceProduccion` la escribían así; dejarlo
 * opcional habría hecho que los que se olvidaran de pasarlo siguieran compilando y **plegaran dos
 * tendidos en la misma celda en silencio** — dos filas distintas editando el mismo número. Que sea
 * obligatorio convierte cada olvido en un error de compilación.
 *
 * El color y la talla son enteros, así que los dos primeros separadores son inequívocos y el pack es
 * todo lo que queda: una etiqueta con `:` adentro no puede hacerse pasar por otra celda.
 */
export function claveCelda(idColor: number, idTalla: number, pack: string): string {
  return `${idColor}:${idTalla}:${pack}`;
}

/** Clave estable de una FILA (color × pack), para el `key` de React y los refs de teclado. */
function claveFila(color: CeldaColor): string {
  return `${color.idColor}:${color.pack}`;
}

/** Estado derivado de la captura contra su referencia (cuadra / faltan / sobran). */
export interface EstadoCaptura {
  tono: 'ok' | 'warn' | 'crit' | 'neutro';
  texto: string;
}

/**
 * Deriva el estado cuadra/faltan/sobran de un total capturado contra la referencia (si la hay).
 * Pura y probada por unit: `total === referencia` cuadra; menos = faltan N; más = sobran N.
 *
 * ⚠️ `sustantivo` — cómo se LLAMA la referencia en el texto. El default es *"el pendiente"*, que es
 * lo que la referencia significa en corte y envío. En el RECIBO se le llama *"lo que todavía se le
 * puede recibir"*, que es **el mismo número** dicho en el idioma de esa pantalla (V1-E8v,
 * §Post-F9.147: el pendiente del maquilero y su tope de captura son uno solo desde que la prenda
 * incompleta sale del tránsito). Entre V1-E8k y V1-E8v SÍ fueron dos cifras distintas y este
 * parámetro nació para que la pantalla no las llamara igual; hoy sólo elige el nombre.
 */
export function estadoCaptura(
  total: number,
  referencia: number | undefined,
  sustantivo = 'el pendiente',
): EstadoCaptura {
  if (referencia === undefined) {
    return { tono: 'neutro', texto: `${total.toLocaleString('es-MX')} pzas capturadas` };
  }
  if (total === referencia) {
    return { tono: 'ok', texto: `Cuadra con ${sustantivo}` };
  }
  if (total < referencia) {
    return {
      tono: 'warn',
      texto: `Faltan ${(referencia - total).toLocaleString('es-MX')} pzas (captura parcial)`,
    };
  }
  return {
    tono: 'crit',
    texto: `Sobran ${(total - referencia).toLocaleString('es-MX')} pzas sobre ${sustantivo}`,
  };
}

/** Props de {@link MatrizColorTalla} (la variante con candado). */
export interface PropsMatrizCandado {
  /** Columnas: las tallas DE LA ORDEN (fijas). */
  tallas: readonly CeldaTalla[];
  /** Filas: los renglones DE LA ORDEN (color × pack, fijos). */
  colores: readonly CeldaColor[];
  /** Cantidades capturadas por celda (`claveCelda(color,talla,pack)` → cantidad). Controlado. */
  valores: Readonly<Record<string, number>>;
  /** Emite la celda editada (cantidad entera ≥ 0). El `pack` es el de la FILA. */
  onCambiar: (idColor: number, idTalla: number, pack: string, cantidad: number) => void;
  /** Referencia por celda (p. ej. pendiente de la etapa) para el hint bajo cada input. */
  referencia?: ReadonlyMap<string, number>;
  /** Total de referencia del movimiento (para el estado cuadra/faltan/sobran). */
  totalReferencia?: number;
  /** Etiqueta de la referencia (p. ej. "pendiente por enviar"). */
  etiquetaReferencia?: string;
  /**
   * Cómo se NOMBRA la referencia en el estado cuadra/faltan/sobran (V1-E8k). Default
   * `'el pendiente'`; en el recibo se pasa *"lo que todavía se le puede recibir"*, porque ahí la
   * referencia y el pendiente son dos números distintos (ver {@link estadoCaptura}).
   */
  sustantivoReferencia?: string;
  deshabilitada?: boolean;
  /** Base de los `data-testid` (default "matriz-candado"). */
  testid?: string;
}

/** Normaliza el texto de una celda a entero ≥ 0. */
function aCantidad(texto: string): number {
  const valor = Number(texto.trim());
  if (!Number.isFinite(valor) || valor < 0) {
    return 0;
  }
  return Math.floor(valor);
}

/**
 * Matriz de captura con candado: filas/columnas fijas de la orden, navegación con teclado
 * (flechas/Enter), totales vivos y leyenda del candado + estado contra la referencia.
 */
export function MatrizColorTalla({
  tallas,
  colores,
  valores,
  onCambiar,
  referencia,
  totalReferencia,
  etiquetaReferencia = 'pendiente',
  sustantivoReferencia = 'el pendiente',
  deshabilitada = false,
  testid = 'matriz-candado',
}: PropsMatrizCandado): React.JSX.Element {
  const celdasRef = useRef<(HTMLInputElement | null)[][]>([]);

  const totalesFila = useMemo(
    () =>
      colores.map((color) =>
        tallas.reduce(
          (s, t) => s + (valores[claveCelda(color.idColor, t.idTalla, color.pack)] ?? 0),
          0,
        ),
      ),
    [colores, tallas, valores],
  );
  const totalesColumna = useMemo(
    () =>
      tallas.map((t) =>
        colores.reduce(
          (s, color) => s + (valores[claveCelda(color.idColor, t.idTalla, color.pack)] ?? 0),
          0,
        ),
      ),
    [colores, tallas, valores],
  );
  const totalGeneral = totalesFila.reduce((s, v) => s + v, 0);
  const estado = estadoCaptura(totalGeneral, totalReferencia, sustantivoReferencia);

  function navegar(
    evento: React.KeyboardEvent<HTMLInputElement>,
    fila: number,
    columna: number,
  ): void {
    const teclas: Record<string, [number, number]> = {
      ArrowUp: [fila - 1, columna],
      ArrowDown: [fila + 1, columna],
      Enter: [fila + 1, columna],
    };
    const destino = teclas[evento.key];
    if (destino === undefined) {
      return;
    }
    const celda = celdasRef.current[destino[0]]?.[destino[1]];
    if (celda) {
      evento.preventDefault();
      celda.focus();
      try {
        celda.select();
      } catch {
        // `<input type="number">` puede no soportar la selección.
      }
    }
  }

  celdasRef.current = colores.map((_, fila) => celdasRef.current[fila] ?? []);

  return (
    <div className="space-y-2" data-testid={testid}>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-secondary">
              <th className="px-2.5 py-1.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Color
              </th>
              {tallas.map((t) => (
                <th
                  key={t.idTalla}
                  className="px-1.5 py-1.5 text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  {t.etiqueta}
                </th>
              ))}
              <th className="px-2.5 py-1.5 text-right text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {colores.map((color, indiceFila) => (
              <tr key={claveFila(color)} className="border-b" data-testid={`${testid}-fila`}>
                <td className="px-2.5 py-1 font-medium whitespace-nowrap">
                  {color.nombre}
                  {/* El PACK va PEGADO al color y no en una columna aparte: dos tendidos del mismo
                      color son dos filas que, sin esto, se leerían idénticas (§Post-F9.10). */}
                  {color.pack !== '' ? (
                    <span
                      className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground"
                      data-testid={`${testid}-pack`}
                    >
                      Pack {color.pack}
                    </span>
                  ) : null}
                </td>
                {tallas.map((t, indiceColumna) => {
                  const clave = claveCelda(color.idColor, t.idTalla, color.pack);
                  const cantidad = valores[clave] ?? 0;
                  // El pendiente puede venir NEGATIVO (sobre-corte, decisión f): el hint se
                  // clampa a 0 — "de −2" no significa nada para quien captura.
                  const pendienteCrudo = referencia?.get(clave);
                  const pendiente =
                    pendienteCrudo === undefined ? undefined : Math.max(0, pendienteCrudo);
                  return (
                    <td key={t.idTalla} className="px-1 py-1 text-center align-top">
                      <Input
                        ref={(el) => {
                          const fila = (celdasRef.current[indiceFila] ??= []);
                          fila[indiceColumna] = el;
                        }}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        disabled={deshabilitada}
                        className="mx-auto h-8 w-16 text-center"
                        aria-label={
                          color.pack === ''
                            ? `${color.nombre}, talla ${t.etiqueta}`
                            : `${color.nombre} pack ${color.pack}, talla ${t.etiqueta}`
                        }
                        data-testid={`${testid}-celda`}
                        value={cantidad === 0 ? '' : String(cantidad)}
                        placeholder="0"
                        onChange={(e) =>
                          onCambiar(color.idColor, t.idTalla, color.pack, aCantidad(e.target.value))
                        }
                        onKeyDown={(e) => navegar(e, indiceFila, indiceColumna)}
                      />
                      {pendiente !== undefined ? (
                        <span
                          className={cn(
                            'mt-0.5 block text-[10.5px] tabular-nums',
                            cantidad > pendiente ? 'text-warn' : 'text-faint',
                          )}
                          data-testid={`${testid}-hint`}
                        >
                          de {pendiente.toLocaleString('es-MX')}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
                <td
                  className="px-2.5 py-1 text-right font-semibold tabular-nums"
                  data-testid={`${testid}-total-fila`}
                >
                  {(totalesFila[indiceFila] ?? 0).toLocaleString('es-MX')}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-secondary font-semibold">
              <td className="px-2.5 py-1.5 text-muted-foreground">Total</td>
              {tallas.map((t, indice) => (
                <td
                  key={t.idTalla}
                  className="px-1.5 py-1.5 text-center tabular-nums"
                  data-testid={`${testid}-total-columna`}
                >
                  {(totalesColumna[indice] ?? 0).toLocaleString('es-MX')}
                </td>
              ))}
              <td
                className="px-2.5 py-1.5 text-right tabular-nums"
                data-testid={`${testid}-total-general`}
              >
                {totalGeneral.toLocaleString('es-MX')}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Lock className="size-3" aria-hidden />
          Candado: solo los renglones y tallas de la orden
        </span>
        <span
          className={cn(
            'font-medium',
            estado.tono === 'ok' && 'text-ok',
            estado.tono === 'warn' && 'text-warn',
            estado.tono === 'crit' && 'text-crit',
            estado.tono === 'neutro' && 'text-muted-foreground',
          )}
          data-testid={`${testid}-estado`}
        >
          {estado.texto}
          {totalReferencia !== undefined ? (
            <span className="font-normal text-faint"> · {etiquetaReferencia}</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
