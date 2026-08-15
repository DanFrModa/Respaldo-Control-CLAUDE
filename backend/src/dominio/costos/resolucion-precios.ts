/**
 * RESOLUCIÓN DE PRECIOS DE INSUMO amarrados a proveedor/producto/precio (F8-E1; R17/D13 —
 * PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md §7-A/B). Funciones PURAS (las ejercitan
 * los tests unitarios), SIN dependencias de BD: reciben ya los precios/factores leídos del catálogo
 * y devuelven el precio efectivo + de DÓNDE salió (traza).
 *
 * Es la pieza HABILITADORA de la fase: hoy el pre-costo de F7 valúa la tela con el
 * `Tela.precioSugerido` GENÉRICO y el avío con `Avio.precioReferencia`/"más barato"; F8 amarra el
 * precio a un proveedor concreto elegido por Desarrollo. La MISMA cascada la usan el precosteo
 * persistido (E3) y el MRP enganchado (E6) — por eso vive aquí, compartida, con tests.
 *
 * CASCADA DE LA TELA (4 pasos, la del hueco grande — hoy no existe `TelaProveedor`):
 *   1. amarre CON color   — `TelaProveedorColor.precio` del proveedor amarrado, si maneja precio por
 *                           color Y hay color en contexto Y ese color tiene precio.
 *   2. amarre             — `TelaProveedor.precio` del proveedor amarrado por Desarrollo.
 *   3. referencia color   — `TelaColor.precio` (SIN proveedor) del color en contexto. Desde
 *                           §Post-F9.11 los colores de tela son HIJOS de la tela: el pegue con el
 *                           color de PRENDA va primero por la liga legacy `idColor` (migradas) y
 *                           luego por NOMBRE — ver {@link resolverPrecioColorReferencia}.
 *   4. sugerido           — `Tela.precioSugerido` (genérico, el de F7). Sin nada ⇒ `null`.
 *
 * CASCADA DEL AVÍO (3 pasos; el precio de compra se NORMALIZA a unidad de consumo dividiendo por el
 * factor de conversión, R1 — se reutiliza `comun/conversion.ts`, NO se duplica la aritmética):
 *   1. amarre     — `AvioProveedor.precio` del proveedor amarrado (÷ su `factorConversion`).
 *   2. más barato — el `AvioProveedor` más barato ya normalizado (regla F4 actual, el fallback).
 *   3. referencia — `Avio.precioReferencia` (fallback sin proveedor mapeable, ADR-0009). Sin nada ⇒ `null`.
 *
 * NOTA de moneda (decisión (d)): todo va en MXN; no hay motor de tipo de cambio (un proveedor en USD
 * se anota en `condiciones`). Estas funciones no redondean: el llamador decide la precisión final al
 * guardar en la columna Decimal (mismo criterio que `comun/conversion.ts`).
 */
import { precioAUnidadConsumo, resolverFactor } from '../../comun/conversion.js';

// ── TELA ──────────────────────────────────────────────────────────────────────

/** De dónde salió el precio de la tela (traza para el renglón de precosto y la review). */
export type OrigenPrecioTela =
  | 'amarre-color'
  | 'amarre'
  | 'color-referencia'
  | 'sugerido'
  | 'sin-precio';

/**
 * Renglón proveedor–tela–precio amarrado por Desarrollo (`ModeloTela.idTelaProveedor` → el
 * `TelaProveedor` elegido). `precioColor` es el precio del COLOR EN CONTEXTO para ese proveedor
 * (`TelaProveedorColor.precio`), ya resuelto por el llamador; `null`/omitido si no aplica.
 */
export interface AmarreTela {
  /** `TelaProveedor.precio` (precio base del proveedor amarrado). Null si el proveedor no lo fija. */
  precio: number | null;
  /** `TelaProveedor.manejaPrecioPorColor`: ¿este proveedor cotiza por color? */
  manejaPrecioPorColor: boolean;
  /** `TelaProveedorColor.precio` del color en contexto para este proveedor (si maneja color). */
  precioColor?: number | null;
}

