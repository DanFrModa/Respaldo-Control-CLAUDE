/**
 * EL PERIODO DE UN KARDEX, lado CONTRATO (fila 0.138 en producto terminado, 0.173 en materiales).
 *
 * Los cuatro kardex —producto terminado, tela por color, tela por lote y avíos— se piden con los
 * MISMOS tres parámetros y contestan con los MISMOS cinco campos de encabezado. Aquí viven una sola
 * vez, para que el OpenAPI publique la misma forma en los cuatro y para que el tope tenga un solo
 * literal en todo el contrato.
 *
 * ⚠️ El tope existe DOS veces en el repo: este `.max(...)` (lo que la API DICE aceptar) y
 * `TOPE_RENGLONES_KARDEX` en el dominio (lo que de verdad acepta). Si alguien mueve uno y no el
 * otro, **el OpenAPI queda falso en silencio**. Lo cruza mecánicamente
 * `contrato/esquemas/tope-kardex-honesto.test.ts`, que descubre el tope de los dos lados por
 * búsqueda binaria en vez de copiar el número. La capa de contrato NO importa del dominio (es la
 * frontera), y por eso el cruce es una prueba y no un import.
 *
 * A1 — el `limite` va OPCIONAL a propósito: el valor por omisión lo pone el dominio. Si el contrato
 * le pusiera un `.default()` habría dos números por omisión y ganaría el de la ruta en silencio.
 */
import { z } from 'zod';

/** Tope DURO de renglones que la API anuncia. Debe coincidir con el del dominio (ver cabecera). */
const TOPE_RENGLONES_PUBLICADO = 5000;

/** Los tres parámetros del periodo (querystring), para pegarlos a los filtros propios de cada kardex. */
export const camposPeriodoKardexQuery = {
  desde: z.iso
    .date({ error: 'La fecha «desde» no es válida (YYYY-MM-DD)' })
    .optional()
    .describe('Primer día del periodo (YYYY-MM-DD), INCLUSIVE.'),
  hasta: z.iso
    .date({ error: 'La fecha «hasta» no es válida (YYYY-MM-DD)' })
    .optional()
    .describe('Último día del periodo (YYYY-MM-DD), INCLUSIVE.'),
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(TOPE_RENGLONES_PUBLICADO)
    .optional()
    .describe(
      `Tope de renglones a devolver (1-${String(TOPE_RENGLONES_PUBLICADO)}). Si se omite manda el ` +
        'del dominio; la respuesta siempre dice cuál se aplicó (`limite`) y si hubo corte (`truncado`).',
    ),
};

/** La misma frase para los cuatro: qué significa que el kardex tenga periodo. */
export const DESCRIPCION_FILTROS_PERIODO =
  'El PERIODO manda: si no se pide `desde`, el dominio pone una ventana por omisión (ver ' +
  '`desde`/`ventanaPorOmision` de la respuesta) — pedir el kardex NUNCA trae diez años.';

/**
 * Los cinco campos de encabezado que TODO kardex con periodo devuelve: qué pedazo se está viendo y
 * si se quedó algo fuera. Sin ellos la pantalla no puede ser honesta, que es la mitad de la cura.
 */
export const camposPeriodoKardexRespuesta = {
  desde: z.string().describe('Primer día del periodo que SÍ se consultó (YYYY-MM-DD, inclusive).'),
  hasta: z
    .string()
    .nullable()
    .describe('Último día del periodo (YYYY-MM-DD, inclusive), o null si no se puso tope.'),
  ventanaPorOmision: z
    .boolean()
    .describe('true cuando `desde` lo puso el dominio porque nadie pidió periodo.'),
  limite: z.number().int().describe('Tope de renglones que se aplicó.'),
  truncado: z
    .boolean()
    .describe(
      'true si el periodo tiene MÁS movimientos de los que caben en `limite`. Cuando corta, lo ' +
        'que se devuelve son los MÁS RECIENTES del periodo (el principio es lo que se pierde).',
    ),
};

/**
 * La frase del SALDO ANTERIOR, idéntica en los cuatro: es lo que vuelve verdadera la columna
 * «Saldo» cuando el kardex viene recortado. Sin él, el primer renglón arrancaría en cero y el saldo
 * corrido diría una mentira creíble.
 *
 * Cuando `truncado` es `false` ese punto es el inicio del periodo, así que es el saldo de apertura
 * de toda la vida. Cuando es `true` la lista trae el FINAL del periodo y el número ya incluye
 * también los movimientos que el tope dejó fuera por arriba: sigue siendo exacto.
 */
export const DESCRIPCION_SALDO_ANTERIOR =
  'Saldo del artículo justo ANTES del primer renglón devuelto (que es el inicio del periodo sólo ' +
  'cuando `truncado` es false).';
