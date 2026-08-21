/**
 * ESCALA CANÓNICA DEL ORDEN DE LAS TALLAS (V1-E3r, §Post-F9.81).
 *
 * `Talla.orden` es `Int @default(0)` y el ETL **nunca lo escribió** (`migracion/loaders/tallas.ts`
 * llama a `crearTalla(sesion, { etiqueta })` sin `orden`), así que las 94 tallas migradas del
 * Access valen 0 y el desempate cae en la etiqueta: *CH, G, M, XG* en vez de *CH, M, G, XG*. Este
 * módulo es la mitad que **tapa el hueco** — deducir el orden de la etiqueta cuando nadie lo da —;
 * la otra mitad (reparar lo ya cargado) vive en el seed.
 *
 * 🔴 **La escala NO se inventó: se MIDIÓ** sobre `Respaldo CLAUDE/TABLAS/Ordenes.csv` (columna
 * `Tallas`, ancho fijo de 2, CP850). ⭐ **Y la medición se RE-CORRE, no se re-cita:** vive en
 * `migracion/analisis/medicion-orden-de-tallas.ts` y usa el parser del propio ETL
 * (`migracion/comun/tallas.ts`), así que cada cifra de aquí abajo se vuelve a sacar con un comando.
 * *(Esta última frase la costó una ronda de corrección: las cifras publicadas a mano no cuadraban, y
 * el módulo llegó a contradecir a su propia prueba con el conteo de `2-3-3X`.)*
 *
 * **El universo:** 5,451 renglones → 5,450 con `Tallas` → menos **67 órdenes** cuyas 17 cadenas el
 * parser del ETL marca **raras** (dos curvas pegadas con `--`, saltos de línea, longitud impar; el
 * loader nunca las cargó) = **5,383 órdenes**, con **101 etiquetas distintas** contando la caja → las
 * **94 filas `Talla`** reales (el ETL dedupe sin distinguir mayúsculas), en **161 combinaciones**.
 * ⚠️ 161 y no 164: contando la CAJA salen 164, pero `ch-m-g-eg` y `CH-M-G-EG` no crearon curvas
 * aparte (el loader busca la curva con `mode: 'insensitive'`).
 *
 * Tres hallazgos mandaron el diseño, y los tres son contraintuitivos:
 *
 *  1. **Los NÚMEROS van ANTES que las LETRAS.** De las combinaciones que mezclan las dos familias y
 *     la escala reconoce enteras, **15 van número→letra** (309 órdenes: `2-3-3X`,
 *     `12-14-16-CH-M-G-EX-2X`…) contra **1 sola al revés** (`CH-M-G-EX-38-42`, 2 órdenes). Contando
 *     también las que traen alguna etiqueta sucia son 19 / 333 contra la misma 1 / 2: el veredicto no
 *     depende de dónde se corte. Por eso las letras arrancan en {@link BASE_LETRAS}, por encima de
 *     todo el rango numérico.
 *  2. **Los MESES y los AÑOS caen en la MISMA escala numérica**, convertidos a meses. Es lo que
 *     hace que `3M-6M-9M-12-18-2A-3A` (57 órdenes) salga bien con la MISMA regla que
 *     `4-6-8-10-12-14-16-18` (22 órdenes): en la primera el `12` y el `18` YA son meses, y `2A`/`3A`
 *     son 24 y 36.
 *  3. **`3X` es una LETRA**, no un número — y eso es justo lo que la hace acertar en las **dos**
 *     familias donde vive: entre puros números (`2-3-3X`, 252 órdenes) queda al final porque las
 *     letras van después; entre letras (`CH-M-G-EX-2X-3X`, 17 órdenes; 57 en total sumando las
 *     curvas de puras letras que la traen) queda donde le toca en la escalera. Leerla como "3" la
 *     habría mandado al principio de la primera y al medio de la nada en la segunda.
 *
 * **Resultado medido de la escala completa contra las 161 combinaciones reales:** 130 combinaciones
 * (5,311 órdenes = **98.7 %** del universo) quedan MONÓTONAS; 26 combinaciones / 58 órdenes traen
 * alguna etiqueta que la escala no reconoce (`UT`, `MC`, `M.`, `G'`… data sucia del viejo, más el
 * separador suelto de las cadenas que son dos curvas pegadas); y 5 combinaciones / 14 órdenes las
 * desordena — **3** de ellas por traer la misma talla repetida (`EX-CH-M-G-EX`, `CH-M-G-EX-CH-M-G-EG`,
 * `M-G-EX-2X-3X-XC-CH-M`: no hay orden posible, la cadena está mal) y quedan 2 fallas de diseño
 * reales, `CH-M-G-EX-38-42` (2 órdenes) y `G-EX-2X-3X-M` (1 orden).
 *
 * ⚠️ **Lo que NO reconoce se queda en 0** — {@link deducirOrdenTalla} devuelve `null` y el llamador
 * deja el sentinela. Inventarle una posición a una etiqueta que nadie entiende sería afirmar algo
 * que no se sabe; con 0 sigue desempatando por etiqueta, exactamente como hoy.
 */

