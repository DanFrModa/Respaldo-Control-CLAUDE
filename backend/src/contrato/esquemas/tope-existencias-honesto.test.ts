import { describe, expect, it } from 'vitest';

import {
  esquemaConsultaExistenciasPt,
  RENGLONES_EXISTENCIAS_PT_POR_OMISION,
  TOPE_RENGLONES_EXISTENCIAS_PT,
} from '../../dominio/inventarios/movimientos-pt.js';
import { esquemaExistenciasPtQuery } from './movimiento-pt.js';

/**
 * ⭐ EL CONTRATO NO PUEDE ANUNCIAR UN TOPE QUE EL DOMINIO NO ACEPTA — existencias de PT (fila 0.143).
 *
 * Mismo pecado, misma técnica y mismo remedio que `tope-kardex-honesto.test.ts` (fila 0.138/0.173) y
 * que `paginacion-honesta.test.ts` (fila 0.083, cinco reincidencias con `porPagina`): el tope vive
 * DOS veces —como `.max(...)` en el querystring publicado, que es lo que se genera al OpenAPI y de
 * ahí al cliente del frontend, y como {@link TOPE_RENGLONES_EXISTENCIAS_PT} en el dominio, que
 * re-valida lo que la ruta le pasa—. Si alguien mueve la constante y no el literal, **el OpenAPI
 * queda falso en silencio**: promete un renglón de más que en realidad es un 400, o esconde un tope
 * más alto que sí funciona.
 *
 * ⚠️ VA EN ARCHIVO PROPIO, y no como una quinta fila de `tope-kardex-honesto.test.ts`, porque
 * aquella tabla cruza además el PERIODO (`desde`/`hasta`/`ventanaPorOmision`) y las existencias **no
 * tienen periodo**: una existencia es un saldo, no un suceso. Meterlas ahí obligaría a llenar de
 * excepciones una tabla cuyo valor es que todas sus filas se midan igual.
 *
 * ⚠️ LO IMPORTANTE ES CÓMO SE COMPARA. El tope se **descubre por búsqueda binaria en los dos lados**
 * en vez de afirmarse contra un número escrito aquí: copiar el literal dejaría la prueba pegada al
 * valor viejo el día que alguien mueva uno de los dos — que es justo el día en que tiene que sonar.
 * Y el lado del dominio es el esquema REAL con el que la función valida (por eso se exporta), no uno
 * que se le parezca: comparar contra un intermediario «equivalente» ya produjo un guardián ciego.
 */

/** Hasta dónde busca: muy por encima de cualquier tope creíble, para delatar un esquema sin `.max()`. */
const TOPE_BUSQUEDA = 100_000;

/**
 * Mayor `n` aceptado. `limite` es monótono (si acepta `n`, acepta `n-1`), así que el corte es único.
 * Se copia de sus dos hermanas a propósito: hoy no existe un módulo de utilidades compartido entre
 * pruebas del contrato, y crearlo es una decisión aparte de esta fila.
 */
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

describe('las existencias de PT no anuncian un `limite` que su dominio rechace (0.143)', () => {
  const porContrato = (n: number): boolean =>
    esquemaExistenciasPtQuery.safeParse({ limite: n }).success;
  const porDominio = (n: number): boolean =>
    esquemaConsultaExistenciasPt.safeParse({ limite: n }).success;

  it('⭐ el tope del querystring es EL MISMO que acepta el dominio', () => {
    const delContrato = topeAceptado(porContrato);
    // El corazón del asunto: lo máximo que la API DICE aceptar tiene que ser algo que el servicio
    // efectivamente acepte. Si el contrato promete más, ese renglón de más es un 400.
    expect(porDominio(delContrato)).toBe(true);
    expect(delContrato).toBe(topeAceptado(porDominio));
  });

  it('y ese tope compartido es la constante del dominio (ancla el número UNA vez)', () => {
    expect(topeAceptado(porDominio)).toBe(TOPE_RENGLONES_EXISTENCIAS_PT);
  });

  it('⭐ la DESCRIPCIÓN publicada tampoco puede quedarse en el número viejo', () => {
    // El texto viaja al OpenAPI y de ahí a quien lo lea: si dice «1-5000» cuando el tope ya es
    // otro, miente igual que un `.max()` desalineado, y en silencio.
    const descripcion = esquemaExistenciasPtQuery.shape.limite.description ?? '';
    expect(descripcion).toContain(String(TOPE_RENGLONES_EXISTENCIAS_PT));
  });

  it('el valor por omisión lo pone el DOMINIO, no el contrato (A1)', () => {
    // El contrato deja `limite` opcional a propósito: la regla es del dominio. Si el contrato le
    // pusiera un `.default()`, habría dos números por omisión y el de la ruta ganaría en silencio.
    expect(esquemaExistenciasPtQuery.parse({}).limite).toBeUndefined();
    expect(esquemaConsultaExistenciasPt.parse({}).limite).toBe(
      RENGLONES_EXISTENCIAS_PT_POR_OMISION,
    );
  });

  it('⭐ y NO existe una consulta de existencias sin tope: el `limite` es obligatorio de facto', () => {
    // La cura de la fila 0.143 es que pedir existencias sin `limite` YA no traiga la vista entera.
    // Si alguien quitara el `.default()` del dominio, `limite` saldría `undefined` y el `LIMIT` de
    // la consulta se quedaría sin número: esto lo caza sin necesidad de base de datos.
    const salida = esquemaConsultaExistenciasPt.parse({});
    expect(typeof salida.limite).toBe('number');
    expect(salida.limite).toBeGreaterThan(0);
    expect(salida.limite).toBeLessThanOrEqual(TOPE_RENGLONES_EXISTENCIAS_PT);
  });

  it('el tope duro no se puede sobrepasar pidiéndolo (ni por el contrato ni por el dominio)', () => {
    const unoDeMas = TOPE_RENGLONES_EXISTENCIAS_PT + 1;
    expect(porContrato(unoDeMas)).toBe(false);
    expect(porDominio(unoDeMas)).toBe(false);
    expect(porContrato(0)).toBe(false);
    expect(porDominio(0)).toBe(false);
  });

  it('el querystring lo recibe como TEXTO, y el contrato lo coacciona (si no, todo `limite` es un 400)', () => {
    // Un querystring nunca trae números: llega `?limite=250`. Sin el `z.coerce`, el esquema
    // rechazaría cualquier petición que use el parámetro — y el tope quedaría inalcanzable en la
    // práctica sin que ninguna otra prueba se enterara (las de arriba interrogan con `number`).
    const coaccionado = esquemaExistenciasPtQuery.safeParse({ limite: '250' });
    expect(coaccionado.success).toBe(true);
    expect(coaccionado.success && coaccionado.data.limite).toBe(250);
    // Y el techo se sigue respetando en su forma de texto.
    expect(
      esquemaExistenciasPtQuery.safeParse({
        limite: String(TOPE_RENGLONES_EXISTENCIAS_PT + 1),
      }).success,
    ).toBe(false);
  });
});
