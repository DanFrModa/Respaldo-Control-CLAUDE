/**
 * ⭐ **LA VERDAD DE "CUÁNTO DE ESTO YA ESTÁ EN UNA ORDEN DE COMPRA" — UN SOLO LUGAR**
 * (V1-E3q, §Post-F9.85).
 *
 * Daniel, probando en vivo: *"me vuelvo a meter en la pantalla y sigue apareciendo ahí los
 * elementos y me deja volver a hacerla"*. El defecto de fondo era que la explosión proponía comprar
 * lo que YA se había comprado: el snapshot de requerimientos (`RequerimientoOrden.cantidadAComprar`)
 * guarda la DEMANDA (requerido − stock) y nadie le restaba lo que ya viajaba en una OC.
 *
 * El cruce ya existía —el tablero *"qué tengo / qué falta"* (R7) lo calculaba dentro de
 * `estatusMaterialesOrden`—, pero vivía enterrado ahí. Este módulo lo SACA a una función
 * compartida para que el tablero, la explosión, la revisión previa y la generación de OC lean
 * **exactamente el mismo número**. Una segunda implementación del mismo cruce es una segunda
 * verdad, y dos verdades sobre "cuánto ya compré" es justo el defecto que esta etapa vino a cerrar.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## ⚖️ QUÉ ESTATUS DE OC CUENTAN COMO "YA COMPRADO" — la decisión, con su razón
 *
 * **Cuentan TODAS menos `cancelada`.** Es decir: `borrador`, `pendiente_autorizacion`,
 * `autorizada`, `recibida_parcial` y `recibida_total`.
 *
 * **Por qué `borrador` SÍ cuenta** (y aquí está el corazón del arreglo): la OC que genera esta
 * misma pantalla **nace en `borrador`** (`ordenes-compra.ts`, §Post-F9.85 defecto 2). Si el
 * borrador no contara, el usuario generaría la OC, volvería a la explosión, vería el renglón
 * pendiente otra vez y la generaría de nuevo — exactamente lo que Daniel vio. Un borrador es un
 * documento REAL, con folio propio, que alguien ya escribió: la pregunta que responde este módulo
 * no es *"¿ya me comprometí a pagar?"* sino *"¿este material ya está cubierto por un documento
 * vivo?"*, y un borrador lo cubre.
 *
 * **Por qué `cancelada` NO cuenta:** cancelar es la manera documentada de deshacer (D3, la OC no se
 * borra, se marca). Una OC cancelada dejó de cubrir su material y ese material tiene que volver a
 * aparecer como pendiente de comprar — si no, cancelar una compra equivocada dejaría a la orden sin
 * poder recomprar nunca.
 *
 * ⚠️ **Este criterio NO es el mismo que el del COSTO, y es a propósito.** Para costear
 * (`ultimo-precio-compra.ts`, D1/§Post-F9.48) sólo cuentan `autorizada` y `recibida_*`: ahí la
 * pregunta es *"¿qué precio pagó de verdad la empresa?"*, y un borrador todavía no es un precio
 * pagado —ni siquiera está autorizado— así que dejarlo entrar cotizaría la orden con un número que
 * nadie aprobó. Aquí la pregunta es otra: *"¿hace falta volver a comprar esto?"*. Copiar el
 * criterio del costo sin pensarlo habría dejado el defecto vivo. **Dos preguntas distintas, dos
 * criterios distintos, cada uno escrito donde se usa.**
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * A9: todo se filtra por la empresa activa (la OC y la orden de producción). D3: `recibido` sale de
 * recepciones NO reversadas (una recepción reversada deja de contar sin borrarse).
 */
import type { EstatusOrdenCompra } from '../../datos/index.js';
import { redondearCantidadCompra } from './reparto-ordenes.js';
import type { ContextoBd } from '../../comun/transaccion.js';
import { clienteLectura } from '../../comun/transaccion.js';

/**
 * Estatus de OC que cuentan como "el material ya está cubierto por un documento vivo". Es la lista
 * COMPLETA menos `cancelada`; se escribe extensiva (y no como `{ not: 'cancelada' }`) para que
 * cualquier estatus NUEVO obligue a decidir a mano si cubre o no, en vez de colarse por omisión.
 */
export const ESTATUS_OC_QUE_CUBREN: readonly EstatusOrdenCompra[] = [
  'borrador',
  'pendiente_autorizacion',
  'autorizada',
  'recibida_parcial',
  'recibida_total',
];

