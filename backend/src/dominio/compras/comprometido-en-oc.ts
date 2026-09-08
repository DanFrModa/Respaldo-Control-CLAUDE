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
import { idCanonico, resolverColoresCanonicos } from '../catalogos/colores-canonicos.js';

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
 * ⭐⭐ **PONE UN PUÑADO DE RENGLONES EN ESPACIO CANÓNICO** (fila 0.159, §Post-F9.222) — el único
 * ajuste que la fusión de colores necesitó en todo el módulo de compras.
 *
 * ## El problema, en una frase
 *
 * Desde la fila 0.159 la fusión de colores **ya no reescribe los documentos**: la matriz de la orden,
 * las líneas de OC y lo que alguien dio por cubierto se quedan con el id del color ABSORBIDO (D3/D7),
 * mientras todo lo nuevo nace con el CANÓNICO. Los dos números nombran el mismo color real.
 *
 * 🔴 **Y este módulo compara justo esos dos números.** El neteo pregunta *«¿cuánto de esto ya está en
 * una OC?»* cruzando `(material, color)` del snapshot contra `(material, color)` de las líneas de OC.
 * Si un lado dijera «color 7» y el otro «color 12» siendo el mismo color, el cruce no casaría y la
 * explosión **volvería a pedir lo que ya viaja en una orden de compra** — el defecto exacto que
 * §Post-F9.85 cerró, resucitado por una limpieza de catálogo.
 *
 * ⚠️ **Por qué es una función y no la resolución escrita en cada consulta.** Los dos lados del cruce
 * tienen que estar en el MISMO espacio o el neteo miente, y "acordarse de resolver también en el otro
 * sitio" es exactamente como se separan dos verdades. Aquí se aplica de una línea en cada lectura, y
 * la lista de qué lecturas la llevan vive en `DECISIONES.md` §Post-F9.222.
 *
 * ⚠️ **Sólo toca `idColorPrenda`** (catálogo `Color`, el de la prenda). `idTelaColor` es de OTRO
 * catálogo (`TelaColor`), que no tiene fusión: pasarlo por aquí sería confundir dos mundos que
 * {@link colorDelRenglon} mantiene separados a propósito.
 *
 * Devuelve copias; sin colores o sin rastro devuelve las filas tal cual y el módulo se comporta
 * EXACTAMENTE como antes de esta fila (que es lo que lo hace seguro cuando no hay ninguna fusión).
 */
