/**
 * EL PACK / TENDIDO — aritmética del módulo (§Post-F9.10, decisión de Daniel del 6-ago-2026,
 * arrancada el 2-sep-2026). Módulo PURO: no toca BD, no sabe de Prisma. Aquí vive lo que hay que
 * poder probar sin levantar nada.
 *
 * 🔴 EL PROBLEMA, con las palabras de Daniel: C&A pide VARIOS TENDIDOS en una misma OP — el pack A
 * con corrida 1-2-2-1 (CH-M-G-EG), el pack B con 1-1-1-2. Antes la letra iba DENTRO del nombre del
 * color («Negro A», «Negro B»): *«Me gusta que exista **un solo Negro** y no esté fragmentado en
 * miles de colores escritos de diferente manera.»* Desde §Post-F9.10 el pack es CAMPO PROPIO.
 *
 * ⭐ HASTA DÓNDE VIAJA — textual de Daniel: *«Creo que sí es importante que viaje el pack **al menos
 * en el corte, entrega a maquila**… y que sea **opcional al recibir**.»*
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════════
 * ⭐⭐ LA PARTE DIFÍCIL, Y LA RESOLVIÓ DANIEL — {@link excesosDelRecibo}
 * ═════════════════════════════════════════════════════════════════════════════════════════════════
 * *«Con el recibo opcional, el saldo «recibido ≤ enviado» **no puede llevarse sólo por pack**. Un
 * recibo **SIN pack** consume del saldo **agregado de todos los packs** de esa orden y proceso; uno
 * **CON pack**, del suyo. Hay que **definir (y probar)** que las dos formas convivan **sin permitir
 * recibir de más en total**.»*
 *
 * Traducido a la invariante que este módulo implementa, para una orden+proceso+maquilero fijos y una
 * celda color×talla, con `E[p]` = enviado del pack p, `R[p]` = ya devuelto CON pack p y `R[·]` = ya
 * devuelto SIN pack:
 *
 *   (1) TOTAL   Σ R[p] + R[·]  ≤  Σ E[p]        ← el que impide recibir de más EN TOTAL
 *   (2) POR PACK       R[p]    ≤    E[p]  ∀p    ← el que impide recibir de más DE UN PACK
 *
 * 🔑 **Ninguna de las dos implica a la otra**, y por eso van las dos:
 *   • sin (1): recibo 5 del pack A (ok) + 5 del B (ok) + 5 sin pack ⇒ 15 devueltas de 10 enviadas;
 *   • sin (2): recibo 10 con pack A cuando sólo se enviaron 5 de A ⇒ el total cuadra y el pack no.
 *
 * 🔑 **Y por qué esto encaja con lo que YA existía**: la guarda de hoy (`recibos.ts`, decisión (g))
 * suma las celdas de `EtapaMovimientoDet` de la orden filtradas por proceso Y MAQUILERO, bajo
 * `pg_advisory_xact_lock` de la orden. Esa guarda **es exactamente la condición (1)** una vez que se
 * pliega la dimensión del pack: no se reemplaza, se conserva intacta y se le AÑADE (2). De ahí sale
 * la propiedad que más importa — 🔴 **una orden SIN packs se comporta idéntico a como se comportaba
 * antes de esta etapa**: todas sus celdas llevan pack vacío, (1) es la guarda de siempre y (2) ni
 * siquiera se evalúa (los renglones sin pack no la disparan).
 */
import { pendientePorCelda } from './incompletas.js';

/**
 * El «sin pack». Es CADENA VACÍA en todas las capas —contrato, dominio y columna— y nunca `null`:
 * el pack entra en llaves `@@unique` y en Postgres dos NULL no chocan, así que con `null` la
 * unicidad «un renglón por color» se habría evaporado justo para el caso normal. Que las tres capas
 * digan lo mismo mata de paso el mapeo `null ↔ ''`, que es donde se esconden los defectos.
 */
export const SIN_PACK = '';

/** Normaliza lo que llegue como pack (ausente, nulo, con espacios) a su forma canónica. */
export function normalizarPack(pack: string | null | undefined): string {
  return (pack ?? '').trim();
}

/** ¿Este pack es «sin pack»? */
export function esSinPack(pack: string | null | undefined): boolean {
  return normalizarPack(pack) === SIN_PACK;
}

/**
 * Clave estable de una celda color×talla×PACK. El color y la talla son enteros, así que los dos
 * primeros separadores son inequívocos y el pack es todo lo que queda: una etiqueta con `:` adentro
 * no puede hacerse pasar por otra celda. No se vuelve a partir nunca: sólo se compara.
 */