/** Entrada de la resolución del precio de una TELA (todo ya leído del catálogo por el llamador). */
export interface EntradaPrecioTela {
  /** `Tela.precioSugerido` (genérico, el de F7). El último escalón de la cascada. */
  precioSugerido: number | null;
  /** Amarre elegido por Desarrollo, o `null`/omitido si el BOM no amarró proveedor a esta tela. */
  amarre?: AmarreTela | null;
  /** `TelaColor.precio` del color en contexto (referencia por color SIN proveedor). */
  precioColorReferencia?: number | null;
}

/** Resultado de resolver el precio de una tela. */
export interface PrecioResuelto {
  /** Precio efectivo por unidad de consumo, o `null` si no hay ningún precio en la cascada. */
  precio: number | null;
  /** De qué escalón de la cascada salió. */
  origen: OrigenPrecioTela;
}

/** ¿Es un precio utilizable? (número finito ≥ 0; los `null`/negativos/NaN se saltan). */
function precioUsable(valor: number | null | undefined): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0;
}

/** Un color de TELA (hijo de la tela, §Post-F9.11) para resolver la referencia por color. */
export interface ColorTelaReferencia {
  /** `TelaColor.nombre` (nombre libre del color de esa tela). */
  nombre: string;
  /** `TelaColor.precio` (del cuerpo). */
  precio: number | null;
  /** LEGACY: `TelaColor.idColor` — liga al color de PRENDA de las filas migradas; null en las nuevas. */
  idColor: number | null;
}

/**
 * Resuelve el `precioColorReferencia` (paso 3 de la cascada de la tela) desde los colores
 * HIJOS de la tela, dado el color de PRENDA en contexto. Desde §Post-F9.11 `TelaColor` ya no
 * cuelga del catálogo de prenda, así que el pegue va en DOS pasos:
 *
 *   1. por la LIGA LEGACY `idColor` (filas migradas de F1-E6) — el comportamiento de siempre;
 *   2. si no pega, por NOMBRE (insensible a mayúsculas): el color de tela cuyo nombre coincide
 *      con el del color de prenda en contexto;
 *   3. si tampoco, `null` — y la cascada de {@link resolverPrecioTela} cae al escalón que sigue
 *      (`precioSugerido`), como siempre.
 *
 * Función PURA (el llamador ya leyó los colores de la tela); alimenta el campo
 * `precioColorReferencia` de {@link EntradaPrecioTela} SIN cambiar ninguna firma existente.
 */
export function resolverPrecioColorReferencia(
  coloresTela: readonly ColorTelaReferencia[],
  contexto: { idColor: number; nombre: string },
): number | null {
  // 1. Liga legacy al catálogo de prenda (lo migrado sigue resolviendo como siempre).
  const porLiga = coloresTela.find((c) => c.idColor !== null && c.idColor === contexto.idColor);
  if (porLiga !== undefined && precioUsable(porLiga.precio)) {
    return porLiga.precio;
  }
  // 2. Por nombre (insensible): "Negro" de la tela pega con el color de prenda "NEGRO".
  const clave = contexto.nombre.trim().toLowerCase();
  const porNombre = coloresTela.find((c) => c.nombre.trim().toLowerCase() === clave);
  if (porNombre !== undefined && precioUsable(porNombre.precio)) {
    return porNombre.precio;
  }
  return null;
}

/**
 * Resuelve el precio de una TELA según la cascada de 4 pasos (amarre-color → amarre → referencia por
 * color → sugerido). Devuelve el precio y su ORIGEN; `precio: null` + `origen: 'sin-precio'` cuando
 * la tela no tiene ningún precio capturado en ningún escalón (el llamador decide qué hacer: en el
 * precosteo, un 0 avisado). Es la función que EXTIENDE al pre-costo de F7 cuando el modelo amarra.
 */
