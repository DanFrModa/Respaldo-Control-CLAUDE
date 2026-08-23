/**
 * ⭐ **A QUIÉN SE LE COMPRA UN MATERIAL** — la política de proveedor del MRP, en funciones PURAS
 * (V1-E3m, `DECISIONES.md` §Post-F9.82). Sin BD: recibe los candidatos ya leídos del catálogo/de la
 * orden y decide cuál manda. Vive aparte de `mrp.ts` justamente para que la REGLA se pueda ejercitar
 * sin levantar Postgres — la elección de proveedor es lo que esta etapa vino a arreglar, y una regla
 * que solo se prueba con un contenedor termina probándose poco.
 *
 * ⚠️ **NO decide el PRECIO.** Eso es la cascada de `costos/resolucion-precios.ts` (F8/§Post-F9.48) y
 * el pisado con la última compra real de `mrp.ts`. Aquí solo se resuelve **el proveedor** y se
 * arrastra el precio que ese candidato traiga consigo.
 *
 * ── EL PROBLEMA QUE ARREGLA ────────────────────────────────────────────────────────────────────
 * Daniel, 20-ago-2026, con la receta liberada y la explosión enfrente: *"no me deja hacer nada… ahí
 * veo todo, pero no puedo avanzar"*. Ningún renglón traía proveedor sugerido, y sin proveedor el
 * botón de generar OC está apagado. **No faltaba una función: había una desviación.** La regla de
 * las telas ya estaba en el modelo de datos —`Tela.idProveedor`, el proveedor DUEÑO del artículo
 * (§Post-F9.11: *"la felpa de Alsatex y la de otro proveedor son telas DISTINTAS"*)— y el motor de
 * compras la ignoraba: desde F8 resolvía por `TelaProveedor` (el amarre de Desarrollo, pensado para
 * material que se compra a varios) y, sin amarre, se rendía.
 *
 * ── LAS DOS CASCADAS (y por qué en ese orden) ──────────────────────────────────────────────────
 *
 * **TELA** — `amarre de Desarrollo → DUEÑO de la tela → asignación de Compras`.
 *   Daniel: *"normalmente las telas SÍ tienen un proveedor específico… **ahí no tenemos telas que
 *   puedan pertenecer a más de un proveedor**"*. El dueño es identidad del artículo, así que casi
 *   siempre resuelve. El amarre sigue arriba porque es MÁS específico (lo eligió una persona para
 *   ese modelo, y trae precio negociado y precio por color).
 *
 * **AVÍO** — `amarre de Desarrollo → HABITUAL → más barato → asignación de Compras`.
 *   Daniel: *"en avíos sí podría ser que un elástico se compre con más de un proveedor… pero
 *   **tener avíos sin proveedor asignado está generando más problemas que beneficios**"*. Se
 *   INVIERTE el default de F4: la explosión ya no propone *el más barato* como regla general, sino
 *   **al que se le compra siempre**. El más barato NO se retira: queda de fallback para el avío que
 *   todavía no tiene habitual — eso es lo que hace que esta etapa no cambie el comportamiento de
 *   ningún avío que nadie haya tocado (no-regresión por construcción).
 *
 * ── ⭐ POR QUÉ LA ASIGNACIÓN DE COMPRAS VA HASTA ABAJO ────────────────────────────────────────
 * Daniel, textual y no negociable: *"el comprador asigna un proveedor **para esa OP en
 * particular**… no para siempre ni para todo. **El proveedor puede seguir viniendo desde
 * desarrollo**"*. Ponerla al último es lo que cumple esa frase **en el motor** y no en un comentario:
 *  • **no puede pisar a Desarrollo ni al catálogo** — solo se usa donde hay HUECO, que es
 *    exactamente el caso que vino a desatorar;
 *  • si mañana Desarrollo amarra un proveedor, **Desarrollo gana solo**, sin que nadie tenga que
 *    acordarse de borrar la asignación de urgencia;
 *  • y esa asignación que quedó sin usarse **no se calla** (D3): `asignacionDormida` la delata para
 *    que la explosión la nombre en un aviso.
 * Lo que el comprador SÍ puede hacer siempre —cambiar proveedor y tela a la hora de comprar— vive en
 * la OC, que es editable y nace en `borrador`: *"sí puede cambiar la tela con todo y su proveedor a
 * la hora de comprar. Lo mismo en avíos"*. Cada frase de Daniel tiene UN mecanismo, y no se pisan.
 */
import { precioAUnidadConsumo, resolverFactor } from '../../comun/conversion.js';

