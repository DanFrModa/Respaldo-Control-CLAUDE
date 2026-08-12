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
 *
 * `idOrden` (§Post-F9.40) es la ORDEN de v2 de la que salen las piezas — el bucket de existencia
 * (modelo×color×talla×ORDEN×almacén, F6-E2). `null` = bucket «sin orden» (lo capturado a mano y lo
 * migrado). Se replica a todos los colores por la MISMA razón que `numOrdenV1`, y con la misma
 * consecuencia: un movimiento que mezcle dos órdenes se captura como dos movimientos (el servidor
 * exige un color por captura).
 */
export function aLineasApi(
  lineas: readonly MatrizLinea[],
  numOrdenV1?: string,
  idOrden?: number | null,
): {
  idColor: number;
  idOrden?: number | null;
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
      ...(idOrden === undefined || idOrden === null ? {} : { idOrden }),
      ...(ref === '' ? {} : { numOrdenV1: ref }),
    }))
    .filter((l) => l.tallas.length > 0);
}

/**
 * Valor del `<select>` de orden para el bucket «SIN ORDEN» (§Post-F9.40). Es una opción REAL del
 * negocio —donde cae lo capturado a mano y lo migrado—, no un "sin elegir": por eso tiene valor
 * propio y no cadena vacía.
 */
export const SIN_ORDEN = 'sin';

/** Traduce el valor del `<select>` al `idOrden` que espera el API (`null` = bucket «sin orden»). */
export function aIdOrden(valor: string): number | null {
  return valor === SIN_ORDEN ? null : Number(valor);
}

/** Una orden con existencia real del artículo en el almacén, para el selector de bucket. */
export interface OpcionOrdenExistencia {
  /** `null` = bucket «sin orden» (lo capturado a mano en el arranque y lo migrado). */
  idOrden: number | null;
  folioOrden: number | null;
  /** Piezas disponibles de ese bucket en el almacén (suma de las filas de existencia). */
  existencia: number;
}

/**
 * Deriva las ÓRDENES CON EXISTENCIA REAL de las filas de existencia ya filtradas por modelo y
 * almacén (§Post-F9.40): el selector ofrece SOLO esos buckets —nunca el catálogo entero de
 * órdenes—, incluido el bucket «sin orden». Función PURA (A1): el servidor sigue siendo la
 * autoridad del no-negativo.
 */
export function ordenesConExistencia(
  filas: readonly { idOrden: number | null; folioOrden: number | null; existencia: number }[],
): OpcionOrdenExistencia[] {
  const porOrden = new Map<string, OpcionOrdenExistencia>();
  for (const f of filas) {
    if (f.existencia <= 0) continue;
    const clave = f.idOrden === null ? 'sin' : String(f.idOrden);
    const acumulado = porOrden.get(clave);
    if (acumulado === undefined) {
      porOrden.set(clave, {
        idOrden: f.idOrden,
        folioOrden: f.folioOrden,
        existencia: f.existencia,
      });
    } else {
      acumulado.existencia += f.existencia;
    }
  }
  // El bucket «sin orden» primero (es el default de captura); luego por folio ascendente.
  return [...porOrden.values()].sort(
    (a, b) => (a.folioOrden ?? -1) - (b.folioOrden ?? -1) || (a.idOrden ?? 0) - (b.idOrden ?? 0),
  );
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
