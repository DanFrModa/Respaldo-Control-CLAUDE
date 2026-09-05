import { describe, expect, it } from 'vitest';

import {
  esquemaConsultaKardexPt,
  RENGLONES_KARDEX_PT_POR_OMISION,
  TOPE_RENGLONES_KARDEX_PT,
} from '../../dominio/inventarios/movimientos-pt.js';
import { esquemaKardexPtQuery } from './movimiento-pt.js';

/**
 * ⭐ EL CONTRATO NO PUEDE ANUNCIAR UN TOPE QUE EL DOMINIO NO ACEPTA (fila 0.138).
 *
 * El tope de renglones del kardex vive DOS veces: como `.max(...)` literal en el querystring del
 * contrato —que es lo que se publica en el OpenAPI y lo que el frontend genera— y como
 * {@link TOPE_RENGLONES_KARDEX_PT} en el dominio, que re-valida lo que la ruta le pasa. Si alguien
 * mueve la constante y no el literal, **el OpenAPI queda falso en silencio**: anuncia un tope que
 * el servicio contesta con un 400, o —peor— esconde uno más alto que sí funciona.
 *
 * No es una hipótesis: es exactamente la clase de defecto que documenta
 * `paginacion-honesta.test.ts` (cinco reincidencias con `porPagina`), y de ahí se toma la técnica.
 *
 * ⚠️ LO IMPORTANTE ES CÓMO SE COMPARA. El tope se **descubre por búsqueda binaria en los dos lados**
 * en vez de afirmarse contra un número escrito aquí. Copiar el literal en la prueba la dejaría
 * pegada al valor viejo el día que alguien mueva uno de los dos — que es justo el día en que tiene
 * que sonar. Y el lado del dominio es el esquema REAL con el que `kardexPt` valida, no uno que se
 * le parezca.
 */

/** Hasta dónde busca: muy por encima de cualquier tope creíble, para delatar un esquema sin `.max()`. */
const TOPE_BUSQUEDA = 100_000;

/** Mayor `n` aceptado. `limite` es monótono (si acepta `n`, acepta `n-1`), así que el corte es único. */
function topeAceptado(acepta: (n: number) => boolean): number {
  let bajo = 1;
  let alto = TOPE_BUSQUEDA;
  if (!acepta(bajo)) return 0;
  while (bajo < alto) {
    const medio = Math.ceil((bajo + alto) / 2);
    if (acepta(medio)) bajo = medio;
    else alto = medio - 1;
  }
  return bajo;
}

const porContrato = (n: number) =>
  esquemaKardexPtQuery.safeParse({ idModelo: 1, limite: n }).success;
const porDominio = (n: number) =>
  esquemaConsultaKardexPt.safeParse({ idModelo: 1, limite: n }).success;

describe('el kardex no anuncia un `limite` que su dominio rechace (fila 0.138)', () => {
  it('⭐ el tope del querystring es EL MISMO que acepta el dominio', () => {
    const delContrato = topeAceptado(porContrato);
    // El corazón del asunto: lo máximo que la API DICE aceptar tiene que ser algo que el servicio
    // efectivamente acepte. Si el contrato promete más, ese renglón de más es un 400.
    expect(porDominio(delContrato)).toBe(true);
    expect(delContrato).toBe(topeAceptado(porDominio));
  });

  it('y ese tope compartido es la constante del dominio (ancla el número UNA vez)', () => {
    expect(topeAceptado(porDominio)).toBe(TOPE_RENGLONES_KARDEX_PT);
  });

  it('⭐ la DESCRIPCIÓN publicada tampoco puede quedarse en el número viejo', () => {
    // El texto viaja al OpenAPI y de ahí a quien lo lea: si dice «1-5000» cuando el tope ya es otro,
    // miente igual que un `.max()` desalineado, y en silencio.
    const descripcion = esquemaKardexPtQuery.shape.limite.description ?? '';
    expect(descripcion).toContain(String(TOPE_RENGLONES_KARDEX_PT));
  });

  it('el valor por omisión lo pone el DOMINIO, no el contrato (A1)', () => {
    // El contrato deja `limite` opcional a propósito: la regla es del dominio. Si el contrato le
    // pusiera un `.default()`, habría dos números por omisión y el de la ruta ganaría en silencio.
    expect(esquemaKardexPtQuery.parse({ idModelo: 1 }).limite).toBeUndefined();
    expect(esquemaConsultaKardexPt.parse({ idModelo: 1 }).limite).toBe(
      RENGLONES_KARDEX_PT_POR_OMISION,
    );
  });
});