/** De dónde salió el proveedor que la explosión propone (traza para la UI y los avisos). */
export type OrigenProveedorMaterial =
  | 'amarre-desarrollo'
  | 'dueno-tela'
  | 'habitual'
  | 'mas-barato'
  | 'asignado-compras'
  | 'sin-proveedor';

/** Un proveedor candidato a surtir el material, con el precio que trae consigo. */
export interface CandidatoProveedor {
  idProveedor: number;
  proveedor: string;
  /** Precio POR UNIDAD DE CONSUMO ya normalizado (R1), o null si el candidato no trae precio. */
  precio: number | null;
  /** ¿El proveedor está activo? Un candidato de baja SE CONSERVA, pero el llamador avisa. */
  activo: boolean;
  /**
   * El precio lo TECLEÓ una persona para ESTA compra (hoy: el que captura Compras al asignar). El
   * llamador no lo pisa con la última compra real: quien lo escribió sabía lo que iba a pagar.
   */
  precioFijado?: boolean;
}

/** Resultado de elegir proveedor: quién quedó, de dónde salió y si una asignación quedó sin uso. */
export interface ResolucionProveedorMaterial {
  elegido: CandidatoProveedor | null;
  origen: OrigenProveedorMaterial;
  /**
   * Compras había asignado un proveedor para esta orden y **no se usó** porque algo más arriba
   * resolvió. No es un error: es lo que la decisión buscaba (Desarrollo manda). Pero se DICE.
   */
  asignacionDormida: boolean;
}

/** Un renglón `AvioProveedor` con lo que hace falta para elegir y normalizar su precio (R1). */
export interface FilaProveedorAvio {
  idProveedor: number;
  proveedor: string;
  activo: boolean;
  /** `AvioProveedor.precio` (por PRESENTACIÓN de compra). Null si no lo fija. */
  precio: number | null;
  /** `AvioProveedor.factorConversion` (el fino). Null → cae al del avío. */
  factorConversion: number | null;
  /** ⭐ ¿Es el proveedor HABITUAL de este avío (§Post-F9.82)? */
  habitual: boolean;
}

/**
 * Precio POR UNIDAD DE CONSUMO de un renglón de proveedor (R1: precio ÷ factor), o null si ese
 * proveedor no tiene precio capturado. Se exporta porque el MRP también la necesita para valuar al
 * proveedor que **asignó Compras** sin capturar precio: si ese proveedor ya tenía precio en el
 * catálogo, es el suyo el que debe usarse — no el de otro.
 */
export function precioProveedorAvio(
  fila: FilaProveedorAvio,
  factorAvio: number | null,
): number | null {
  if (fila.precio === null || !Number.isFinite(fila.precio)) {
    return null;
  }
  return precioAUnidadConsumo(fila.precio, resolverFactor(fila.factorConversion, factorAvio));
}

/**
 * ⭐ El proveedor **HABITUAL** del avío (§Post-F9.82): el renglón marcado, con su precio ya
 * normalizado a unidad de consumo. `null` si nadie lo marcó (entonces el llamador cae al más barato
 * de F4 — el fallback intacto).
 *
 * Un habitual **INACTIVO se conserva** (mismo criterio que el amarre de Desarrollo: alguien lo
 * eligió a propósito y la OC es editable), pero el llamador avisa. Un habitual **sin precio** también
 * se conserva: la decisión de Daniel es *a quién se le compra*, y quedarse sin proveedor por no
 * tener precio capturado es justo el atorón que esta etapa vino a quitar.
 *
 * Si por lo que sea llegaran DOS marcados (la base lo impide con un índice único parcial, pero esta
 * función es pura y no puede confiar en eso), gana el `idProveedor` MENOR — determinista, nunca el
 * orden en que vinieron las filas.
 */
export function candidatoHabitualAvio(
  filas: readonly FilaProveedorAvio[],
  factorAvio: number | null,
): CandidatoProveedor | null {
  let elegida: FilaProveedorAvio | null = null;
  for (const fila of filas) {
    if (!fila.habitual) continue;
    if (elegida === null || fila.idProveedor < elegida.idProveedor) {
      elegida = fila;
    }
  }
  if (elegida === null) {
    return null;
  }
  return {
    idProveedor: elegida.idProveedor,
    proveedor: elegida.proveedor,
    precio: precioProveedorAvio(elegida, factorAvio),
    activo: elegida.activo,
  };
}

