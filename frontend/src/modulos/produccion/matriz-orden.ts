import type { MatrizLinea, MatrizTalla } from '@/componentes/matriz-color-talla/MatrizColorTalla';
import type { Orden } from '@/api/tipos';

/**
 * Helpers para alimentar la {@link MatrizColorTalla} desde una orden (F3-E2). El corte y el envío
 * capturan SOLO los colores/tallas de la orden (D4); estos helpers derivan las columnas (tallas) y
 * las filas vacías a partir de la matriz de la orden, y proyectan los pendientes a un mapa para
 * mostrarlos en vivo.
 */

/** Columnas (tallas) únicas de la orden, en el orden en que aparecen en su matriz. */
export function tallasDeOrden(orden: Orden): MatrizTalla[] {
  const vistas = new Map<number, MatrizTalla>();
  for (const linea of orden.lineas) {
    for (const t of linea.tallas) {
      if (!vistas.has(t.idTalla)) {
        vistas.set(t.idTalla, { idTalla: t.idTalla, etiqueta: t.etiquetaTalla });
      }
    }
  }
  return [...vistas.values()];
}

/** Colores de la orden como opciones para el selector de la matriz (todos los de la orden). */
export function coloresDeOrden(orden: Orden): { id: number; nombre: string }[] {
  return orden.lineas.map((l) => ({ id: l.idColor, nombre: l.color }));
}

/** Filas vacías (un color con cantidades 0) listas para capturar, una por color de la orden. */
export function lineasVaciasDeOrden(orden: Orden): MatrizLinea[] {
  return orden.lineas.map((l) => ({ idColor: l.idColor, color: l.color, cantidades: {} }));
}

/** Suma total de una matriz de captura (todas las celdas). */
export function totalMatriz(lineas: readonly MatrizLinea[]): number {
  return lineas.reduce(
    (suma, l) => suma + Object.values(l.cantidades).reduce((s, c) => s + c, 0),
    0,
  );
}

/** Convierte la matriz de captura al cuerpo `lineas` que espera el API (descartando ceros). */
export function aLineasApi(
  lineas: readonly MatrizLinea[],
): { idColor: number; tallas: { idTalla: number; cantidad: number }[] }[] {
  return lineas
    .map((l) => ({
      idColor: l.idColor,
      tallas: Object.entries(l.cantidades)
        .map(([idTalla, cantidad]) => ({ idTalla: Number(idTalla), cantidad }))
        .filter((t) => t.cantidad > 0),
    }))
    .filter((l) => l.tallas.length > 0);
}

/**
 * Piezas que de verdad se le pueden recibir a un maquilero: SOLO las celdas positivas. El total
 * puede dar 0 con celdas +5/−5 (recibo capturado en la talla equivocada en el Access) y entonces
 * decir "0 pza(s)" sería falso — sí hay 5 por recibir (hallazgo del reviewer).
 *
 * ⚠️ Suma **`cantidad`**, que desde V1-E8v (§Post-F9.147) es EL pendiente y a la vez EL tope de
 * captura: son el mismo número. Hasta V1-E8k eran dos —el pendiente se dejaba abierto "para cobrar
 * el faltante" y el tope viajaba en un campo `recibible` aparte—, pero Daniel corrigió el encuadre
 * (*"al registrarlas como incompletas entregadas, dejan de estar en la maquila"*): la incompleta ya
 * volvió del taller, así que cierra el pendiente. El campo `recibible` se retiró del contrato al
 * volverse idéntico a éste — dos nombres para un número igual acaban divergiendo.
 *
 * 🔑 Lo calcula el SERVIDOR con la misma función que el tope del guardado (`pendientePorCelda`);
 * aquí NO se re-deriva nada, sólo se suman las celdas positivas.
 */
export function piezasRecibibles(celdas: readonly { cantidad: number }[]): number {
  return celdas.reduce((s, c) => s + Math.max(0, c.cantidad), 0);
}

/**
 * Tallas + colores de una orden para la matriz CON CANDADO del panel de avance
 * (`components/dominio/MatrizColorTalla`, que pide `{idTalla, etiqueta}` / `{idColor, nombre}` —
 * distinta de la matriz editable de la orden, que consume `tallasDeOrden`/`coloresDeOrden`).
 * Vive aquí porque las DOS capturas del panel (movimientos y entrega a cliente) la derivan igual.
 */
export function ejesDeOrden(orden: Orden): {
  tallas: { idTalla: number; etiqueta: string }[];
  colores: { idColor: number; nombre: string }[];
} {
  const vistas = new Map<number, { idTalla: number; etiqueta: string }>();
  for (const linea of orden.lineas) {
    for (const t of linea.tallas) {
      if (!vistas.has(t.idTalla)) {
        vistas.set(t.idTalla, { idTalla: t.idTalla, etiqueta: t.etiquetaTalla });
      }
    }
  }
  return {
    tallas: [...vistas.values()],
    colores: orden.lineas.map((l) => ({ idColor: l.idColor, nombre: l.color })),
  };
}

// `mapaPendiente`, `mapaPorCortar` y `mapaCortadoPorEnviar` se BORRARON en V1-E3a: sus únicos
// consumidores eran las tres pantallas retiradas (`/produccion/{corte,envios,recibos}`). El panel de
// avance deriva sus referencias del WIP de la orden (`wipDeOrden`), no de `PendientesOrden`.