/**
 * ⭐ **LA OTRA PREGUNTA: "¿ESTA COMPRA YA ESTÁ COMPROMETIDA FRENTE AL PROVEEDOR?"** — la lista de
 * estatus que usan las guardas de *no deshacer lo ya comprado* (§Post-F9.79: no sacar un material
 * de la receta; ⭐ V1-E4c: no cambiarle el color a una tela ya comprada).
 *
 * **`borrador` y `pendiente_autorizacion` NO están, y es la diferencia de fondo con
 * {@link ESTATUS_OC_QUE_CUBREN}.** Las dos listas responden preguntas distintas:
 *  • *"¿hace falta volver a comprar esto?"* → `ESTATUS_OC_QUE_CUBREN` (un borrador ya cubre: es un
 *    documento vivo con folio propio);
 *  • *"¿ya me comprometí con el proveedor, y por eso deshacerlo tiene que pasar por des-autorizar?"*
 *    → **esta**. Un borrador todavía no compromete a nadie: ahí la receta —y el color— se mueven
 *    libres, que es justamente lo que Daniel pidió el 22-ago.
 *
 * `cancelada` tampoco cuenta: esa OC ya no dice nada.
 *
 * ⚠️ Vive AQUÍ, junto a la otra lista, a propósito: las dos son "qué estatus de OC significan qué",
 * y tenerlas separadas es como se desincronizan. Quien agregue un estatus nuevo tiene que decidir a
 * mano en cuál de las dos entra — por eso se escriben extensivas y no como `{ not: ... }`.
 */
export const ESTATUS_OC_COMPROMETIDA: readonly EstatusOrdenCompra[] = [
  'autorizada',
  'recibida_parcial',
  'recibida_total',
];

/**
 * ¿Alguno de estos estatus es de una OC ya RECIBIDA? Lo separa el mensaje que se le da al usuario:
 * una OC autorizada se puede des-autorizar; una recibida **no** (Daniel, 20-ago-2026: *"una vez
 * recibido no se puede desautorizar"*), y ahí el camino honesto es una devolución o un ajuste.
 */
export function algunaRecibida(estatus: readonly EstatusOrdenCompra[]): boolean {
  return estatus.some((e) => e === 'recibida_parcial' || e === 'recibida_total');
}

/**
 * Clave estable de un material (tela XOR avío) — la MISMA en el snapshot de requerimientos, en las
 * líneas de OC y en el tablero R7. Las líneas libres (sin tela ni avío) caen en `libre`.
 */
export function claveMaterial(m: { idTela: number | null; idAvio: number | null }): string {
  if (m.idTela !== null) return `tela-${String(m.idTela)}`;
  if (m.idAvio !== null) return `avio-${String(m.idAvio)}`;
  return 'libre';
}

/** Lo que UNA orden de producción ya tiene comprado de UN material. */
export interface ComprometidoMaterial {
  /**
   * Σ cantidades en líneas de OC que CUBREN (ver la lista de estatus de arriba), **a la escala de la
   * columna de la que salen** (`OrdenCompraLinea.cantidad Decimal(14,2)`).
   *
   * ⚠️ Se redondea AQUÍ, en la única verdad, y no en cada consumidor: sumar decimales en coma
   * flotante deja polvo (`0.1 + 0.2 = 0.30000000000000004`) y redondearlo en dos de los tres
   * consumidores —lo que hacía la primera corrección— volvía la promesa de *"una sola verdad"* una
   * frase bonita: la explosión decía `0.3` y el tablero R7 `0.30000000000000004`. En pantalla no se
   * notaba; en el JSON del API sí viajaba.
   */
  enOc: number;
  /**
   * Σ recibido por recepciones NO reversadas de esas líneas.
   *
   * ⚠️ **NO se redondea a 2**, a diferencia de `enOc`: sale de `RecepcionCompraLinea.cantidadRecibida`,
   * que es `Decimal(14,4)`. Recortarlo a dos decimales tiraría precisión REAL de lo que de verdad
   * entró al almacén. Cada número a la escala de SU columna — que es justamente la regla que esta
   * etapa aprendió a golpes.
   */
  recibido: number;
  /** Nombre del material tal como lo trae la línea de OC (para las filas 'no-identificado' de R7). */
  material: string;
  idTela: number | null;
  idAvio: number | null;
  /**
   * ⭐⭐ V1-E3u (§Post-F9.89) — el mismo total, DESGLOSADO POR COLOR DE TELA.
   *
   * La llave `null` es el **acervo sin color**: las líneas de OC anteriores a esta etapa (y las
   * 7,978 migradas) piden *"esta tela"* sin decir de qué color, porque el sistema no dejaba
   * decirlo. No se les inventa un color —adivinarlo escribiría como hecho una suposición— así que
   * viven en su propia cubeta y {@link repartirComprometidoPorColor} decide a qué renglón cubren.
   *
   * ⚠️ El total `enOc` de arriba NO cambia: sigue siendo la Σ de todo, con y sin color. El tablero
   * R7 —que razona por material— lo lee tal cual y no se entera de esta etapa.
   */
  porColor: Map<number | null, { enOc: number; recibido: number }>;
}