export function resolverPrecioTela(entrada: EntradaPrecioTela): PrecioResuelto {
  const amarre = entrada.amarre;
  if (amarre != null) {
    // 1. Amarre CON color: solo si el proveedor amarrado maneja color y ese color tiene precio.
    if (amarre.manejaPrecioPorColor && precioUsable(amarre.precioColor)) {
      return { precio: amarre.precioColor, origen: 'amarre-color' };
    }
    // 2. Amarre (precio base del proveedor amarrado).
    if (precioUsable(amarre.precio)) {
      return { precio: amarre.precio, origen: 'amarre' };
    }
  }
  // 3. Referencia por color sin proveedor (`TelaColor.precio`).
  if (precioUsable(entrada.precioColorReferencia)) {
    return { precio: entrada.precioColorReferencia, origen: 'color-referencia' };
  }
  // 4. Sugerido genérico (`Tela.precioSugerido`, el de F7).
  if (precioUsable(entrada.precioSugerido)) {
    return { precio: entrada.precioSugerido, origen: 'sugerido' };
  }
  return { precio: null, origen: 'sin-precio' };
}

// ── AVÍO ──────────────────────────────────────────────────────────────────────

/** De dónde salió el precio del avío. */
export type OrigenPrecioAvio = 'amarre' | 'mas-barato' | 'referencia' | 'sin-precio';

/** Un proveedor del avío con su precio de compra y su factor de conversión (R1). */
export interface ProveedorAvioPrecio {
  idProveedor: number;
  /** `AvioProveedor.precio` (por presentación de compra). Null si no lo fija. */
  precio: number | null;
  /** `AvioProveedor.factorConversion` (el fino, por proveedor). Null → usa el del avío. */
  factorConversion: number | null;
}

/** Entrada de la resolución del precio de un AVÍO (ya leído del catálogo por el llamador). */
export interface EntradaPrecioAvio {
  /** `Avio.precioReferencia` (fallback sin proveedor, ADR-0009). Ya en unidad de consumo. */
  precioReferencia: number | null;
  /** `Avio.factorConversion` (fallback del avío cuando el proveedor no define el suyo). */
  factorConversionAvio: number | null;
  /** Proveedores del avío con su precio/factor (`AvioProveedor`). */
  proveedores: readonly ProveedorAvioPrecio[];
  /** Proveedor amarrado por Desarrollo (`ModeloAvio.idAvioProveedor`). Null = sin amarre. */
  idAvioProveedor?: number | null;
}

/** Resultado de resolver el precio de un avío (incluye el proveedor elegido, para la traza/E6). */
export interface PrecioAvioResuelto {
  /** Precio efectivo POR UNIDAD DE CONSUMO (ya normalizado por el factor), o `null`. */
  precio: number | null;
  /** De qué escalón salió. */
  origen: OrigenPrecioAvio;
  /** Proveedor cuyo precio se usó (amarre o más barato); `null` si salió de referencia/sin-precio. */
  idProveedor: number | null;
}

/**
 * Costo por unidad de consumo de un renglón de proveedor: `precio ÷ factor` (R1), reutilizando el
 * motor de conversión (`comun/conversion.ts`). `null` si el proveedor no tiene precio usable.
 */
function costoNormalizado(
  proveedor: ProveedorAvioPrecio,
  factorAvio: number | null,
): number | null {
  if (!precioUsable(proveedor.precio)) {
    return null;
  }
  const factor = resolverFactor(proveedor.factorConversion, factorAvio);
  return precioAUnidadConsumo(proveedor.precio, factor);
}

/** De dónde salió el precio de un avío del CATÁLOGO (la cascada + el promedio por medidas). */
export type OrigenPrecioAvioCatalogo = OrigenPrecioAvio | 'promedio-medidas';