/**
 * Piso de la familia de LETRAS. Todo lo numérico vive por debajo (1…999 = talla, o meses de edad),
 * así que **cualquier** número queda antes que **cualquier** letra — el hallazgo (1) de la medición.
 */
export const BASE_LETRAS = 1000;

/**
 * ESCALERA de las etiquetas de letra, medida de las combinaciones reales. Los empates son
 * DELIBERADOS: son etiquetas que significan lo mismo en dos nomenclaturas que **nunca conviven** en
 * una misma curva del volcado — la internacional (`XS-S-M-L-XL`) y la española (`XC-CH-M-G-EX`) —,
 * así que `G` y `L` pueden compartir peldaño sin que ninguna curva salga mal.
 *
 * Los peldaños van de 10 en 10 para poder meter una etiqueta nueva en medio sin re-numerar.
 */
const ESCALERA_LETRAS: Readonly<Record<string, number>> = {
  '3C': 10, // tres chicos (no aparece en el volcado; queda por simetría con 2C)
  '2C': 20, // 2C-XC-CH-M-G-EX-2X-3X
  XS: 30,
  XC: 30, // extra chico ≡ extra small
  EC: 30, // "extra chico" escrito con E (EC-CH-M-G-EX, 35 órdenes)
  S: 40,
  CH: 40, // chico ≡ small
  P: 40, // pequeño
  M: 50, // el único peldaño que las dos nomenclaturas escriben igual
  L: 60,
  G: 60, // grande ≡ large
  XL: 70,
  XG: 70, // extra grande
  EX: 70, // "extra" (la más usada del volcado: 2,854 órdenes)
  EG: 70, // extra grande escrito con E
  X: 70, // suelta, en 12-14-16-X
  '0X': 80, // 0X-1X-2X-3X
  '1X': 90, // XL-1X-2X-3X ⇒ va DESPUÉS de XL
  '2X': 100,
  '2G': 100, // XC-CH-M-G-XG-2G ⇒ mismo peldaño que 2X
  XX: 100,
  '3X': 110,
  '3G': 110,
  '4X': 120,
  '5X': 130,
  '6X': 140,
};

/** Rango aceptable del tramo numérico: 0 es el sentinela y por arriba empiezan las letras. */
const MIN_NUMERICO = 1;
const MAX_NUMERICO = BASE_LETRAS - 1;

/**
 * Deduce el `orden` canónico de una etiqueta de talla, o `null` si la escala no la reconoce.
 *
 * Tres familias, en este orden de comprobación:
 *
 *  • **Número puro** (`4`, `12`, `78`, `01`) → su propio valor. Cubre tanto la talla infantil/adulta
 *    numérica como los meses de la curva de bebé (`6-12-18`).
 *  • **Meses / años** (`6M`, `2A`) → meses: `6M`→6, `2A`→24. Es lo que mete la curva de bebé en la
 *    MISMA recta que la numérica (hallazgo 2).
 *  • **Letra de la escalera** → {@link BASE_LETRAS} + su peldaño, siempre por encima de los números.
 *
 * ⚠️ El orden de las tres comprobaciones **no es load-bearing**: las tres familias son DISJUNTAS por
 * construcción (los patrones numéricos exigen la cadena completa con `fullmatch`, y ninguna clave de
 * la escalera casa con ellos), así que a lo sumo una puede acertar. Se escriben en este orden porque
 * es el que se lee mejor, no porque una tape a la otra.
 *
 * @param etiqueta Etiqueta tal como se captura (`"CH"`, `"3x"`, `" 12 "`). Se recorta y se sube a
 *   mayúsculas antes de comparar: el catálogo ya es único sin distinguir mayúsculas.
 * @returns El orden deducido (≥1), o `null` cuando la etiqueta no cae en ninguna familia conocida.
 */
export function deducirOrdenTalla(etiqueta: string): number | null {
  const clave = etiqueta.trim().toUpperCase();
  if (clave === '') {
    return null;
  }

  const numero = /^\d{1,3}$/.exec(clave);
  if (numero !== null) {
    const valor = Number(clave);
    return valor >= MIN_NUMERICO && valor <= MAX_NUMERICO ? valor : null;
  }

  const meses = /^(\d{1,2})M$/.exec(clave);
  if (meses !== null) {
    const valor = Number(meses[1]);
    return valor >= MIN_NUMERICO ? valor : null;
  }

  const anios = /^(\d{1,2})A$/.exec(clave);
  if (anios !== null) {
    const valor = Number(anios[1]) * 12;
    return valor >= MIN_NUMERICO && valor <= MAX_NUMERICO ? valor : null;
  }

  const peldano = ESCALERA_LETRAS[clave];
  return peldano === undefined ? null : BASE_LETRAS + peldano;
}
