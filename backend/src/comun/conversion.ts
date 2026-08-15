/**
 * Motor de CONVERSIÓN de presentación de compra → unidad de consumo del BOM (F4-E1, R1 —
 * REQUISITOS-NUEVOS.md §R1; doc 04-Inventarios §B "Cómo conecta").
 *
 * El problema (R7, ejemplo del dueño): se compra "15 Rollos" pero el BOM consume "metros"; sin
 * convertir, el cruce "qué tengo / qué falta" no cuadra ("15 Rollos" ≠ "750 mts") y la valuación
 * se infla (precio por rollo aplicado como costo por metro). El FACTOR de conversión resuelve
 * ambas cosas a la vez:
 *
 *   factor = cuántas UNIDADES DE CONSUMO trae UNA presentación de compra
 *            (p. ej. un rollo de 50 m → factor 50; una caja de 144 pzas → factor 144).
 *
 *   • CANTIDAD en unidad de consumo = cantidad en presentación × factor   (15 rollos × 50 = 750 m)
 *   • COSTO por unidad de consumo    = precio por presentación ÷ factor    ($500/rollo ÷ 50 = $10/m)
 *
 * Invariante de VALUACIÓN (lo que E3 verifica con un test): el IMPORTE total NO cambia al convertir
 *   cantidadConsumo × costoConsumo  ==  cantidadPresentacion × precioPresentacion
 *   (750 × $10 = $7,500 == 15 × $500). El factor solo redistribuye entre cantidad y unitario.
 *
 * DÓNDE VIVE EL FACTOR (decisión de diseño F4-E1, TSDoc del schema):
 *  • `AvioProveedor.factorConversion` — el factor "fino", POR PROVEEDOR (R1: el mismo avío se
 *    compra a varios proveedores en presentaciones distintas → cada uno define su factor). Es el
 *    que usa la recepción (E3), que ya eligió proveedor+precio.
 *  • `Avio.factorConversion` — fallback por defecto del avío cuando el `AvioProveedor` no define el
 *    suyo (p. ej. presentación estándar del avío).
 *  • Si ambos son NULL ⇒ se asume 1:1 (presentación == unidad de consumo): la conversión no altera
 *    nada. (Las TELAS se compran por lote en su propia unidad; su conversión, si llega a hacer
 *    falta, se modela por lote en E3 — aquí el motor es genérico y sirve a ambas dimensiones.)
 *
 * Este módulo vive en `comun/` (A1): es matemática pura, SIN acceso a base de datos. Los servicios
 * de dominio leen el factor del registro correspondiente y llaman a estas funciones. Se trabaja con
 * `number` (los Decimal de Prisma se pasan ya numéricos): las cantidades de inventario de v2 caben
 * con holgura en doble precisión y el redondeo final lo decide quien guarda (Decimal de la columna).
 */
import { ErrorValidacion } from './errores.js';

/** Factor 1:1 (presentación == unidad de consumo): la conversión es la identidad. */
export const FACTOR_IDENTIDAD = 1;

/**
 * Resuelve el FACTOR de conversión efectivo a partir del factor del proveedor y el del avío
 * (en ese orden de prioridad). Devuelve 1 (identidad) si ninguno está definido.
 *
 * @param factorProveedor `AvioProveedor.factorConversion` (el fino, por proveedor) o null/undefined.
 * @param factorAvio      `Avio.factorConversion` (fallback del avío) o null/undefined.
 * @returns el factor a usar (> 0). Lanza `ErrorValidacion` si el factor presente es ≤ 0.
 */
export function resolverFactor(
  factorProveedor?: number | null,
  factorAvio?: number | null,
): number {
  const factor = factorProveedor ?? factorAvio ?? FACTOR_IDENTIDAD;
  return validarFactor(factor);
}

/** Valida que un factor sea un número finito y estrictamente positivo. Lo devuelve para encadenar. */
export function validarFactor(factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new ErrorValidacion(
      `El factor de conversión debe ser un número mayor que cero (recibido: ${String(factor)}).`,
    );
  }
  return factor;
}