export async function canonizarColorPrenda<T extends { idColorPrenda: number | null }>(
  filas: readonly T[],
  bd?: ContextoBd,
): Promise<T[]> {
  if (filas.length === 0) return [];
  const mapa = await resolverColoresCanonicos(
    clienteLectura(bd),
    filas.map((f) => f.idColorPrenda),
  );
  if (mapa.size === 0) return [...filas];
  return filas.map((f) => ({ ...f, idColorPrenda: idCanonico(mapa, f.idColorPrenda) }));
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

/**
 * ⭐⭐ **EL COLOR DEL RENGLÓN, SEA DE LO QUE SEA** (V1-E8c, §Post-F9.126) — la ÚNICA función que
 * responde *"¿de qué color es esta línea?"*.
 *
 * Desde V1-E3u una línea de TELA lleva su color en `idTelaColor` (catálogo `TelaColor`). Desde
 * V1-E8c una línea de AVÍO lleva el suyo en `idColorPrenda` (catálogo `Color`, el de la prenda: el
 * avío **no tiene catálogo de color propio**, §Post-F9.91). Son dos catálogos distintos, pero
 * responden la MISMA pregunta y nunca coexisten en una línea — así que el neteo, la agrupación y el
 * diff pueden razonar con un solo número.
 *
 * 🔴 **Por qué no hay riesgo de confundir un `TelaColor` 7 con un `Color` 7**: este número SIEMPRE
 * viaja dentro de una `claveMaterial` (`tela-5` / `avio-9`), que ya separa los dos mundos. Sacarlo
 * de ahí y compararlo suelto sería el error; por eso vive aquí y no como un campo más.
 */
export function colorDelRenglon(m: {
  idTela: number | null;
  idTelaColor: number | null;
  idColorPrenda: number | null;
}): number | null {
  return m.idTela !== null ? m.idTelaColor : m.idColorPrenda;
}

/**
 * ⭐⭐ **LA IDENTIDAD DE UN RENGLÓN DE EXPLOSIÓN: *(material, color)*** — la clave con la que se
 * agrupa, se netea, se ajusta y —desde ⭐⭐ V1-E8e (§Post-F9.99)— se **da por cubierto**.
 *
 * Vivía como función privada en `mrp.ts`; se mudó AQUÍ, junto a {@link claveMaterial} y
 * {@link colorDelRenglon}, el día que un tercer módulo necesitó escribirla. Una clave que dos
 * archivos arman por su cuenta es una clave que en la primera corrección se escribe distinta — y
 * cuando la clave es la identidad de un renglón, eso significa cubrir el cierre rojo y seguir
 * pidiendo el azul.
 *
 * ⚠️ NO lleva proveedor: el proveedor puede cambiar (y lo cambia Compras desde la propia pantalla,
 * §Post-F9.82) sin que el renglón deje de ser el mismo. La clave que SÍ lo lleva es
 * `claveAgrupada` de `mrp.ts`, y es otra cosa: *"¿qué compras caben en la misma OC?"*.
 */
export function claveMaterialColor(m: {
  idTela: number | null;
  idAvio: number | null;
  idTelaColor: number | null;
  idColorPrenda: number | null;
}): string {
  const idColor = colorDelRenglon(m);
  return `${claveMaterial(m)}|${idColor === null ? 'sin' : String(idColor)}`;
}

/**
 * ⭐⭐ **¿CUÁNTO FALTA COMPRAR DE VERDAD? — EL CRITERIO, UNO SOLO** (V1-E3q §Post-F9.85 + ⭐⭐ V1-E8e
 * §Post-F9.99).
 *
 * Un requerimiento queda satisfecho cuando **lo comprometido en OC + lo dado por cubierto ≥ lo que
 * había que comprar**. Los dos sumandos responden la MISMA pregunta —*"¿hace falta volver a comprar
 * esto?"*— por dos caminos distintos: uno lo contesta un documento (la OC), el otro lo contesta una
 * persona (*"con esto queda cubierto"*, §Post-F9.99).
 *
 * 🔴 **Por qué es UNA función y no la resta escrita en cada sitio.** La fórmula vivía repetida en
 * dos lugares (la proyección de la explosión y el plan de compra) y la etapa que agregó el tercer
 * sumando habría tenido que acordarse de los dos: el día que uno se quedara atrás, la explosión y la
 * revisión previa dirían números distintos sobre lo mismo — el defecto exacto que §Post-F9.85 vino a
 * cerrar. Ahora hay un solo sitio que puede estar mal, y una sola prueba que lo fija.
 *
 * ⚠️ Devuelve el número **a la escala de `OrdenCompraLinea.cantidad`** (2 decimales), que es la
 * columna donde ese pendiente va a acabar. Sin redondear aquí, un requerido de `3.7020` contra una
 * línea guardada de `3.70` dejaba `0.002` "pendientes" que ninguna columna puede guardar, y el
 * renglón volvía a ofrecerse para siempre (la queja literal de Daniel del 20-ago).
 *
 * @param aComprar lo que el snapshot dice que hay que comprar (requerido − stock genérico).
 * @param enOc lo que ya viaja en una OC viva ({@link comprometidoEnOc}).
 * @param cubierto lo que alguien decidió NO comprar (`dado-por-cubierto.ts`). 0 = nadie decidió nada.
 */
export function pendienteDeComprar(aComprar: number, enOc: number, cubierto: number): number {
  return redondearCantidadCompra(Math.max(0, aComprar - enOc - cubierto));
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
   * ⭐⭐ V1-E3u (§Post-F9.89) — el mismo total, DESGLOSADO POR COLOR DEL RENGLÓN: de tela en las
   * líneas de tela y, desde ⭐⭐ V1-E8c (§Post-F9.126), **de prenda en las de avío**
   * ({@link colorDelRenglon} decide cuál).
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
  const lineasCrudas = await cliente.ordenCompraLinea.findMany({
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
      // ⭐⭐ V1-E8c (§Post-F9.126): el color de la línea de AVÍO. Sin él, cuatro renglones de
      // cierre (uno por color) netearían contra una sola cubeta y tres se quedarían sin nada que
      // restar — el defecto de §Post-F9.85 multiplicado por cuatro.
      idColorPrenda: true,
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

  // ⭐⭐ fila 0.159 — EN ESPACIO CANÓNICO ANTES DE CRUZAR NADA (ver {@link canonizarColorPrenda}).
  // Una OC escrita ANTES de que se fusionaran dos colores duplicados sigue neteando contra la
  // explosión de HOY; sin esto, la explosión propondría comprar otra vez lo que esa OC ya cubre.
  const lineas = await canonizarColorPrenda(lineasCrudas, bd);

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
    // ⭐⭐ V1-E8c: la cubeta es el COLOR DEL RENGLÓN —de tela o de prenda—, resuelto en un solo
    // sitio (`colorDelRenglon`). Antes esto leía `idTelaColor` a secas, así que los avíos caían
    // TODOS en la cubeta `null`.
    const color = colorDelRenglon(l);
    const cubeta = acum.porColor.get(color) ?? { enOc: 0, recibido: 0 };
    cubeta.enOc = redondearCantidadCompra(cubeta.enOc + Number(l.cantidad));
    cubeta.recibido += recibidoLinea;
    acum.porColor.set(color, cubeta);
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
  /**
   * ⭐⭐ V1-E8c (§Post-F9.126) — el COLOR del renglón, ya resuelto con {@link colorDelRenglon}: de
   * tela si es tela, **de prenda si es avío**. `null` = el renglón todavía no dice de qué color.
   *
   * 🔴 Se llamaba `idTelaColor` y el nombre se quedó corto el día que los avíos estrenaron color:
   * un campo que dice "tela" y recibe colores de prenda es la clase de mentira que aquí se paga
   * cara. El tipo se llama por lo que ES, no por el primero que lo usó.
   */
  idColor: number | null;
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
 *  1. **Cada renglón se queda con lo de SU color** (`porColor[idColor]`), que es lo único que
 *     de verdad le corresponde.
 *  2. **El acervo SIN color** (`porColor[null]`) va al renglón sin color si lo hay —son la misma
 *     pregunta sin responder— y, si no lo hay, se reparte entre los renglones con color **en el
 *     orden en que vienen**, cada uno hasta lo que necesita, y **el último absorbe el remanente**.
 *  3. ⭐⭐ **fila 0.158 — las cubetas CON color que NINGÚN renglón reclama van al renglón sin color,
 *     pero SÓLO si ese renglón es el ÚNICO del material** (ningún hermano lleva color). Antes se
 *     caían al piso y la explosión volvía a ofrecer lo ya comprado.
 *
 * 🔴 **Y POR QUÉ ESE "SÓLO SI" NO ES OPCIONAL** (hallazgo del reviewer, 7-sep-2026). La tentación
 * es decir *"el renglón sin color pide TODO el material de la orden, así que le tocan todas las
 * líneas"*. **Eso es cierto en un avío colapsado y FALSO en una tela.** En un avío marcado
 * `seCompraSinColor` hay un solo renglón por orden: **`OrdenAvio` tiene `@@unique([idOrden,
 * idAvio])`**, así que el avío entra una vez a la **receta congelada de la orden** —que es lo que
 * la explosión recorre (`Orden.recetaAvios`)— y {@link gruposDeCompraDelAvio} devuelve un único
 * grupo. (`ModeloAvio.@@id([idModelo, idAvio])` lo refuerza aguas arriba, en el BOM del modelo,
 * pero la garantía es la de la receta: `OrdenAvio` se escribe aparte al congelarla y sin su propio
 * cerrojo admitiría duplicados.)
 * En una tela NO: los colores de prenda **sin amarre de color de tela** caen todos en el grupo
 * `'sin'` **junto a** los que sí lo tienen, así que una misma tela emite a la vez renglones con
 * color **y** uno sin color — y ese renglón sin color es **una PARTE de la orden, no toda**. Es el
 * estado normal mientras el comprador no captura los tonos.
 *
 * ⚠️ **Medido:** con una tela mixta y una cubeta huérfana (que se fabrica cambiando un amarre de
 * color con la OC en `borrador` — permitido, porque `borrador` no está en
 * {@link ESTATUS_OC_COMPROMETIDA} pero **sí** en {@link ESTATUS_OC_QUE_CUBREN}), absorber sin la
 * guarda acreditaba al renglón sin color 100 m que la OC había pedido de OTRO tono: su faltante
 * real se iba a cero y **ese material no se compraba nunca**. Cambiar una sobre-compra visible por
 * una **sub-compra silenciosa que para la producción** es peor negocio, y además es exactamente lo
 * que la regla 2 prohíbe tres líneas más abajo: no se le atribuye a un renglón lo que la OC pidió
 * para otro color.
 *
 * 🔑 **La invariante, ACOTADA a donde vale:** cuando el renglón sin color es el **único** del
 * material, `Σ(enOc) = comprometido.enOc` — nada de lo ya comprometido se queda sin contar, que es
 * lo que hacía `comprometidoDe` antes de que existieran los colores. Con hermanos de color en la
 * mesa **no vale, y no debe valer**: lo huérfano se queda sin repartir a propósito.
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
    enOc: f.idColor === null ? 0 : (comprometido.porColor.get(f.idColor)?.enOc ?? 0),
    desdeAcervoSinColor: 0,
  }));
  const acervoSinColor = comprometido.porColor.get(null)?.enOc ?? 0;

  // El renglón SIN color se lleva el acervo entero: los dos son "esta tela, sin decir de qué color".
  // ⚠️ Aquí NO hay ambigüedad que marcar: la fila pregunta lo mismo que el acervo responde.
  const indiceSinColor = filas.findIndex((f) => f.idColor === null);
  if (indiceSinColor >= 0) {
    /**
     * ⭐⭐ **fila 0.158 — LAS CUBETAS HUÉRFANAS.** Son las que SÍ dicen un color, pero un color que
     * ningún renglón de esta explosión reclama. Nacen en cuanto alguien marca «se compra sin tomar
     * en cuenta el color» en un avío cuya OP **ya tenía OC por color**: la explosión pasa a emitir
     * UN renglón sin color y las tres cubetas (Rojo, Azul, Negro) se quedan sin dueño.
     *
     * 🔴 **Sin esto se compra dos veces.** Medido por el camino real: la re-explosión decía
     * `enOc: 0 / pendiente: 100` con las 100 piezas ya pedidas en una OC viva, y la segunda
     * generación volvía a ofrecerlas. Es §Post-F9.85 resucitado por otra puerta.
     *
     * 🔴 **PERO SÓLO CUANDO NADIE MÁS LLEVA COLOR** (`conRenglon.size === 0`). Con hermanos de
     * color en la mesa —el caso normal de una tela a la que le faltan tonos por capturar— el
     * renglón sin color es **una PARTE de la orden, no toda**, y acreditarle una línea que la OC
     * pidió de otro tono le baja el faltante a cero: **ese material ya no se compra nunca**. Ver el
     * porqué completo, con la medición, en el doc de esta función.
     *
     * ⚠️ **Y NO se marcan como ambiguas** (`desdeAcervoSinColor` sigue en 0): ese campo dice *"la
     * OC no decía de qué color era, así que atribuírselo a ESTE color lo eligió el sistema"*. Aquí
     * la OC sí dice su color, y con la guarda de arriba el renglón que las recibe es el ÚNICO del
     * material: le corresponden enteras, sin elección que confesar. Marcarlas en vez de acotar la
     * absorción NO sirve —el número seguiría neteando y el material seguiría sin comprarse—; sólo
     * avisaría del daño.
     */
    const conRenglon = new Set<number>();
    for (const f of filas) {
      if (f.idColor !== null) conRenglon.add(f.idColor);
    }
    let huerfano = 0;
    if (conRenglon.size === 0) {
      for (const [idColor, cubeta] of comprometido.porColor) {
        if (idColor !== null) huerfano += cubeta.enOc;
      }
    }

    const fila = propio[indiceSinColor] as RepartoNeteo;
    fila.enOc = redondearCantidadCompra(fila.enOc + acervoSinColor + huerfano);
    return propio;
  }

  // Sin renglón sin color: se reparte por necesidad y el ÚLTIMO absorbe lo que sobre.
  //
  // ⚠️ **Aquí las huérfanas NO se reparten, y es a propósito.** Sin un renglón sin color, darle a
  // Azul lo que una OC pidió para Rojo sería inventar un hecho —la clase de suposición escrita como
  // dato que §Post-F9.86 prohíbe—. El acervo sin color sí se reparte porque ahí la OC no dice nada;
  // una línea que SÍ dice "Rojo" no se le atribuye a otro color.
  let acervo = acervoSinColor;
  if (acervo <= 0) return propio;

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
