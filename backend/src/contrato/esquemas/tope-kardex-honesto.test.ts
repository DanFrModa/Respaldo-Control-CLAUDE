import { describe, expect, it } from 'vitest';

import { esquemaConsultaKardexAvio } from '../../dominio/inventarios/avios.js';
import { esquemaConsultaKardexPt } from '../../dominio/inventarios/movimientos-pt.js';
import { esquemaConsultaKardexTelaColor } from '../../dominio/inventarios/partidas-telas.js';
import {
  RENGLONES_KARDEX_POR_OMISION,
  TOPE_RENGLONES_KARDEX,
} from '../../dominio/inventarios/periodo-kardex.js';
import { esquemaConsultaKardexTela } from '../../dominio/inventarios/telas.js';
import {
  esquemaKardexAvioQuery,
  esquemaKardexTelaColorQuery,
  esquemaKardexTelaQuery,
} from './inventario-material.js';
import { esquemaKardexPtQuery } from './movimiento-pt.js';

/**
 * ⭐ EL CONTRATO NO PUEDE ANUNCIAR UN TOPE QUE EL DOMINIO NO ACEPTA (fila 0.138; extendido a los
 * CUATRO kardex en la 0.173).
 *
 * El tope de renglones vive DOS veces: como `.max(...)` en el querystring del contrato —que es lo
 * que se publica en el OpenAPI y lo que el frontend genera— y como {@link TOPE_RENGLONES_KARDEX} en
 * el dominio, que re-valida lo que la ruta le pasa. Si alguien mueve la constante y no el literal,
 * **el OpenAPI queda falso en silencio**: anuncia un tope que el servicio contesta con un 400, o
 * —peor— esconde uno más alto que sí funciona.
 *
 * No es una hipótesis: es exactamente la clase de defecto que documenta
 * `paginacion-honesta.test.ts` (cinco reincidencias con `porPagina`), y de ahí se toma la técnica.
 *
 * ⚠️ LO IMPORTANTE ES CÓMO SE COMPARA. El tope se **descubre por búsqueda binaria en los dos lados**
 * en vez de afirmarse contra un número escrito aquí. Copiar el literal en la prueba la dejaría
 * pegada al valor viejo el día que alguien mueva uno de los dos — que es justo el día en que tiene
 * que sonar. Y el lado del dominio es el esquema REAL con el que la función valida, no uno que se
 * le parezca.
 *
 * ⭐⭐ Y POR QUÉ SON CUATRO Y NO UNO (fila 0.173). Los cuatro kardex comparten mecanismo, pero cada
 * uno tiene su querystring publicado. Recorrerlos en una tabla es lo que hace que añadir un quinto
 * kardex sin su cruce sea imposible de olvidar: se agrega la fila y la prueba lo mide sola.
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

/** Los cuatro kardex con periodo: su querystring publicado y el esquema con el que valida su dominio. */
const KARDEX = [
  {
    nombre: 'producto terminado',
    query: esquemaKardexPtQuery,
    // El identificador obligatorio de cada kardex: sin él, el esquema rechaza por otra razón y la
    // búsqueda binaria mediría el campo equivocado.
    minimo: { idModelo: 1 },
    dominio: esquemaConsultaKardexPt,
  },
  {
    nombre: 'tela por lote (legado)',
    query: esquemaKardexTelaQuery,
    minimo: { idTela: 1 },
    dominio: esquemaConsultaKardexTela,
  },
  {
    nombre: 'tela por color',
    query: esquemaKardexTelaColorQuery,
    minimo: { idTelaColor: 1 },
    dominio: esquemaConsultaKardexTelaColor,
  },
  {
    nombre: 'avíos',
    query: esquemaKardexAvioQuery,
    minimo: { idAvio: 1 },
    dominio: esquemaConsultaKardexAvio,
  },
] as const;

describe.each(KARDEX)(
  'el kardex de $nombre no anuncia un `limite` que su dominio rechace (0.138 / 0.173)',
  ({ query, minimo, dominio }) => {
    const porContrato = (n: number): boolean => query.safeParse({ ...minimo, limite: n }).success;
    const porDominio = (n: number): boolean => dominio.safeParse({ ...minimo, limite: n }).success;

    it('⭐ el tope del querystring es EL MISMO que acepta el dominio', () => {
      const delContrato = topeAceptado(porContrato);
      // El corazón del asunto: lo máximo que la API DICE aceptar tiene que ser algo que el servicio
      // efectivamente acepte. Si el contrato promete más, ese renglón de más es un 400.
      expect(porDominio(delContrato)).toBe(true);
      expect(delContrato).toBe(topeAceptado(porDominio));
    });

    it('y ese tope compartido es la constante del dominio (ancla el número UNA vez)', () => {
      expect(topeAceptado(porDominio)).toBe(TOPE_RENGLONES_KARDEX);
    });

    it('⭐ la DESCRIPCIÓN publicada tampoco puede quedarse en el número viejo', () => {
      // El texto viaja al OpenAPI y de ahí a quien lo lea: si dice «1-5000» cuando el tope ya es
      // otro, miente igual que un `.max()` desalineado, y en silencio.
      const descripcion = query.shape.limite.description ?? '';
      expect(descripcion).toContain(String(TOPE_RENGLONES_KARDEX));
    });

    it('el valor por omisión lo pone el DOMINIO, no el contrato (A1)', () => {
      // El contrato deja `limite` opcional a propósito: la regla es del dominio. Si el contrato le
      // pusiera un `.default()`, habría dos números por omisión y el de la ruta ganaría en silencio.
      expect(query.parse({ ...minimo }).limite).toBeUndefined();
      expect(dominio.parse({ ...minimo }).limite).toBe(RENGLONES_KARDEX_POR_OMISION);
    });

    it('⭐ y el PERIODO al revés lo rechaza el dominio en los cuatro', () => {
      // La guarda del rango invertido vive una sola vez (`periodoAlDerecho`); esto fija que de
      // verdad esté colgada de los cuatro esquemas y no sólo del primero que se escribió.
      expect(
        dominio.safeParse({ ...minimo, desde: '2026-09-01', hasta: '2026-08-01' }).success,
      ).toBe(false);
      expect(
        dominio.safeParse({ ...minimo, desde: '2026-08-01', hasta: '2026-09-01' }).success,
      ).toBe(true);
    });
  },
);