/**
 * SANEA un factor guardado para una LECTURA de pantalla: devuelve el factor si es usable
 * (finito y > 0) y `null` si quedó corrupto (0, negativo, NaN). O sea: **un factor basura se lee
 * como si no estuviera**.
 *
 * Por qué existe (V1-E3c): las consultas —la ficha del modelo, el selector de proveedores del
 * BOM— resuelven el precio con el MISMO motor que el costeo ({@link resolverFactor}, que LANZA
 * ante un factor inválido, y así debe seguir: valuar inventario con un factor malo es peor que
 * fallar). Para no tener dos reglas de precio, la lectura no esquiva el motor: **sanea su
 * entrada** y deja que el motor haga lo de siempre. El dominio impide capturar un factor ≤ 0,
 * pero la columna es `Decimal?` sin CHECK y el ETL podría meterlo.
 *
 * Qué se ve cuando el factor está corrupto: como el valor se ignora, la conversión cae al
 * siguiente escalón definido — el factor del PRODUCTO si es válido, y si tampoco, 1:1 (el precio
 * se muestra sin convertir). Nunca un 500 en una pantalla de consulta.
 *
 * NO usarlo al escribir movimientos ni costos: ahí el factor inválido SÍ tiene que reventar.
 */
export function factorParaLectura(factor?: number | null): number | null {
  return factor != null && Number.isFinite(factor) && factor > 0 ? factor : null;
}

/**
 * Convierte una CANTIDAD de la presentación de compra a la unidad de consumo del BOM.
 *   cantidadConsumo = cantidadPresentacion × factor   (15 rollos × 50 = 750 m).
 *
 * @param cantidadPresentacion cantidad en presentación (p. ej. 15 rollos). Debe ser ≥ 0 y finita.
 * @param factor               unidades de consumo por presentación (> 0).
 */
export function cantidadAUnidadConsumo(cantidadPresentacion: number, factor: number): number {
  validarFactor(factor);
  validarCantidad(cantidadPresentacion);
  return cantidadPresentacion * factor;
}

/**
 * Convierte un PRECIO por presentación a COSTO por unidad de consumo.
 *   costoConsumo = precioPresentacion ÷ factor   ($500/rollo ÷ 50 = $10/m).
 *
 * Garantiza la invariante de valuación: cantidadConsumo × costoConsumo == cantidadPresentacion ×
 * precioPresentacion (el importe total no cambia). No redondea: el llamador decide la precisión
 * final al guardar en la columna Decimal del movimiento.
 *
 * @param precioPresentacion precio por presentación (p. ej. $500/rollo). Debe ser ≥ 0 y finito.
 * @param factor             unidades de consumo por presentación (> 0).
 */
export function precioAUnidadConsumo(precioPresentacion: number, factor: number): number {
  validarFactor(factor);
  if (!Number.isFinite(precioPresentacion) || precioPresentacion < 0) {
    throw new ErrorValidacion(
      `El precio por presentación debe ser un número ≥ 0 (recibido: ${String(precioPresentacion)}).`,
    );
  }
  return precioPresentacion / factor;
}

/** Valida que una cantidad sea finita y ≥ 0 (las cantidades de kardex nunca son negativas). */
function validarCantidad(cantidad: number): void {
  if (!Number.isFinite(cantidad) || cantidad < 0) {
    throw new ErrorValidacion(
      `La cantidad a convertir debe ser un número ≥ 0 (recibido: ${String(cantidad)}).`,
    );
  }
}

/**
 * Resultado de convertir una línea de compra completa a unidad de consumo (lo que E3 guardará en el
 * movimiento de kardex): cantidad y costo unitario ya convertidos, más el importe total (que debe
 * coincidir con cantidadPresentacion × precioPresentacion — invariante de valuación).
 */
export interface LineaConvertida {
  /** Cantidad ya en unidad de consumo (cantidadPresentacion × factor). */
  cantidadConsumo: number;
  /** Costo por unidad de consumo (precioPresentacion ÷ factor). */
  costoUnitConsumo: number;
  /** Importe total = cantidadConsumo × costoUnitConsumo (== cantidadPresentacion × precioPresentacion). */
  importe: number;
  /** Factor aplicado (para trazabilidad/depuración). */
  factor: number;
}

/**
 * Convierte una línea de compra (cantidad + precio en presentación) a unidad de consumo en una sola
 * llamada, devolviendo cantidad, costo unitario e importe. Helper de conveniencia para E3 (la
 * recepción): garantiza que cantidad y costo se conviertan con EL MISMO factor (evita aplicar el
 * factor a uno y no al otro, que descuadraría la valuación).
 */
export function convertirLineaCompra(
  cantidadPresentacion: number,
  precioPresentacion: number,
  factorProveedor?: number | null,
  factorAvio?: number | null,
): LineaConvertida {
  const factor = resolverFactor(factorProveedor, factorAvio);
  const cantidadConsumo = cantidadAUnidadConsumo(cantidadPresentacion, factor);
  const costoUnitConsumo = precioAUnidadConsumo(precioPresentacion, factor);
  return {
    cantidadConsumo,
    costoUnitConsumo,
    importe: cantidadConsumo * costoUnitConsumo,
    factor,
  };
}
