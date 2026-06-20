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