/** Lo comprometido de un conjunto de órdenes: `idOrden → (claveMaterial → comprometido)`. */
export type ComprometidoPorOrden = Map<number, Map<string, ComprometidoMaterial>>;

/**
 * ⭐ LA función. Devuelve, por orden de producción y por material, cuánto ya está en OC y cuánto ya
 * se recibió. Lectura pura (no escribe nada): se puede llamar dentro o fuera de una transacción.
 *
 * @param idsOrden órdenes de producción a cruzar; vacío = mapa vacío (no consulta).
 */
export async function comprometidoEnOc(
  idEmpresa: number,
  idsOrden: readonly number[],
  bd?: ContextoBd,
): Promise<ComprometidoPorOrden> {
  const resultado: ComprometidoPorOrden = new Map();
  if (idsOrden.length === 0) return resultado;

  const cliente = clienteLectura(bd);
  const lineas = await cliente.ordenCompraLinea.findMany({
    where: {
      idOrden: { in: [...idsOrden] },
      // A9 + el criterio de arriba: la OC tiene que ser de esta empresa y estar VIVA.
      ordenCompra: { estatus: { in: [...ESTATUS_OC_QUE_CUBREN] }, idEmpresa },
    },
    select: {
      idOrden: true,
      idTela: true,
      idAvio: true,
      idTelaColor: true,
      descripcionLibre: true,
      cantidad: true,
      tela: { select: { nombre: true } },
      avio: { select: { clave: true, descripcion: true } },
      recepcionLineas: {
        where: { recepcionCompra: { reversadaEn: null } },
        select: { cantidadRecibida: true },
      },
    },
  });

  for (const l of lineas) {
    if (l.idOrden === null) continue; // imposible por el `where`, pero el tipo lo permite
    const porMaterial = resultado.get(l.idOrden) ?? new Map<string, ComprometidoMaterial>();
    const clave = claveMaterial(l);
    const material =
      l.tela?.nombre ??
      (l.avio === null
        ? (l.descripcionLibre ?? '(libre)')
        : `${l.avio.clave} — ${l.avio.descripcion}`);
    const acum = porMaterial.get(clave) ?? {
      enOc: 0,
      recibido: 0,
      material,
      idTela: l.idTela,
      idAvio: l.idAvio,
      porColor: new Map<number | null, { enOc: number; recibido: number }>(),
    };
    const recibidoLinea = l.recepcionLineas.reduce((s, r) => s + Number(r.cantidadRecibida), 0);
    acum.enOc = redondearCantidadCompra(acum.enOc + Number(l.cantidad));
    acum.recibido += recibidoLinea;
    // ⭐ V1-E3u: la MISMA suma, partida por color. Se redondea con la misma regla y en el mismo
    // lugar que el total: si las dos cubetas usaran escalas distintas, el desglose no sumaría el
    // total y habría otra vez dos verdades sobre "cuánto ya compré".
    const cubeta = acum.porColor.get(l.idTelaColor) ?? { enOc: 0, recibido: 0 };
    cubeta.enOc = redondearCantidadCompra(cubeta.enOc + Number(l.cantidad));
    cubeta.recibido += recibidoLinea;
    acum.porColor.set(l.idTelaColor, cubeta);
    porMaterial.set(clave, acum);
    resultado.set(l.idOrden, porMaterial);
  }

  return resultado;
}

/** Lo comprometido de UN material en UNA orden (0/0 si no hay nada). */
export function comprometidoDe(
  mapa: ComprometidoPorOrden,
  idOrden: number,
  material: { idTela: number | null; idAvio: number | null },
): { enOc: number; recibido: number } {
  const fila = mapa.get(idOrden)?.get(claveMaterial(material));
  return { enOc: fila?.enOc ?? 0, recibido: fila?.recibido ?? 0 };
}

/**
 * Lo que le toca a UNA fila en el neteo: cuánto ya está comprado para ella, y **cuánto de eso viene
 * del acervo SIN color** (§Post-F9.89). Lo segundo no es estadística: es la parte del número cuya
 * atribución a este color la ELIGIÓ el sistema porque la OC vieja no lo dice.
 */
export interface RepartoNeteo {
  enOc: number;
  desdeAcervoSinColor: number;
}

/** Un renglón de requerimiento visto desde el neteo: su color y lo que pide. */
export interface FilaParaNeteo {
  /** Color de tela del renglón; `null` = el renglón todavía no dice de qué color (o es de avío). */
  idTelaColor: number | null;
  /** Lo que ese renglón necesita comprar antes de netear. */
  cantidadAComprar: number;
}

