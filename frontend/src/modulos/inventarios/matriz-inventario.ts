import type { MatrizLinea, MatrizTalla } from '@/componentes/matriz-color-talla/MatrizColorTalla';

/**
 * Helpers para la {@link MatrizColorTalla} en el inventario PT (F3-E3). A diferencia del corte/envío
 * (que se limitan a la matriz de UNA orden), un movimiento manual o un traspaso pueden ser de
 * CUALQUIER color×talla del catálogo: aquí los colores/tallas disponibles vienen de los catálogos
 * globales y el usuario agrega los renglones/columnas que necesite. Funciones PURAS (A1).
 */

/** Suma total de una matriz de captura (todas las celdas). */
export function totalMatriz(lineas: readonly MatrizLinea[]): number {
  return lineas.reduce(
    (suma, l) => suma + Object.values(l.cantidades).reduce((s, c) => s + c, 0),
    0,
  );
}

/**
 * Convierte la matriz de captura al cuerpo `lineas` que espera el API (descartando ceros).
 *
 * `numOrdenV1` (§Post-F9.25) es el nº de la orden del sistema VIEJO que fabricó estas prendas. El
 * API lo recibe POR COLOR, pero la pantalla lo captura UNA vez por movimiento y lo replica: en el
 * conteo inicial se cuenta un lote de una orden a la vez, y pedirlo color por color sería teclear lo
 * mismo N veces. Si un movimiento mezclara dos órdenes, se capturan dos movimientos.
 */
export function aLineasApi(
  lineas: readonly MatrizLinea[],
  numOrdenV1?: string,
): {
  idColor: number;
  tallas: { idTalla: number; cantidad: number }[];
  numOrdenV1?: string;
}[] {
  const ref = (numOrdenV1 ?? '').trim();
  return lineas
    .map((l) => ({
      idColor: l.idColor,
      tallas: Object.entries(l.cantidades)
        .map(([idTalla, cantidad]) => ({ idTalla: Number(idTalla), cantidad }))
        .filter((t) => t.cantidad > 0),
      ...(ref === '' ? {} : { numOrdenV1: ref }),
    }))
    .filter((l) => l.tallas.length > 0);
}

/** Opciones de color para la matriz, desde el catálogo (`{ id, nombre }`). */
export function coloresOpciones(
  colores: readonly { id: number; nombre: string }[],
): { id: number; nombre: string }[] {
  return colores.map((c) => ({ id: c.id, nombre: c.nombre }));
}

/** Columnas (tallas) para la matriz, desde el catálogo, ordenadas por su `orden`. */
export function tallasColumnas(
  tallas: readonly { id: number; etiqueta: string; orden: number }[],
): MatrizTalla[] {
  return tallas
    .slice()
    .sort((a, b) => a.orden - b.orden || a.id - b.id)
    .map((t) => ({ idTalla: t.id, etiqueta: t.etiqueta }));
}
