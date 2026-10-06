/**
 * ⭐⭐ FILA 0.219 — LA ENTREGA A CLIENTE ENSEÑA LA EXISTENCIA POR TALLA.
 *
 * Nace del repaso de Inventarios de DANIEL (§Post-F9.243, punto 10b):
 *
 * > *«Debería de decir la existencia que hay por talla para saber lo que se va a capturar no exceda
 * > la cantidad por talla.»*
 *
 * Es el mismo molde que las filas 0.216 (nota de salida) y 0.233 (capturas de avíos): la existencia
 * se PINTA junto a lo que se captura —también cuando es CERO— y lo que la rebasa se marca. Lo usan
 * las DOS puertas al mismo acto: la pantalla del menú (`EntregaClientePagina`) y la etapa «Entrega a
 * cliente» del panel de avance (`AvanceProduccion`).
 *
 * ⚠️ **Esto NO sustituye la guarda del servidor** (A1): el no-negativo de la entrega lo sigue
 * validando el dominio (`entregas-cliente.ts::validarNoNegativo`) al guardar, bajo bloqueo y por suma
 * directa de movimientos. Aquí sólo se le dice a quien captura lo que hay ANTES de que llegue ahí.
 *
 * Funciones PURAS (A1): no saben de React ni de la red.
 */

/**
 * Existencia por celda `color:talla` de ESTA orden en el almacén elegido — o `undefined` cuando **no
 * se sabe**. La diferencia entre «mapa» y `undefined` es la que evita frenar una captura por un cero
 * inventado: con `undefined` ni se pinta existencia ni se bloquea nada, y decide el servidor.
 *
 * Sin pack: el inventario de producto terminado se lleva por modelo×color×talla×orden×almacén y no
 * guarda el tendido (§Post-F9.10), así que las filas de la entrega ya van plegadas por color.
 */
export type ExistenciaEntrega = ReadonlyMap<string, number> | undefined;

/** Llave de una celda de existencia: `color:talla` (sin pack, ver {@link ExistenciaEntrega}). */
export function claveExistencia(idColor: number, idTalla: number): string {
  return `${String(idColor)}:${String(idTalla)}`;
}

/** Lo mínimo de la consulta `seguimiento-entrega` (react-query) que decide si la existencia se sabe. */
export interface ConsultaSeguimientoExistencia {
  data?:
    | { celdas: readonly { idColor: number; idTalla: number; disponible: number }[] }
    | undefined;
  isError?: boolean;
  isPlaceholderData?: boolean;
}

/**
 * ¿YA SE SABE QUÉ HAY DE ESTA ORDEN EN EL ALMACÉN ELEGIDO? Devuelve el mapa sólo si se cumplen las
 * cuatro condiciones —ninguna sobra, mismas que la 0.216/0.233—:
 *  • **almacén elegido**: sin él el servidor no calcula el `disponible` (lo manda en 0, que NO es
 *    «hay cero»);
 *  • **respuesta en la mano** (`data`): mientras carga, toda celda parecería tener cero;
 *  • **dato de ESTE almacén** (`!isPlaceholderData`): la consulta usa `keepPreviousData`, así que al
 *    cambiar de almacén sigue entregando el disponible del ANTERIOR mientras vuelve el nuevo — y eso
 *    pintaría como existencia de un almacén lo que hay en otro;
 *  • **sin error** (`!isError`): una consulta que falló —o que el servidor negó por permiso— no es un
 *    almacén vacío.
 *
 * Una celda que no viene en el seguimiento se lee como CERO (el seguimiento enumera todas las celdas
 * de la orden; la que no está no es de la orden y el servidor la rechaza igual).
 */
export function existenciaDeSeguimiento(
  consulta: ConsultaSeguimientoExistencia,
  almacenElegido: boolean,
): ExistenciaEntrega {
  if (
    !almacenElegido ||
    consulta.data === undefined ||
    consulta.isPlaceholderData === true ||
    consulta.isError === true
  ) {
    return undefined;
  }
  const mapa = new Map<string, number>();
  for (const c of consulta.data.celdas) {
    mapa.set(claveExistencia(c.idColor, c.idTalla), c.disponible);
  }
  return mapa;
}

/** Existencia de una celda con la existencia CONOCIDA (la que no viene, vale cero). */
export function existenciaDeCelda(
  existencia: ReadonlyMap<string, number>,
  idColor: number,
  idTalla: number,
): number {
  return existencia.get(claveExistencia(idColor, idTalla)) ?? 0;
}

/** Cómo se dice la existencia de una celda junto a lo que se captura en ella. */
export interface LeyendaExistencia {
  /** `crit` = no alcanza (cero o excedida); `normal` = lo capturado cabe. */
  tono: 'normal' | 'crit';
  texto: string;
}

/**
 * La leyenda de UNA celda. El CERO se dice con su nombre —«Sin existencia», no «Excede · hay 0»—:
 * lo que hay que hacer ahí no es bajar la cantidad, es que entre producto (mismo criterio que la
 * 0.216). Lo que rebasa la existencia, «Excede · hay N». Lo demás, «Hay N».
 */
export function leyendaExistencia(cantidad: number, existencia: number): LeyendaExistencia {
  if (existencia <= 0) {
    return { tono: 'crit', texto: 'Sin existencia' };
  }
  const hay = existencia.toLocaleString('es-MX');
  if (cantidad > existencia) {
    return { tono: 'crit', texto: `Excede · hay ${hay}` };
  }
  return { tono: 'normal', texto: `Hay ${hay}` };
}

/**
 * Piezas capturadas POR ENCIMA de la existencia, sumadas sobre todas las celdas. Con la existencia
 * **desconocida** devuelve 0 a propósito: bloquear ahí sería inventar un cero (decide el servidor).
 */
export function piezasExcedidas(
  celdas: Iterable<{ idColor: number; idTalla: number; cantidad: number }>,
  existencia: ExistenciaEntrega,
): number {
  if (existencia === undefined) {
    return 0;
  }
  let total = 0;
  for (const c of celdas) {
    const hay = Math.max(0, existenciaDeCelda(existencia, c.idColor, c.idTalla));
    if (c.cantidad > hay) {
      total += c.cantidad - hay;
    }
  }
  return total;
}