/** Resultado de valuar un avío del catálogo (cascada o promedio de medidas). */
export interface PrecioAvioCatalogoResuelto {
  precio: number | null;
  origen: OrigenPrecioAvioCatalogo;
  idProveedor: number | null;
}

/**
 * ⭐ REGLA COMPLETA del precio de un avío del CATÁLOGO — la ÚNICA fuente, compartida por el
 * precosto persistido (`desarrollo/precostos.ts`) y por la RECETA (`modelos/bom-modelo.ts`, que la
 * usa para ENSEÑAR en pantalla exactamente el número con el que se va a costear):
 *
 *  1. avío "POR MEDIDA" (≥1 `AvioMedida` activa, R5/B11) → **promedio simple** de los precios de
 *     sus medidas, SIN proveedor de traza (el precio no salió de un proveedor, decisión Daniel:
 *     protege el costo sin desglosar). Este escalón **gana sobre el amarre**.
 *  2. si no, la cascada amarrada de E1 ({@link resolverPrecioAvio}: amarre → más barato →
 *     referencia), que además dice QUÉ proveedor se usó.
 *
 * Se extrajo aquí (V1-E3c) porque vivía privada en el precosto: la pantalla de la receta la
 * necesitaba y copiarla habría creado dos reglas que derivan. **El comportamiento NO cambia**: es
 * la misma aritmética, y el redondeo lo sigue aplicando el llamador (este módulo no redondea).
 */
export function resolverPrecioAvioCatalogo(
  entrada: EntradaPrecioAvio & { readonly medidas: readonly number[] },
): PrecioAvioCatalogoResuelto {
  if (entrada.medidas.length > 0) {
    const promedio = entrada.medidas.reduce((s, v) => s + v, 0) / entrada.medidas.length;
    return { precio: promedio, origen: 'promedio-medidas', idProveedor: null };
  }
  return resolverPrecioAvio(entrada);
}

/**
 * Resuelve el precio de un AVÍO según la cascada de 3 pasos (amarre → más barato → referencia). El
 * precio de cada proveedor se NORMALIZA a unidad de consumo (÷ factor, R1) antes de comparar/elegir.
 * Si hay amarre pero el proveedor amarrado no tiene precio usable, cae a "más barato" (la regla F4).
 */
export function resolverPrecioAvio(entrada: EntradaPrecioAvio): PrecioAvioResuelto {
  const { proveedores, factorConversionAvio, precioReferencia } = entrada;

  // 1. Amarre: el proveedor elegido por Desarrollo, si existe y tiene precio usable.
  if (entrada.idAvioProveedor != null) {
    const amarrado = proveedores.find((p) => p.idProveedor === entrada.idAvioProveedor);
    if (amarrado !== undefined) {
      const costo = costoNormalizado(amarrado, factorConversionAvio);
      if (costo !== null) {
        return { precio: costo, origen: 'amarre', idProveedor: amarrado.idProveedor };
      }
    }
    // Amarre sin precio usable ⇒ se cae a "más barato" (nunca truena en silencio).
  }

  // 2. Más barato (regla F4): el menor costo normalizado entre los proveedores con precio.
  let mejor: { precio: number; idProveedor: number } | null = null;
  for (const proveedor of proveedores) {
    const costo = costoNormalizado(proveedor, factorConversionAvio);
    if (costo !== null && (mejor === null || costo < mejor.precio)) {
      mejor = { precio: costo, idProveedor: proveedor.idProveedor };
    }
  }
  if (mejor !== null) {
    return { precio: mejor.precio, origen: 'mas-barato', idProveedor: mejor.idProveedor };
  }

  // 3. Referencia (`Avio.precioReferencia`, sin proveedor mapeable).
  if (precioUsable(precioReferencia)) {
    return { precio: precioReferencia, origen: 'referencia', idProveedor: null };
  }

  return { precio: null, origen: 'sin-precio', idProveedor: null };
}
