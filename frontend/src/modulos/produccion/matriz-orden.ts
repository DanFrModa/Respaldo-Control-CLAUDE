import type { MatrizLinea, MatrizTalla } from '@/componentes/matriz-color-talla/MatrizColorTalla';
import type { Orden, PendientesOrden } from '@/api/tipos';

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

/** Mapa `clave(color:talla) → cantidad` de un arreglo de celdas de pendientes. */
export function mapaPendiente(
  celdas: readonly { idColor: number; idTalla: number; cantidad: number }[],
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const c of celdas) {
    mapa.set(`${c.idColor}:${c.idTalla}`, c.cantidad);
  }
  return mapa;
}

/** "Por cortar" por celda (orden − corte) de los pendientes, indexado por color:talla. */
export function mapaPorCortar(pendientes: PendientesOrden | undefined): Map<string, number> {
  return mapaPendiente(pendientes?.porCortar ?? []);
}

/** "Cortado por enviar" de un proceso concreto, indexado por color:talla. */
export function mapaCortadoPorEnviar(
  pendientes: PendientesOrden | undefined,
  idTipoProceso: number | undefined,
): Map<string, number> {
  if (pendientes === undefined || idTipoProceso === undefined) {
    return new Map();
  }
  const proc = pendientes.cortadoPorEnviar.find((p) => p.idTipoProceso === idTipoProceso);
  return mapaPendiente(proc?.celdas ?? []);
}