export function claveCeldaPack(idColor: number, idTalla: number, pack: string): string {
  return `${idColor}:${idTalla}:${normalizarPack(pack)}`;
}

/**
 * ¿La orden se fabrica POR PACKS? Lo dice su matriz: basta con que UN renglón traiga pack. Es la
 * pregunta de la que cuelga «el pack es obligatorio en el corte y en la entrega a maquila»: en una
 * orden sin packs ese campo no se pide (ni se acepta).
 */
export function ordenManejaPacks(packsDeLaMatriz: Iterable<string>): boolean {
  for (const p of packsDeLaMatriz) {
    if (!esSinPack(p)) return true;
  }
  return false;
}

// ── El tope del RECIBO cuando conviven renglones CON pack y SIN pack ────────────────────────────

/** Una celda de la captura de un recibo, ya aplanada, para efectos del tope. */
export interface CeldaRecibidaParaTope {
  idColor: number;
  idTalla: number;
  /** Pack declarado en el renglón; {@link SIN_PACK} si el maquilero los devolvió revueltos. */
  pack: string;
  /**
   * Piezas que FÍSICAMENTE vuelven del taller con esta celda = buenas + incompletas. Es lo que topa
   * (decisión (g), sobre-recibo estricto): no se pueden devolver más piezas de las que salieron.
   */
  devuelveAhora: number;
}

/** Los cuatro saldos ya leídos de la BD (bajo lock) que el tope necesita. */
export interface SaldosDelRecibo {
  /** Enviado vivo, por `claveCeldaPack`. Base de la condición (2). */
  enviadoPorPack: ReadonlyMap<string, number>;
  /** Ya devuelto vivo (buenas + incompletas), por `claveCeldaPack`. Base de la condición (2). */
  devueltoPorPack: ReadonlyMap<string, number>;
  /** Enviado vivo AGREGANDO todos los packs, por `claveCelda` (color:talla). Condición (1). */
  enviadoTotal: ReadonlyMap<string, number>;
  /**
   * Ya devuelto vivo AGREGANDO todos los packs — **incluido lo devuelto sin pack**, que es
   * justamente lo que sólo esta condición puede cobrar. Por `claveCelda`. Condición (1).
   */
  devueltoTotal: ReadonlyMap<string, number>;
}

/** Un renglón de la captura que no cabe: por qué, cuánto pide y cuánto queda. */
export type ExcesoRecibo =
  | {
      /** Condición (1): la celda color×talla no cabe ni sumando TODOS los packs. */
      motivo: 'total';
      idColor: number;
      idTalla: number;
      pide: number;
      disponible: number;
    }
  | {
      /** Condición (2): el renglón no cabe en el saldo de SU pack. */
      motivo: 'pack';
      idColor: number;
      idTalla: number;
      pack: string;
      pide: number;
      disponible: number;
    };

/**
 * ⭐ EL TOPE DEL RECIBO — la respuesta a lo que Daniel pidió *«definir (y probar)»*. Devuelve los
 * renglones de la captura que NO caben; vacío = la captura cabe. Puro: el llamador redacta el error
 * con los nombres y lanza.
 *
 * Aplica las DOS condiciones del encabezado de este módulo:
 *
 *   (1) **TOTAL, por color×talla** — se suman TODOS los renglones de ESTA captura de esa celda
 *       (los de cada pack **y** el de sin pack) y se topan JUNTOS contra
 *       `enviadoTotal − devueltoTotal`. 🔴 Sumarlos es imprescindible: hasta §Post-F9.10 una celda
 *       color×talla aparecía UNA sola vez por captura (el color era único y la talla única dentro
 *       del color), así que topar renglón por renglón bastaba; con packs la MISMA celda puede venir
 *       tres veces en una captura y toparlas por separado dejaría pasar el triple.
 *
 *   (2) **POR PACK** — sólo para los renglones que declaran pack. El renglón SIN pack no la dispara
 *       a propósito: *«un recibo SIN pack consume del saldo agregado»*, no del de ningún pack.
 *
 * En una orden SIN packs, (1) es literalmente la guarda que ya existía y (2) no llega a evaluarse.
 */