/**
 * El proveedor MÁS BARATO del avío (regla R1/F4, **intacta**): entre los ACTIVOS que tienen precio,
 * el de menor costo por unidad de consumo (precio ÷ factor); en empate gana el `idProveedor` MENOR
 * (desempate determinista, no el orden de la BD). `null` si ninguno tiene precio.
 *
 * Es la MISMA regla que hasta hoy vivía en una consulta por avío dentro de `mrp.ts`: al pasarla aquí
 * se volvió (a) probable sin Postgres y (b) barata — la explosión ya traía estos renglones en su
 * `select`, así que dejó de pagar una consulta por cada avío de la receta.
 */
export function candidatoMasBaratoAvio(
  filas: readonly FilaProveedorAvio[],
  factorAvio: number | null,
): CandidatoProveedor | null {
  let mejor: { fila: FilaProveedorAvio; precio: number } | null = null;
  for (const fila of filas) {
    if (!fila.activo) continue;
    const precio = precioProveedorAvio(fila, factorAvio);
    if (precio === null) continue;
    const ganaPorPrecio = mejor === null || precio < mejor.precio;
    const empateMenorId =
      mejor !== null && precio === mejor.precio && fila.idProveedor < mejor.fila.idProveedor;
    if (ganaPorPrecio || empateMenorId) {
      mejor = { fila, precio };
    }
  }
  if (mejor === null) {
    return null;
  }
  return {
    idProveedor: mejor.fila.idProveedor,
    proveedor: mejor.fila.proveedor,
    precio: mejor.precio,
    activo: mejor.fila.activo,
  };
}

/** Escalones de una cascada: el primero con candidato gana. */
type Escalon = readonly [OrigenProveedorMaterial, CandidatoProveedor | null | undefined];

/** Recorre los escalones en orden y arma la resolución (incluida la asignación dormida). */
function elegirPrimero(
  escalones: readonly Escalon[],
  asignacionCompras: CandidatoProveedor | null | undefined,
): ResolucionProveedorMaterial {
  for (const [origen, candidato] of escalones) {
    if (candidato != null) {
      return {
        elegido: candidato,
        origen,
        asignacionDormida: asignacionCompras != null && origen !== 'asignado-compras',
      };
    }
  }
  return { elegido: null, origen: 'sin-proveedor', asignacionDormida: false };
}

/** Candidatos de una TELA, en el orden en que se leyeron (la precedencia la pone la función). */
export interface CandidatosTela {
  /** Amarre de Desarrollo (`OrdenTela.idTelaProveedor` → `TelaProveedor`). */
  amarre?: CandidatoProveedor | null | undefined;
  /** ⭐ DUEÑO del artículo (`Tela.idProveedor`, §Post-F9.11) — la regla que el motor ignoraba. */
  dueno?: CandidatoProveedor | null | undefined;
  /** Asignación de Compras PARA ESTA ORDEN (`OrdenTela.idProveedorCompra`). Último escalón. */
  compras?: CandidatoProveedor | null | undefined;
}

/** Elige el proveedor de una TELA: amarre de Desarrollo → dueño de la tela → asignación de Compras. */
export function elegirProveedorTela(candidatos: CandidatosTela): ResolucionProveedorMaterial {
  return elegirPrimero(
    [
      ['amarre-desarrollo', candidatos.amarre],
      ['dueno-tela', candidatos.dueno],
      ['asignado-compras', candidatos.compras],
    ],
    candidatos.compras,
  );
}

/** Candidatos de un AVÍO. */
export interface CandidatosAvio {
  /** Amarre de Desarrollo (`OrdenAvio.idAvioProveedor`) CON precio usable; si no, no es candidato. */
  amarre?: CandidatoProveedor | null | undefined;
  /** ⭐ El proveedor HABITUAL (§Post-F9.82). */
  habitual?: CandidatoProveedor | null | undefined;
  /** El más barato con precio (regla F4, fallback). */
  masBarato?: CandidatoProveedor | null | undefined;
  /** Asignación de Compras PARA ESTA ORDEN (`OrdenAvio.idProveedorCompra`). Último escalón. */
  compras?: CandidatoProveedor | null | undefined;
}

/** Elige el proveedor de un AVÍO: amarre → habitual → más barato → asignación de Compras. */
export function elegirProveedorAvio(candidatos: CandidatosAvio): ResolucionProveedorMaterial {
  return elegirPrimero(
    [
      ['amarre-desarrollo', candidatos.amarre],
      ['habitual', candidatos.habitual],
      ['mas-barato', candidatos.masBarato],
      ['asignado-compras', candidatos.compras],
    ],
    candidatos.compras,
  );
}
