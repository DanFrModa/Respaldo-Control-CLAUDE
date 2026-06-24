/**
 * Conversores de los valores TEXTO del sistema viejo a los tipos de v2 (F1-E6, ETL).
 *
 * Todo en el viejo viene como texto (CSV). Aquí se centralizan las conversiones para que
 * cada loader las use igual y los tests las cubran:
 *  • dinero `"$2.50"`/`"57.00"`/`""` → `number | null` (quita `$`, comas y espacios).
 *  • bandera `"1"`/`"0"`/`""` → `boolean`.
 *  • texto → `string | null` (trim; vacío = null, NUNCA `''`, mismo criterio M1 del dominio).
 *  • entero `"12000"`/`""` → `number | null`.
 *  • nombre normalizado para DEDUP de terceros/telas (no es el del color; ese usa el dominio).
 */

/**
 * Convierte un importe del viejo a número. Acepta `"$2.50"`, `"57.00"`, `"1,234.50"`, `""`,
 * `"$0.00"`. Devuelve `null` cuando no hay valor o no es parseable (el loader decide qué
 * hacer con el `null`). NO redondea: conserva los decimales tal cual.
 *
 * @example parsearDinero("$2.50") === 2.5 ; parsearDinero("") === null
 */
export function parsearDinero(crudo: string | undefined | null): number | null {
  if (crudo === undefined || crudo === null) {
    return null;
  }
  const limpio = crudo.replace(/[$\s,]/g, '').trim();
  if (limpio === '') {
    return null;
  }
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/**
 * Bandera del viejo (`"1"` = sí, cualquier otra cosa = no). El viejo guarda los booleanos
 * como `-1`/`0` o `1`/`0`; aquí se trata como verdadero TODO valor numérico distinto de 0.
 *
 * @example parsearBandera("1") === true ; parsearBandera("0") === false ; parsearBandera("") === false
 */
export function parsearBandera(crudo: string | undefined | null): boolean {
  if (crudo === undefined || crudo === null) {
    return false;
  }
  const t = crudo.trim();
  if (t === '') {
    return false;
  }
  const n = Number(t);
  if (Number.isFinite(n)) {
    return n !== 0;
  }
  return t.toLowerCase() === 'true' || t.toLowerCase() === 'sí' || t.toLowerCase() === 'si';
}

/**
 * Texto del viejo → `string | null`: recorta extremos; vacío = `null` (NUNCA `''`, mismo
 * criterio M1 del dominio). Colapsa los `\r\n` internos (campos multilínea) a `\n` para no
 * arrastrar el `\r` de Windows.
 */
export function parsearTexto(crudo: string | undefined | null): string | null {
  if (crudo === undefined || crudo === null) {
    return null;
  }
  const t = crudo.replace(/\r\n/g, '\n').trim();
  return t === '' ? null : t;
}

/** Entero del viejo → `number | null` (vacío/no numérico = null). Trunca decimales. */
export function parsearEntero(crudo: string | undefined | null): number | null {
  if (crudo === undefined || crudo === null) {
    return null;
  }
  const t = crudo.replace(/[\s,]/g, '').trim();
  if (t === '') {
    return null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Fecha del sistema viejo (Access) → `Date | null`. El formato real de los CSV es
 * `DD/MM/YYYY HH:MM:SS` (verificado: el primer campo es >12 en 7,918 filas y el segundo NUNCA,
 * así que es DÍA/MES, no MES/DÍA). La parte de hora es opcional. Devuelve `null` para vacío o
 * no parseable (el loader decide qué hacer con el `null`; nunca autocorrige una fecha mala).
 *
 * Se construye en UTC a medianoche (para columnas `@db.Date`, la hora se descarta de todas
 * formas) o con la hora dada (para columnas `DateTime` como `fechaCompletada`). Valida rangos
 * básicos (mes 1-12, día 1-31) para no fabricar fechas inventadas a partir de basura.
 *
 * @example parsearFecha("04/01/2005 00:00:00") → 2005-01-04T00:00:00Z
 * @example parsearFecha("") === null
 */
export function parsearFecha(crudo: string | undefined | null): Date | null {
  if (crudo === undefined || crudo === null) {
    return null;
  }
  const t = crudo.trim();
  if (t === '') {
    return null;
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2}):(\d{1,2}))?$/.exec(t);
  if (m === null) {
    return null;
  }
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const anio = Number(m[3]);
  const hora = m[4] === undefined ? 0 : Number(m[4]);
  const min = m[5] === undefined ? 0 : Number(m[5]);
  const seg = m[6] === undefined ? 0 : Number(m[6]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
    return null;
  }
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, hora, min, seg));
  // Rechaza fechas que se "desbordaron" (p. ej. 31/02 → 03/03): no son la fecha capturada.
  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    return null;
  }
  return fecha;
}

/**
 * Fecha del viejo → `Date | null` a MEDIANOCHE UTC (para columnas `@db.Date`: día puro, sin
 * hora). Igual que {@link parsearFecha} pero descarta la parte de hora. Lo usan los loaders de
 * Pedido/Orden para las columnas date-only (FechaPedido, Fecha, FechaEntrega…).
 */
export function parsearFechaSoloDia(crudo: string | undefined | null): Date | null {
  const fecha = parsearFecha(crudo);
  if (fecha === null) {
    return null;
  }
  return new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), 0, 0, 0),
  );
}

/** Rango Unicode de marcas diacríticas combinantes (acentos, diéresis…) tras `normalize('NFD')`. */
const REGEX_DIACRITICOS = /[̀-ͯ]/g;

/**
 * Normaliza un nombre para DEDUP de terceros (Maquilero/Estampador/Cortador → Proveedor) y
 * de telas (Telas/TelasDis → Tela): minúsculas, sin acentos, colapsa espacios, recorta. NO
 * se persiste — solo sirve para comparar "el mismo de antes" entre fuentes. Es DISTINTO del
 * nombre canónico de color (ese lo da `normalizarNombreColor` del dominio).
 *
 * @example normalizarParaDedup("  José  Pérez ") === "jose perez"
 */
export function normalizarParaDedup(nombre: string | undefined | null): string {
  if (nombre === undefined || nombre === null) {
    return '';
  }
  return nombre
    .normalize('NFD')
    .replace(REGEX_DIACRITICOS, '') // quita diacríticos (Combining Diacritical Marks U+0300–U+036F)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
