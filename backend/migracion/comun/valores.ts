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
