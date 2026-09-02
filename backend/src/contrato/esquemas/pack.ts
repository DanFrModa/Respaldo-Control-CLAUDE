/**
 * EL PACK / TENDIDO — pieza compartida del contrato (§Post-F9.10, decisión de Daniel del
 * 6-ago-2026, arrancada el 2-sep-2026).
 *
 * 🔴 EL PROBLEMA, con las palabras de Daniel: C&A pide VARIOS TENDIDOS en una misma OP — el pack A
 * con corrida 1-2-2-1 (CH-M-G-EG), el pack B con 1-1-1-2. Hasta hoy eso se resolvía metiendo la
 * letra DENTRO del nombre del color («Negro A», «Negro B»), fabricando un color de catálogo por
 * pack: *«Me gusta que exista **un solo Negro** y no esté fragmentado en miles de colores escritos
 * de diferente manera.»*
 *
 * La primera mitad ya se construyó (V1-E8g / §Post-F9.129: el importador de PDF dejó de componer el
 * color con la letra). Ésta es la segunda: **el pack como CAMPO PROPIO que viaja con la pieza.**
 *
 * ⭐ HASTA DÓNDE VIAJA — textual de Daniel, y es la especificación:
 *   *«Creo que sí es importante que viaje el pack **al menos en el corte, entrega a maquila**… y que
 *   sea **opcional al recibir**.»*
 *
 * | Etapa                                   | El pack…                                             |
 * |-----------------------------------------|------------------------------------------------------|
 * | Matriz de la OP                         | OBLIGATORIO cuando la orden trae packs (color × pack) |
 * | Corte                                   | OBLIGATORIO (cada tendido es de un pack)             |
 * | Entrega a maquila                       | OBLIGATORIO                                          |
 * | Recibo de maquila                       | ⭐ OPCIONAL (el maquilero pudo devolverlos revueltos) |
 * | Arte · entrega a cliente · inventario PT| NO APLICA — ahí ya es sólo color                     |
 *
 * 🔑 EL VACÍO ES EL «SIN PACK», y no hay `null` en ninguna capa: la columna es `text NOT NULL
 * DEFAULT ''` porque el pack entra en llaves `@@unique` y en Postgres dos NULL no chocan (la
 * unicidad «un renglón por color» se habría evaporado justo para el caso normal). Que el contrato
 * hable el MISMO idioma que la tabla evita el mapeo `null ↔ ''`, que es donde se esconden los
 * defectos. La ENTRADA acepta que el campo venga AUSENTE (`undefined`) —el contrato NO lo rellena,
 * lo deja pasar— y quien lo colapsa a `''` es el DOMINIO, en su frontera (`normalizarPack`), que es
 * el único sitio donde `undefined`, `null` y `'  '` tienen que volverse la misma cosa.
 */
import { z } from 'zod';

/** Largo máximo de la etiqueta de un pack: una letra o un rótulo corto («A», «B», «PACK 1»). */
export const LARGO_MAX_PACK = 12;

/**
 * El pack tal como ENTRA por el API: OPCIONAL y recortado; ausente o vacío significa «sin pack».
 *
 * 🔑 Es `.optional()` y no `.default('')` a propósito (REGLA 0-B, *«¿funciona bien cuando el dato NO
 * está?»*): así **todo cuerpo escrito antes de §Post-F9.10 sigue siendo válido tal cual**, y ningún
 * llamador —ni el frontend, ni el ETL, ni una prueba— tiene que aprender un campo que no le importa.
 * El dominio lo normaliza con `normalizarPack()` en su frontera, que es el único sitio donde
 * `undefined`, `null` y `'  '` tienen que colapsar a la misma cosa.
 */
export const esquemaPackEntrada = z
  .string()
  .trim()
  .max(LARGO_MAX_PACK, { error: `El pack no puede pasar de ${LARGO_MAX_PACK} caracteres` })
  .optional();

/** El pack tal como SALE por el API: siempre string; cadena vacía = sin pack. */
export const esquemaPackSalida = z
  .string()
  .describe('PACK / TENDIDO (§Post-F9.10). CADENA VACÍA = sin pack.');