export function excesosDelRecibo(
  celdas: readonly CeldaRecibidaParaTope[],
  saldos: SaldosDelRecibo,
): ExcesoRecibo[] {
  const excesos: ExcesoRecibo[] = [];

  // (1) TOTAL — acumula la captura por color×talla, plegando el pack.
  const pidePorCelda = new Map<string, { idColor: number; idTalla: number; pide: number }>();
  for (const c of celdas) {
    const clave = `${c.idColor}:${c.idTalla}`;
    const acum = pidePorCelda.get(clave);
    if (acum === undefined) {
      pidePorCelda.set(clave, { idColor: c.idColor, idTalla: c.idTalla, pide: c.devuelveAhora });
    } else {
      acum.pide += c.devuelveAhora;
    }
  }
  for (const [clave, x] of pidePorCelda) {
    // MISMA función que el pendiente que la pantalla ofrece como tope (`pendientePorCelda`): una
    // copia reducida aquí haría que la pantalla ofreciera lo que el servidor rechaza.
    const disponible = pendientePorCelda(
      saldos.enviadoTotal.get(clave) ?? 0,
      saldos.devueltoTotal.get(clave) ?? 0,
    );
    if (x.pide > disponible) {
      excesos.push({
        motivo: 'total',
        idColor: x.idColor,
        idTalla: x.idTalla,
        pide: x.pide,
        disponible,
      });
    }
  }

  // (2) POR PACK — sólo los renglones que declaran pack.
  for (const c of celdas) {
    if (esSinPack(c.pack)) continue;
    const clave = claveCeldaPack(c.idColor, c.idTalla, c.pack);
    const disponible = pendientePorCelda(
      saldos.enviadoPorPack.get(clave) ?? 0,
      saldos.devueltoPorPack.get(clave) ?? 0,
    );
    if (c.devuelveAhora > disponible) {
      excesos.push({
        motivo: 'pack',
        idColor: c.idColor,
        idTalla: c.idTalla,
        pack: normalizarPack(c.pack),
        pide: c.devuelveAhora,
        disponible,
      });
    }
  }

  return excesos;
}

// ── ¿Se están RE-EMPACANDO colores que ya tienen producción? (§Post-F9.10, C1) ───────────────────

/**
 * Los colores cuyo CONJUNTO DE PACKS cambia entre la matriz guardada y la que se quiere guardar.
 * Puro, para poder probarlo sin base de datos: el llamador (`ordenes.ts:sincronizarMatriz`) sólo le
 * pone los dos mapas y, si devuelve algo Y la orden tiene producción viva, rechaza.
 *
 * 🔴 POR QUÉ POR COLOR Y NO POR RENGLÓN. El corte y la entrega a maquila llavean sus celdas con
 * `color:talla:pack`. Si los packs de un color cambian después de cortar, `sumarCeldas` sigue
 * llaveando lo cortado con el pack VIEJO mientras `registrarEnvioMaquila` busca el NUEVO: el
 * disponible da 0 y esas piezas ya cortadas **no se pueden enviar nunca**, con un error que además
 * culpa al usuario. Una comprobación atada al `id` del renglón NO lo detecta, porque hay dos
 * caminos que re-empacan sin tocar un solo `id`:
 *   • borrar y recrear (un `set` sin `id`: el diff borra los viejos y crea otros);
 *   • `copiarDetalleOrden`, que arma su `set` SIN `id` en ningún renglón — ahí una guarda por `id`
 *     no se ejecutaba nunca.
 *
 * 🔑 Un color que se QUITA entero (no está en `despues`) NO cuenta: eso ya se podía antes de esta
 * etapa y no es lo que el pack rompe. Un color NUEVO tampoco: no tiene producción que huérfanar.
 */
export function coloresReempacados(
  antes: ReadonlyMap<number, ReadonlySet<string>>,
  despues: ReadonlyMap<number, ReadonlySet<string>>,
): number[] {
  const cambiados: number[] = [];
  for (const [idColor, packsAntes] of antes) {
    const packsDespues = despues.get(idColor);
    if (packsDespues === undefined) continue;
    const distinto =
      packsAntes.size !== packsDespues.size || [...packsAntes].some((p) => !packsDespues.has(p));
    if (distinto) cambiados.push(idColor);
  }
  return cambiados;
}

/** Agrupa renglones `{idColor, pack}` en «packs por color», normalizando el pack. */
export function packsPorColor(
  filas: readonly { idColor: number; pack: string }[],
): Map<number, Set<string>> {
  const mapa = new Map<number, Set<string>>();
  for (const f of filas) {
    const delColor = mapa.get(f.idColor) ?? new Set<string>();
    delColor.add(normalizarPack(f.pack));
    mapa.set(f.idColor, delColor);
  }
  return mapa;
}