/**
 * ⭐⭐ **A QUÉ RENGLÓN LE CUBRE CADA LÍNEA DE OC, AHORA QUE HAY COLORES** (V1-E3u, §Post-F9.89) —
 * función PURA.
 *
 * El problema que resuelve es de datos VIEJOS, no de diseño: desde esta etapa un renglón de
 * explosión es *(tela, color)*, pero las OC que ya existen piden *(tela)* a secas. Si el neteo
 * casara sólo por color exacto, cada OC anterior a la etapa dejaría de contar y la explosión
 * volvería a ofrecer comprar lo ya comprado — **el defecto exacto que §Post-F9.85 cerró**.
 *
 * La regla, en dos frases:
 *  1. **Cada renglón se queda con lo de SU color** (`porColor[idTelaColor]`), que es lo único que
 *     de verdad le corresponde.
 *  2. **El acervo SIN color** (`porColor[null]`) va al renglón sin color si lo hay —son la misma
 *     pregunta sin responder— y, si no lo hay, se reparte entre los renglones con color **en el
 *     orden en que vienen**, cada uno hasta lo que necesita, y **el último absorbe el remanente**.
 *
 * ⚠️ **Por qué el último absorbe (y no se tira):** con UN solo renglón sin color —el caso de toda
 * orden anterior a esta etapa— esa regla devuelve el acervo COMPLETO, que es exactamente lo que
 * `comprometidoDe` devolvía antes. Cero regresión en lo migrado: el número que ve el comprador es
 * el mismo de siempre. Si en vez de absorber se recortara a lo necesario, el tablero diría *"ya en
 * OC: 250"* donde el documento dice 300.
 *
 * 🔴 **Y DICE CUÁNDO ESTÁ ELIGIENDO.** Cuando el acervo sin color no alcanza para todos los
 * colores, **el orden de las filas decide a quién se le atribuye** — y eso NO es un cálculo, es una
 * elección que el sistema no puede fundamentar (la OC vieja no dice de qué color era, y adivinarlo
 * escribiría como HECHO una suposición: la lección de §Post-F9.86). No se puede resolver bien, pero
 * **sí se puede no callar**: cada fila devuelve `desdeAcervoSinColor` para que la pantalla lo marque
 * en vez de pintar *"ya en OC"* como un hecho plano.
 *
 * @returns lo comprometido de CADA fila, en el MISMO orden en que llegaron.
 */
export function repartirComprometidoPorColor(
  filas: readonly FilaParaNeteo[],
  comprometido: ComprometidoMaterial | undefined,
): RepartoNeteo[] {
  if (filas.length === 0) return [];
  if (comprometido === undefined) return filas.map(() => ({ enOc: 0, desdeAcervoSinColor: 0 }));

  const propio: RepartoNeteo[] = filas.map((f) => ({
    enOc: f.idTelaColor === null ? 0 : (comprometido.porColor.get(f.idTelaColor)?.enOc ?? 0),
    desdeAcervoSinColor: 0,
  }));
  let acervo = comprometido.porColor.get(null)?.enOc ?? 0;
  if (acervo <= 0) return propio;

  // El renglón SIN color se lleva el acervo entero: los dos son "esta tela, sin decir de qué color".
  // ⚠️ Aquí NO hay ambigüedad que marcar: la fila pregunta lo mismo que el acervo responde.
  const indiceSinColor = filas.findIndex((f) => f.idTelaColor === null);
  if (indiceSinColor >= 0) {
    const fila = propio[indiceSinColor] as RepartoNeteo;
    fila.enOc = redondearCantidadCompra(fila.enOc + acervo);
    return propio;
  }

  // Sin renglón sin color: se reparte por necesidad y el ÚLTIMO absorbe lo que sobre.
  for (let i = 0; i < filas.length; i += 1) {
    const esUltimo = i === filas.length - 1;
    const fila = propio[i] as RepartoNeteo;
    const falta = Math.max(0, (filas[i] as FilaParaNeteo).cantidadAComprar - fila.enOc);
    const toma = esUltimo ? acervo : Math.min(acervo, falta);
    fila.enOc = redondearCantidadCompra(fila.enOc + toma);
    // 🔴 Esto es lo que la pantalla tiene que poder decir: de este número, TANTO viene de una OC
    // que no dice de qué color era, así que su atribución a ESTE color es una elección del sistema.
    fila.desdeAcervoSinColor = redondearCantidadCompra(fila.desdeAcervoSinColor + toma);
    acervo = redondearCantidadCompra(acervo - toma);
  }
  return propio;
}
