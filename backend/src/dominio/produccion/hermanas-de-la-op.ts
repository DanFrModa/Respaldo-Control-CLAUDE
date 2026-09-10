/**
 * ⭐⭐ **EL AVISO DE LA OP QUE SE DESVÍA DEL GRUPO** (fila 0.068 (a), §Post-F9.146 pregunta 4).
 *
 * DANIEL, textual: *«Normalmente todas las OP deben de ir iguales. Puede pasar que una OP del grupo
 * se le cambie algún avío (por ejemplo, no hubo cierre de ese tono y se compró otro tipo de cierre
 * sólo para la café)… **se debe de poder hacer, pero advirtiendo de la diferencia**»*.
 *
 * Poder hacerlo **ya se podía** desde V1-E3d: el modelo comparte la receta, pero la orden guarda su
 * **copia congelada** (`OrdenTela`/`OrdenAvio`/`OrdenArte`), así que tocar la copia de UNA orden es
 * posible por diseño. Lo que faltaba es el remate: que el sistema **sepa y diga** que esa OP ya no
 * va igual que sus hermanas. Sin eso la diferencia existe, pero es invisible.
 *
 * ---
 * ## 🔴 CON QUÉ NO HAY QUE CONFUNDIRLO — las dos comparaciones son PERPENDICULARES
 *
 * | | Compara | Eje | Dónde vive |
 * |---|---|---|---|
 * | `calcularDesalineacion` | la copia congelada **contra la receta del MODELO** | VERTICAL (padre ↔ hijo, a lo largo del tiempo) | `receta-orden.ts` |
 * | **este módulo** | la copia congelada **contra la de sus OP HERMANAS** | HORIZONTAL (hermana ↔ hermana, en el mismo momento) | aquí |
 *
 * Dos OP hermanas pueden estar **las dos perfectamente alineadas con la receta del padre** y aun así
 * diferir entre ellas (una le agregó un avío a mano, la otra no); y al revés, las dos pueden estar
 * desalineadas del modelo **de la misma forma** y por tanto ir iguales entre ellas. **Ninguna de las
 * dos preguntas implica la otra**, y por eso este módulo no reusa `calcularDesalineacion` ni una
 * línea de su regla: se midió y no sirve de pieza — su comparación ya viene resuelta *por fila*
 * (`consumoModelo`/`precioModelo` vienen embebidos en el renglón), mientras que la horizontal es
 * **de grupo** y no existe hasta que están las N recetas juntas.
 *
 * 🔴 **Y una regla suya que aquí sería un defecto:** `desviadoAProposito` (ajustado / agregado a
 * mano / excluido) **silencia** la comparación vertical, porque esa diferencia contra el modelo la
 * puso alguien queriendo. Aquí es justo al revés: *ese* renglón es EL que Daniel quiere ver — es la
 * definición del caso del cierre café. Si alguien copia la regla de allá para acá, el aviso se
 * apaga exactamente en el único caso para el que existe.
 *
 * ---
 * ## QUIÉN ES «HERMANA» — medido, no supuesto
 *
 * La OP cuyo modelo cuelga del **MISMO LINAJE**: `idModeloDesarrollo ?? idModelo`, que es la regla
 * única de `modelos/receta-compartida.ts` ({@link idModeloDeLaReceta}). Desde V1-E9a/0.078 un
 * desarrollo engendra **un modelo de producción por color** y cada uno tiene su OP — que es
 * exactamente el «grupo» del que Daniel habla: *«Me dan 4 pedidos diferentes, uno por color»*
 * (§Post-F9.135).
 *
 * ⚠️ **El pedido interno NO es la familia**, y esa frase suya lo zanja: los cuatro colores llegan en
 * **cuatro pedidos distintos**. (`ordenesDelPedidoDeOrden`, en `compras/mrp.ts`, sí agrupa por
 * pedido — pero contesta otra pregunta: *«¿qué OP conviene comprar juntas?»*, no *«¿cuáles deberían
 * ir iguales?»*. Son dos universos y no se mezclan.)
 *
 * ⚠️ **El renglón de pedido tampoco**, y por una razón distinta de la que parece: un renglón sí puede
 * dar VARIAS órdenes —los resurtidos; lo dice `salida-produccion.ts`: *«el backend F2 modela N
 * órdenes por renglón»*—, pero **los cuatro colores de Daniel no comparten renglón**: cada OC del
 * cliente entra como su propio pedido con su propio renglón. Agrupar por ahí juntaría los
 * resurtidos de UNA OC y dejaría fuera justo a las hermanas que hay que comparar.
 *
 * **Fuera del grupo, con su razón:**
 *  • la orden **cancelada** — mismo criterio que `conjuntosDeLasOrdenesDelModelo`: lo cancelado no es
 *    un compromiso con nadie. Y una OP cancelada tampoco RECIBE aviso: no está en el grupo.
 *  • la orden de **otra empresa** (A9).
 *  • la orden **sin receta congelada** — leer «no tiene nada congelado» como «no lleva nada»
 *    encendería un aviso enorme y falso. No es raro: **2 577 de las ~3 900 órdenes migradas (2 de
 *    cada 3) tienen un modelo SIN BOM**, así que su copia sólo pudo nacer vacía
 *    (`dominio/produccion/migracion.ts`).
 *  • ⭐⭐ la orden cuya receta **la escribió la MIGRACIÓN** y nadie ha tocado — ver la sección de
 *    abajo.
 *
 * Las dos exclusiones **se cuentan** (`fueraDeLaComparacion`) y viajan **redactadas**
 * (`notaFueraDeLaComparacion`). Dónde se ven, exactamente: el **banner de la receta las dice
 * siempre**, incluso cuando no hay ninguna diferencia —ése es el caso que hay que destapar—; los
 * **chips** de lista las llevan en su `title`, y por tanto sólo cuando el chip aparece. Una
 * exclusión callada es peor que ninguna.
 *
 * ---
 * ## 🔴🔴 POR QUÉ EL HISTÓRICO NO VOTA — y cómo casi se cuela lo contrario
 *
 * ⚠️ **Y «migración» aquí quiere decir BACKFILL, no sólo «el ETL de Access».** Medido: la marca la
 * escriben TRES caminos y cubren tres poblaciones distintas:
 *  1. el **ETL de Access** (`crearOrdenMigrada`), orden por orden;
 *  2. el **backfill de `20260815140000`**, que copió el BOM a **toda orden que ya existía**
 *     —`FROM "ordenes" o JOIN "modelo_tela" mt`, **sin un solo filtro**— ⇒ **también las órdenes
 *     capturadas A MANO en v2 antes del 15-ago-2026 llevan la marca**;
 *  3. el backfill de `20260819120000`, que bajó esa firma al renglón (copiando el autor, así que no
 *     fabrica nulos donde había una persona).
 * ⇒ El predicado real es *«receta escrita por algún BACKFILL y nunca firmada por una persona»*.
 * Conductualmente da igual —ninguna de las tres es una receta que alguien decidió—, pero llamarlas
 * a todas «el histórico de Access» sería falso, y el siguiente lector lo comprobaría.
 *
 * **El ETL SÍ escribe las tres copias congeladas.** No las nombra: las escribe **por el dominio**
 * (`migracion/loaders/ordenes.ts` → `dominio/produccion/migracion.ts` → `copiarRecetaDelModelo(…,
 * { sinPrecios: true })`), y firma los tres renglones. Buscar el nombre de la tabla en
 * `backend/migracion/` devuelve una sola coincidencia —una LECTURA de un script de análisis— y de
 * ahí salió la conclusión contraria. **En esta casa eso ya tiene nombre: el `grep` confirma, nunca
 * descubre.** La prueba lo decía en el título desde antes:
 * `etl-pedidos-ordenes.int.test.ts` — *«la orden migrada nace con SU receta congelada, LIBERADA y
 * sin precios»*.
 *
 * **La consecuencia, que es lo grave:** este módulo agrupa por «NO cancelada», así que una OP
 * entregada en 2019 **sigue en el grupo y VOTA, para siempre**. (⚠️ Desde 0.061 `EstadoOrden` SÍ
 * tiene un estado `cerrada` —y `Orden.cerradaEn`—, pero **este módulo todavía no lo usa**: el
 * filtro sigue siendo «no cancelada». O sea que el hecho cambió y el comportamiento no. Quien vaya
 * a acotar el grupo algún día ya tiene la palanca: excluir las CERRADAS, que es exactamente «las
 * que ya terminaron».) Un modelo con N órdenes históricas —las N con la MISMA copia, la del día del
 * ETL— más una OP nueva creada después de que el BOM evolucionó da **N contra 1**, y la señalada
 * sería **la nueva y correcta**. Eso **invierte** el aviso que Daniel pidió. Y de paso duplicaría
 * uno que ya existe: *«el modelo se movió»* es literalmente lo que reporta la comparación VERTICAL.
 *
 * ⚠️ **Y no es REGLA 0-B**: ahí el dato viejo FALTA y hay que tolerarlo; aquí **está y le gana la
 * votación al nuevo**. Tolerar no es dejar que mande.
 *
 * ---
 * ## ⚠️⚠️ LO QUE ESTE RECORTE CUESTA — medido, y dicho entero
 *
 * Apartar el histórico **acota de más**, y hay que decir exactamente dónde:
 *
 * > **Sobre una familia cuya receta viene de un backfill, el aviso NO HABLA hasta que DOS de sus OP
 * > tengan receta decidida por una persona.**
 *
 * 🔴 **Y eso incluye el caso estrella de Daniel.** Familia migrada de cuatro, le cambian el cierre
 * **sólo a la café** (un renglón `agregadoAMano`): las tres hermanas migradas no votan, la café se
 * queda sin grupo y **no sale aviso**. Tampoco lo dice la comparación VERTICAL, que calla los
 * renglones `agregadoAMano` a propósito (`desviadoAProposito`) ⇒ **la divergencia vuelve a ser
 * invisible**, que es justo lo que esta etapa vino a terminar. Y en el **Centro de Órdenes esa fila
 * sale limpia**: el chip sólo aparece cuando hay aviso, así que ahí no se ve ni la nota. Sólo el
 * banner de la receta dice que la familia quedó fuera.
 *
 * ⚠️ **El alcance exacto, que no es el mismo para los dos casos de Daniel:**
 *  • **cierre café** (`agregadoAMano`): la OP **SÍ entra** al grupo —agregar a mano le quita la
 *    marca—; lo que le faltan son hermanas con quien compararse.
 *  • **jareta** (`quitarRenglonReceta`): llegó a ser **PEOR** —la propia OP quedaba **fuera** de la
 *    comparación, ni siquiera se comparaba— porque quitar **no revoca la firma**. **Ya está
 *    corregido**: una lápida `ajustado` cuenta como decisión de una persona
 *    (ver {@link OrdenParaComparar.escritaPorLaMigracion}).
 *
 * ✅ **NO ES UN DEFAULT NUESTRO: DANIEL LO CONFIRMÓ.** Textual:
 *
 * > *«Como dijimos. La información que no se genera en este sistema, puede no tener todas las cosas
 * > que tiene este sistema. Va a migrar la información que hay. **Lo que no haya no importa.**
 * > Asumo que las órdenes viejas no tengan todas las funciones que las nuevas generadas en este
 * > sistema.»*
 *
 * ⚠️ Léase con precisión: lo que ratificó es **el principio** —lo migrado no tiene por qué traer
 * todas las funciones de v2, y lo que falte no importa—, que es exactamente el encuadre de REGLA
 * 0-B, y bajo él cae este recorte. No revisó este mecanismo renglón por renglón. La decisión, con
 * su cita, la registra el lead en `DECISIONES.md`.
 *
 * 🔴 **Y que él lo apruebe NO vuelve verdadero lo de abajo: el coste sigue teniendo que estar
 * escrito entero**, y la MITIGACIÓN importa más, no menos — es lo único que convierte *«mudo sobre
 * lo migrado»* en *«mudo hasta que se trabaje»*.
 *
 * **Por qué además es lo correcto de ingeniería.** Se midió la alternativa de dejar al histórico
 * «servir de referencia sin votar» y **reintroduce la inversión**: el caso bueno (una minoría
 * decidida frente a una mayoría migrada) y el malo (la OP nueva frente a N copias del backfill) son
 * indistinguibles **para la regla de la mayoría**, que es lo único que ese diseño mira. Entre un
 * silencio y un aviso que señala a la OP correcta se elige el silencio: un aviso invertido entrena a
 * la gente a ignorarlo, y de ahí no se vuelve.
 *
 * ⚠️ **Pero no son indistinguibles EN ABSOLUTO, y la puerta queda abierta a propósito:** la receta
 * sí lleva señales de que una persona decidió —`agregadoAMano`, `excluido` con `ajustado`, el
 * `estado`— y es exactamente por ahí por donde este módulo ya reconoce a las órdenes trabajadas.
 * Una regla futura más fina podría usarlas para dejar votar sólo a las hermanas curadas; no se hizo
 * aquí porque no hacía falta para lo que Daniel pidió, no porque sea imposible.
 *
 * ⭐⭐ **Y LA MITIGACIÓN, que es lo que hace tolerable el límite: el silencio NO ES PERMANENTE.**
 * Una orden **vuelve al grupo en cuanto alguien toca de verdad su receta**. Va enumerado, y no
 * resumido, porque «trabajarla» es demasiado vago: hay actos que cualquiera llamaría trabajar la
 * receta y que NO la devuelven, y con la frase corta quedaban tapados.
 *
 * ⚠️ **La lista se armó enumerando las ESCRITURAS a `OrdenTela`/`OrdenAvio`/`OrdenArte`/
 * `OrdenAvioTalla` en todo `src/`, no leyendo `receta-orden.ts`.** La primera versión de esta tabla
 * se hizo por módulo y **se dejó fuera a `compras/proveedor-de-orden.ts`**, que escribe las mismas
 * tablas desde otro módulo y con otro permiso. Es la misma lección que abre este archivo, aplicada
 * al revés: **enumera por la TABLA que se toca, no por el módulo que crees su dueño.** Los cuatro
 * escritores son `receta-orden.ts`, `produccion/migracion.ts` (el ETL), `pruebas/receta.ts` (el
 * sembrador de fixtures) y `compras/proveedor-de-orden.ts`.
 *
 * | Acto sobre la receta de una OP de backfill | ¿Vuelve al grupo? | Por qué |
 * |---|---|---|
 * | **Firmarla** (`liberarReceta`) | ✅ sí | escribe su id en `liberadoPorId` y la marca cae |
 * | **Quitar un renglón** — la jareta (`quitarRenglonReceta`) | ✅ sí | deja la lápida `ajustado`, que es una decisión |
 * | **Agregar** un renglón a mano | ✅ sí | nace sin firma ⇒ un vivo sin la marca |
 * | **Editar** un renglón (cambia el contenido) | ✅ sí | `enRecetaEditable` le revoca la firma |
 * | **Restaurar** una lápida / **traer del modelo** | ✅ sí | los renglones nacen o vuelven sin firma |
 * | **Corregir la captura de un avío** (`corregirCapturaAvio`) — sobre un renglón **VIVO** | ✅ sí | `ctx.tocoRenglon` ⇒ le revoca la firma |
 * | 🔴 …el MISMO acto **sobre una LÁPIDA** | ❌ **NO** (†) | `ctx.cayoSobreLapida()`: no revoca **y no marca `ajustado`** |
 * | 🔴 **«Marcar todo revisado»** (`marcarRecetaRevisada`) | ❌ **NO** | sólo mueve `estado`; **no toca la firma** — medido |
 * | 🔴 **Reabrir / cerrar la receta** (`abrirReceta`/`cerrarReceta`) | ❌ **NO** | escriben en la ORDEN (`recetaAbiertaEn`); *«reabrir sólo marca: NO desfirma»* |
 * | 🔴 **Asignar el proveedor/precio de compra** (`compras/proveedor-de-orden.ts`) | ❌ **NO** | escribe `idProveedorCompra`/`precioCompra` en el renglón, fuera de `enRecetaEditable` y sin tocar la firma |
 *
 * 🔴 **Los cuatro renglones rojos son los cuadrantes donde la frase corta mentía**, y el último es
 * el más incómodo: un comprador que elige **con qué proveedor y a qué precio** se compra la tela de
 * esa OP diría sin dudar que trabajó esa receta. **Que no la devuelva es correcto** —proveedor y
 * precio están fuera de la comparación por diseño (§Post-F9.82: el precio haría ruido constante)—,
 * pero callarlo dejaba la tabla presentándose como exhaustiva sin serlo, y **una enumeración
 * incompleta es peor que ninguna**: se lee como una garantía.
 *
 * Lo mismo con los otros tres: marcar revisado es el botón en bloque que existe porque *«el 89 % de
 * las órdenes lleva la receta del modelo tal cual»*, reabrir es literalmente *«voy a corregir
 * esto»*, y corregir una lápida es inofensivo a propósito. Ninguno dice que la receta sea distinta,
 * así que ninguno debe devolverla — pero hay que decirlo en vez de dejar que la frase lo tape.
 *
 * ⚠️ **(†) Ese renglón NO tiene consecuencia alcanzable hoy, y decirlo importa para no leerlo como
 * un agujero.** Enumerados los escritores de `excluido: true` sobre las tres tablas, **el único es
 * `quitarRenglonReceta`, que siempre pone `ajustado`** ⇒ toda lápida REAL ya es una decisión y su
 * orden ya está DENTRO del grupo antes de que nadie corrija nada. La fila está para que nadie
 * suponga que el acto pesa por su cuenta; la comprobación de `ajustado` en el predicado es, por la
 * misma razón, **defensa en profundidad**: hoy `excluido` bastaría, y se pide `ajustado` para que un
 * escritor futuro que cree lápidas de otra forma no entre solo.
 *
 * En resumen: lo que calla es el pasado **que nadie ha tocado**, no el futuro.
 *
 * ---
 * ## QUÉ CUENTA COMO «DISTINTO»
 *
 *  1. **El CONJUNTO de materiales** — que esta OP lleve uno que las otras no, o que le falte uno que
 *     las otras sí. Un renglón **excluido** (la lápida de la jareta) NO se lleva: es precisamente el
 *     *«se decidió que ESTA orden no lo lleva»*, y por eso cuenta como diferencia.
 *  2. **La CANTIDAD congelada** — `consumoPorPrenda`, más (en avíos R18) el modo de captura
 *     `consumoPorTalla` y las medidas por talla.
 *
 * ⚠️ **El PRECIO NO cuenta, y no es un olvido.** El precio se negocia por proveedor y por momento
 * (§Post-F9.43/.48: el precio que costea la receta del modelo ES la última compra real), así que dos
 * hermanas nacidas con una semana de diferencia congelan precios distintos **sin que nadie haya
 * tocado nada**. Encender por eso sería ruido de fondo permanente — el mismo error que
 * `precio-mercado` vino a corregir en la comparación vertical.
 *
 * ⚠️ **El COLOR de la tela (`OrdenTelaColor`) tampoco.** Es por-orden **por diseño** (§Post-F9.89:
 * *«Dos OP del mismo modelo compran colores distintos sin pisarse»*) — que difiera es lo esperado,
 * no una desviación. Marcarlo dejaría a **toda** familia por color en rojo permanente.
 *
 * ---
 * ## LA REGLA DE QUIÉN SE DESVÍA — y por qué hay un caso de empate
 *
 * Para cada material se agrupan las OP por su VALOR (lo lleva / no lo lleva / con qué cantidad):
 *  • **un solo valor** → todas de acuerdo, no hay nada que decir;
 *  • **un grupo estrictamente más grande que los demás** → ése es «la norma», y sólo se avisa a los
 *    que están fuera de él. Es el caso de Daniel: 3 hermanas con el cierre negro y la café con otro
 *    ⇒ **se enciende una sola OP**, no cuatro;
 *  • **empate en el máximo** (2 vs 2, o dos hermanas que no coinciden) → **no hay norma**, y se avisa
 *    a todas. Callar aquí escondería un grupo partido justo cuando nadie puede decir cuál es el bueno
 *    — el mismo criterio que `conjuntosDeLasOrdenesDelModelo` aplica a las curvas: *«una regla de
 *    desempate inventada fallaría en silencio justo en el caso en que importa»*.
 *
 * ---
 * ## AVISA; NUNCA BLOQUEA
 *
 * Nada de este módulo lanza, y nadie lo llama desde una guarda. La diferencia **es legítima**. Es el
 * mismo criterio que `avisoCurvaDistinta` y §Post-F9.64: *«que me diga»*, no *«que no me deje»*.
 *
 * A1: la regla vive AQUÍ y los textos los redacta el servidor; las pantallas (la receta de la OP y
 * el Centro de Órdenes) sólo pintan lo que este módulo devuelve. A9: siempre por la empresa activa.
 * **Ni migración, ni permisos, ni seed**: se calcula en vivo y viaja con lecturas que ya existen.
 */
import type {
  DiferenciaConHermanas,
  FrenteAlGrupo,
  TipoRenglonRecetaClave,
} from '../../contrato/index.js';
import { EstadoRenglonReceta, type PrismaClient } from '../../datos/index.js';

import type { Tx } from '../../comun/transaccion.js';

import { claveMaterial } from '../compras/comprometido-en-oc.js';
import { num } from '../costos/decimales.js';
import { idModeloDeLaReceta, SELECT_LINAJE_RECETA } from '../modelos/receta-compartida.js';

/** Cualquier cliente con el que se puede LEER (dentro o fuera de transacción). */
type Lector = Tx | PrismaClient;

/**
 * Cuántos folios de hermanas se enseñan. Los suficientes para reconocer el grupo, no un listado —
 * mismo criterio y mismo número que `MAX_FOLIOS_MOSTRADOS` de `catalogos/curvas-de-la-orden.ts`.
 */
const MAX_FOLIOS = 5;

/** Cuántos materiales se nombran en el resumen de una línea antes de resumir con «y N más». */
const MAX_MATERIALES_EN_RESUMEN = 3;

/**
 * Decimales con los que se compara una cantidad. **No es una tolerancia**: es la escala EXACTA con
 * la que Postgres la guarda (`Decimal(12,4)` en `OrdenTela.consumoPorPrenda`,
 * `OrdenAvio.consumoPorPrenda` y `OrdenAvioTalla.consumo`), así que redondear ahí no pierde nada y
 * elimina de raíz el ruido del binario flotante al convertir de `Prisma.Decimal` a `number`.
 */
const DECIMALES = 4;

// ── 1. LA FORMA que la comparación necesita ────────────────────────────────────────────────

/** Un material congelado de una OP, reducido a lo que la comparación horizontal mira. */
export interface MaterialDeLaOp {
  tipo: TipoRenglonRecetaClave;
  /**
   * Identidad del material DENTRO de su tipo. Para telas y avíos es la misma
   * {@link claveMaterial} que usan el MRP y las guardas de compra (`tela-7`, `avio-3`): una segunda
   * definición de «qué material es éste» se escribe distinta en la primera corrección.
   */
  clave: string;
  /** Cómo se le nombra en el aviso. */
  nombre: string;
  /**
   * Consumo por prenda congelado. `null` = **este tipo no tiene cantidad** (el ARTE: se vigila que
   * exista, igual que hace la comparación vertical, que para el arte tampoco mira consumo).
   */
  consumoPorPrenda: number | null;
  /** Avíos R18: ¿la cantidad se captura POR TALLA? (`OrdenAvio.consumoPorTalla`). */
  porTalla: boolean;
  /**
   * Avíos R18: medida congelada por talla. Vacío si no aplica.
   *
   * ⚠️ Lleva la **etiqueta** y el **orden** de la talla, no sólo el consumo, porque el aviso tiene
   * que poder DECIR en qué tallas difiere: *«CH 2 · M 3»* frente a *«CH 2 · M 9»*. Sin ellos el
   * texto de los dos lados salía idéntico y el aviso se leía como un defecto (ver {@link valorDe}).
   */
  medidas: ReadonlyMap<number, MedidaDeTalla>;
}

/** La medida congelada de una talla, con lo que hace falta para NOMBRARLA en el aviso. */
export interface MedidaDeTalla {
  consumo: number;
  /** Cómo se llama la talla ("CH", "M"): es lo que se enseña. */
  etiqueta: string;
  /** Posición en la escala canónica (`Talla.orden`): es como se ORDENAN en el texto. */
  orden: number;
}

/** Una OP lista para compararse con sus hermanas. */
export interface OrdenParaComparar {
  idOrden: number;
  folio: number;
  /** Linaje del modelo (`idModeloDesarrollo ?? idModelo`): es lo que hace hermanas a dos OP. */
  idLinaje: number;
  /** Materiales VIVOS (los excluidos ya NO están aquí: una lápida es «no lo lleva»). */
  materiales: readonly MaterialDeLaOp[];
  /**
   * ¿Esta OP tiene **alguna** fila en las tres tablas de receta congelada? `false` = no hay nada que
   * comparar. Es distinto de `materiales: []`, que significa *«tiene receta y la excluyó entera»* —
   * un dato deliberado, no un hueco.
   *
   * ⚠️ **`false` NO es sinónimo de «migrada»**: el ETL SÍ escribe receta (ver
   * {@link escritaPorLaMigracion}). Aquí caen las órdenes del viejo **cuyo modelo no tenía BOM** —
   * 2 577 de las ~3 900, según `dominio/produccion/migracion.ts` — porque su copia sólo pudo nacer
   * vacía.
   */
  tieneReceta: boolean;
  /**
   * ⭐⭐ **¿Esta receta la escribió un BACKFILL y nadie la ha firmado desde entonces?**
   *
   * ⚠️ «Backfill», no «el ETL de Access»: son TRES poblaciones (el ETL, el backfill de
   * `20260815140000` —que alcanzó **también a las órdenes capturadas a mano en v2 antes del
   * 15-ago**— y el que bajó la firma al renglón). Ninguna es una receta que una persona decidiera,
   * que es lo único que la comparación necesita saber.
   *
   * 🔴 **Es lo que impide que el aviso diga lo contrario de lo que Daniel pidió.** El ETL
   * (`migracion/loaders/ordenes.ts` → `dominio/produccion/migracion.ts`) llama a
   * `copiarRecetaDelModelo` y **congela el BOM del modelo tal como estaba el día de la carga**, en
   * ~1 346 órdenes; el backfill de `20260815140000` hizo lo mismo con las que ya existían. Como `EstadoOrden` **no tiene estado de cerrada** (`capturada|completa|
   * cancelada`), una OP entregada en 2019 sigue en el grupo **para siempre** y VOTA. Un modelo con
   * N órdenes históricas —las N con la MISMA copia, la del día del ETL— más una OP nueva creada
   * después de que el BOM evolucionó da **N contra 1**: la señalada sería **la nueva y correcta**.
   *
   * Y ese aviso, además de estar invertido, **duplicaría uno que ya existe**: «el modelo se movió
   * desde que se congeló esta receta» es exactamente lo que reporta la comparación VERTICAL
   * (`calcularDesalineacion`). Aquí sólo debe votar una receta que alguien DECIDIÓ.
   *
   * ⚠️ **No es REGLA 0-B.** Ahí el dato viejo FALTA y hay que tolerarlo; aquí **está y le gana la
   * votación al nuevo**. Tolerar no es dejar que mande.
   */
  escritaPorLaMigracion: boolean;
}

// ── 2. EL EMBUDO: la comparación, PURA (sin base de datos) ─────────────────────────────────

/** El valor que una OP le da a un material: `null` = no lo lleva. */
interface ValorMaterial {
  /** Firma comparable como texto: dos OP con la misma firma llevan lo mismo. */
  firma: string;
  /** Cómo se dice esa cantidad en el aviso, o `null` cuando el tipo no tiene cantidad (arte). */
  texto: string | null;
}

/** Formatea una cantidad para el texto del aviso (sin ceros de relleno molestos). */
function cifra(valor: number): string {
  return String(Number(valor.toFixed(DECIMALES)));
}

/** «OP 5561, 5562» — los folios de un grupo, en orden y recortados. */
function folios(lista: readonly number[]): string {
  const ordenados = [...lista].sort((a, b) => a - b);
  const mostrados = ordenados.slice(0, MAX_FOLIOS);
  const resto = ordenados.length - mostrados.length;
  const texto = `OP ${mostrados.join(', ')}`;
  return resto > 0 ? `${texto} y ${String(resto)} más` : texto;
}

/** Singular/plural de «hermana», resuelto por el servidor (la pantalla no lo hace). */
function cuantasHermanas(cuantas: number): string {
  return cuantas === 1 ? 'su hermana' : `sus ${String(cuantas)} hermanas`;
}

/**
 * El VALOR de un material en una OP.
 *
 * ## Las medidas por talla, y las DOS trampas que hay entre ellas
 *
 * **1. Comparar tallas que no todas piden sería avisar de una diferencia del PEDIDO.**
 * `reemplazarMedidasAvio` borra y recrea las filas con las tallas que manda la pantalla, y esa
 * pantalla arma su matriz con las tallas de LA ORDEN (§Post-F9.43/N4). Dos hermanas con curvas
 * distintas acaban con juegos de tallas distintos **sin que nadie haya tocado la receta**. Por eso
 * lo normal es comparar sobre el **corte común** del grupo.
 *
 * **2. 🔴 Pero un corte común mal calculado APAGA la comparación entera, en silencio.** Medido: si
 * la intersección se toma sobre *todas* las OP que llevan el material —incluida una que captura
 * **por prenda**, cuyo mapa está vacío con toda razón— el corte se vacía y **dos hermanas con
 * medidas distintas dejan de avisar**. Y con una tercera de curva **disjunta**, no avisa NADIE. Por
 * eso el corte se calcula **sólo con las OP que capturan por talla** ({@link tallasComparables}), y
 * si aun así queda vacío con dos o más capturando por talla, `tallas` llega **`null`** y aquí se
 * compara el **mapa COMPLETO**: preferimos un aviso de más —que la persona resuelve mirando— a un
 * guardián que se apaga solo.
 */
function valorDe(m: MaterialDeLaOp, tallas: readonly number[] | null): ValorMaterial {
  if (m.consumoPorPrenda === null) {
    // Sin cantidad (arte): lo único comparable es que EXISTA, y eso ya lo dice llevar la clave.
    return { firma: 'presente', texto: null };
  }
  const porPrenda = m.consumoPorPrenda.toFixed(DECIMALES);
  if (!m.porTalla) {
    return { firma: `P|${porPrenda}`, texto: cifra(m.consumoPorPrenda) };
  }
  // `null` = sin corte común utilizable ⇒ entra el mapa entero de cada OP.
  const claves = tallas === null ? [...m.medidas.keys()] : [...tallas];
  /*
   * 🔴 **El TEXTO enseña las MISMAS tallas que entran en la firma, y ésa es la corrección.** Antes
   * el mapa iba sólo a la firma y el texto decía *«1 por talla»* en los dos lados: el aviso
   * afirmaba que hay una diferencia y el detalle enseñaba dos frases IDÉNTICAS. Eso incumple el
   * propósito del módulo —no obligar a comparar a mano— y, peor, se lee como un defecto.
   *
   * Se ordenan por la escala canónica (`Talla.orden`), no por id: es el orden en que la persona ve
   * las tallas en la matriz.
   */
  const enOrden = claves
    .map((idTalla) => ({ idTalla, medida: m.medidas.get(idTalla) }))
    .sort(
      (a, b) =>
        (a.medida?.orden ?? 0) - (b.medida?.orden ?? 0) ||
        (a.medida?.etiqueta ?? '').localeCompare(b.medida?.etiqueta ?? '', 'es') ||
        a.idTalla - b.idTalla,
    );
  const firma = enOrden
    .map(({ idTalla, medida }) => `${String(idTalla)}:${(medida?.consumo ?? 0).toFixed(DECIMALES)}`)
    .join(',');
  const porTallaTexto = enOrden
    .map(({ medida }) => `${medida?.etiqueta ?? '—'} ${cifra(medida?.consumo ?? 0)}`)
    .join(' · ');
  return {
    firma: `T|${porPrenda}|${firma}`,
    // Sin ninguna talla comparable el texto no puede nombrar nada; decirlo así es más honesto que
    // enseñar un paréntesis vacío.
    /*
     * 🔴 **El texto lleva las DOS cosas que entran en la firma: la cifra por prenda Y las medidas.**
     * Con sólo las medidas, dos OP con el MISMO mapa y distinto `consumoPorPrenda` —dato real: lo
     * copia el ETL y lo edita `editarRenglonReceta`— salían con las dos mitades de la frase
     * idénticas: el mismo defecto de la ronda anterior, en el otro cuadrante. Si algo distingue la
     * firma, tiene que verse en el texto.
     *
     * Sin ninguna talla comparable no se enseña un paréntesis vacío: se dice sólo la cifra.
     */
    texto:
      porTallaTexto === ''
        ? `${cifra(m.consumoPorPrenda)} por talla`
        : `${cifra(m.consumoPorPrenda)} por talla (${porTallaTexto})`,
  };
}

/**
 * ⭐ Sobre qué tallas se comparan las medidas de un material dentro de una familia.
 *
 * `null` = **compara el mapa completo de cada OP**. Devuelve eso cuando hay dos o más OP capturando
 * por talla y su intersección queda VACÍA (curvas disjuntas): callar ahí sería apagar el guardián.
 *
 * ⚠️ **Sólo cuentan las OP con `porTalla === true`.** Una que captura por prenda tiene el mapa vacío
 * con toda razón, y meterla en la intersección la vacía — que es exactamente el defecto que esta
 * función existe para cerrar.
 */
function tallasComparables(deLaFamilia: readonly MaterialDeLaOp[]): readonly number[] | null {
  const porTalla = deLaFamilia.filter((m) => m.porTalla);
  if (porTalla.length === 0) return [];
  let comun: number[] | null = null;
  for (const m of porTalla) {
    comun = comun === null ? [...m.medidas.keys()] : comun.filter((t) => m.medidas.has(t));
  }
  const interseccion = comun ?? [];
  return interseccion.length === 0 && porTalla.length >= 2 ? null : interseccion;
}

/**
 * Cómo se dice, en el aviso, lo que una OP hace con un material. El singular/plural lo resuelve el
 * SERVIDOR (A1): la pantalla no conjuga nada.
 */
function comoSeDice(valor: ValorMaterial | null, plural: boolean): string {
  const verbo = plural ? 'llevan' : 'lleva';
  if (valor === null) return `no lo ${verbo}`;
  return valor.texto === null ? `lo ${verbo}` : `${verbo} ${valor.texto}`;
}

/**
 * Firma reservada para «esta OP no lleva ese material». No puede chocar con ninguna que devuelva
 * {@link valorDe} (todas empiezan por `presente`, `P|` o `T|`).
 */
const FIRMA_NO_LO_LLEVA = '';

/** Las OP de una familia que le dan EL MISMO valor a un material. */
interface CuboDelGrupo {
  /** `null` = las de este cubo NO llevan el material. */
  valor: ValorMaterial | null;
  idsOrden: number[];
  folios: number[];
}

/** Todo lo que se sabe de un material dentro de una familia, ya agrupado por valor. */
interface MaterialDelGrupo {
  tipo: TipoRenglonRecetaClave;
  nombre: string;
  /** Firma del valor → las OP que lo tienen. {@link FIRMA_NO_LO_LLEVA} es «no lo lleva». */
  porFirma: Map<string, CuboDelGrupo>;
}

/**
 * ⭐ **LA REGLA**: qué materiales están en desacuerdo dentro de una familia y a quién se le avisa.
 * PURA a propósito (no toca la base) para poder probarla, mutarla y leerla de un vistazo.
 *
 * Recibe **todas** las OP de golpe —de una o de muchas familias— y agrupa por `idLinaje` ella misma:
 * la comparación es **de grupo**, no de a una, y quien la llamara orden por orden pagaría N×N y
 * además podría mezclar familias. El `Map` de salida está indexado por `idOrden`, que es lo que
 * impide el defecto clásico del lote: **darle a una orden los datos de otra**.
 */
export function compararConHermanas(
  ordenes: readonly OrdenParaComparar[],
): Map<number, FrenteAlGrupo> {
  const salida = new Map<number, FrenteAlGrupo>();

  // 1. Las familias, y dentro de cada una las que de verdad se pueden comparar.
  const familias = new Map<number, OrdenParaComparar[]>();
  for (const orden of ordenes) {
    const familia = familias.get(orden.idLinaje) ?? [];
    familia.push(orden);
    familias.set(orden.idLinaje, familia);
  }

  for (const familia of familias.values()) {
    // 🔴 Fuera de la comparación por DOS razones distintas, las dos medidas y las dos grandes:
    //  • sin ninguna fila congelada (el modelo del viejo no tenía BOM: 2 577 órdenes), y
    //  • con receta escrita por la MIGRACIÓN y sin tocar (~1 346): si votara, N históricas con la
    //    copia del día del ETL señalarían a la OP nueva — el aviso al revés (ver
    //    {@link OrdenParaComparar.escritaPorLaMigracion}).
    const comparables = familia.filter((o) => o.tieneReceta && !o.escritaPorLaMigracion);
    const fuera = familia.length - comparables.length;

    // 2. Cada material de la familia, con quién lo lleva y con qué valor.
    //
    // ⚠️ **Indexar por clave —y no recorrer la lista— es lo que impide contar UNA orden dos veces
    // en su propio cubo.** Telas y avíos no pueden repetirse dentro de una orden
    // (`@@unique([idOrden, idTela])` / `([idOrden, idAvio])`), pero **dos artes agregados a mano con
    // la misma descripción SÍ caen en la misma clave** ({@link claveArte}). Sobre una lista, esa
    // orden entraría dos veces en el mismo grupo de valor y **le voltearía la mayoría** a sus
    // hermanas — con tres OP, un 1-contra-2 se leería como empate y encendería las tres.
    //
    // El `if` de abajo no es el que deduplica (el `Map` ya lo hace): lo que decide es **cuál de las
    // dos filas gana**, y gana la PRIMERA para que el resultado no dependa del orden en que la base
    // devuelva las filas.
    const materialesDe = new Map<number, Map<string, MaterialDeLaOp>>();
    for (const orden of comparables) {
      const porClave = new Map<string, MaterialDeLaOp>();
      for (const m of orden.materiales) {
        if (!porClave.has(m.clave)) porClave.set(m.clave, m);
      }
      materialesDe.set(orden.idOrden, porClave);
    }

    // Sobre qué tallas se comparan las medidas: depende del GRUPO entero, no de una orden suelta,
    // así que se resuelve ANTES de firmar y con la regla única de {@link tallasComparables}.
    const delGrupo = new Map<string, MaterialDeLaOp[]>();
    for (const porClave of materialesDe.values()) {
      for (const m of porClave.values()) {
        delGrupo.set(m.clave, [...(delGrupo.get(m.clave) ?? []), m]);
      }
    }
    const tallasPorClave = new Map<string, readonly number[] | null>();
    for (const [clave, materialesDelGrupo] of delGrupo) {
      tallasPorClave.set(clave, tallasComparables(materialesDelGrupo));
    }

    const materiales = new Map<string, MaterialDelGrupo>();
    for (const orden of comparables) {
      for (const m of (
        materialesDe.get(orden.idOrden) ?? new Map<string, MaterialDeLaOp>()
      ).values()) {
        // ⚠️ Lectura explícita, NO `?? []`: `null` es el SENTINELA de «compara el mapa completo» y
        // el coalescing lo confundiría con «clave ausente», devolviendo `[]` — con lo que las tres
        // firmas salen idénticas y **nadie avisa**. Lo cazó una sonda, no la lectura del código.
        const tallas = tallasPorClave.get(m.clave);
        const valor = valorDe(m, tallas === undefined ? [] : tallas);
        const grupo = materiales.get(m.clave) ?? {
          tipo: m.tipo,
          nombre: m.nombre,
          porFirma: new Map<string, CuboDelGrupo>(),
        };
        const cubo = grupo.porFirma.get(valor.firma) ?? { valor, idsOrden: [], folios: [] };
        cubo.idsOrden.push(orden.idOrden);
        cubo.folios.push(orden.folio);
        grupo.porFirma.set(valor.firma, cubo);
        materiales.set(m.clave, grupo);
      }
    }

    // 3. Las que NO lo llevan también son un valor del grupo (la lápida excluida, o el renglón que
    //    nunca se copió). Sin este paso, «esta OP no lleva lo que las otras sí» sería invisible —
    //    y ése es literalmente el caso de la jareta.
    for (const [clave, grupo] of materiales) {
      for (const orden of comparables) {
        if (materialesDe.get(orden.idOrden)?.has(clave) === true) continue;
        const cubo = grupo.porFirma.get(FIRMA_NO_LO_LLEVA) ?? {
          valor: null,
          idsOrden: [],
          folios: [],
        };
        cubo.idsOrden.push(orden.idOrden);
        cubo.folios.push(orden.folio);
        grupo.porFirma.set(FIRMA_NO_LO_LLEVA, cubo);
      }
    }

    // 4. Las diferencias, orden por orden.
    const diferenciasPorOrden = new Map<number, DiferenciaConHermanas[]>();
    /**
     * ⭐ Con CUÁNTAS hermanas difiere cada OP — y no es lo mismo que cuántas tiene. Con cinco OP
     * repartidas 3-2, a cada minoritaria hay que decirle que difiere de **3**, no de sus «4
     * hermanas»: coincide exactamente con la otra minoritaria, y contarla la volvía una mentira
     * comprobable de un vistazo.
     */
    const difiereDe = new Map<number, Set<number>>();
    for (const grupo of materiales.values()) {
      if (grupo.porFirma.size < 2) continue; // todas de acuerdo

      const cubos = [...grupo.porFirma.values()];
      const mayorTamano = Math.max(...cubos.map((c) => c.idsOrden.length));
      const enElMaximo = cubos.filter((c) => c.idsOrden.length === mayorTamano);
      // Empate en el máximo = NO hay norma: se le avisa a todas (2 vs 2, o dos que no coinciden).
      const norma = enElMaximo.length === 1 ? (enElMaximo[0] ?? null) : null;

      for (const cubo of cubos) {
        if (norma !== null && cubo === norma) continue;
        const otros = cubos.filter((c) => c !== cubo);
        const que: DiferenciaConHermanas['que'] =
          cubo.valor === null
            ? 'no-la-lleva'
            : otros.every((o) => o.valor === null)
              ? 'solo-esta'
              : 'cantidad';
        const detalle =
          `«${grupo.nombre}»: esta OP ${comoSeDice(cubo.valor, false)} · ` +
          otros
            .map((o) => `${folios(o.folios)} ${comoSeDice(o.valor, o.folios.length > 1)}`)
            .join(' · ') +
          '.';
        const ajenas = otros.flatMap((o) => o.idsOrden);
        for (const idOrden of cubo.idsOrden) {
          const lista = diferenciasPorOrden.get(idOrden) ?? [];
          lista.push({ tipo: grupo.tipo, material: grupo.nombre, que, detalle });
          diferenciasPorOrden.set(idOrden, lista);
          const conjunto = difiereDe.get(idOrden) ?? new Set<number>();
          for (const ajena of ajenas) conjunto.add(ajena);
          difiereDe.set(idOrden, conjunto);
        }
      }
    }

    // 5. La salida por orden. Las que quedaron FUERA (sin receta, o receta de la migración) no
    //    reciben aviso —no hay nada suyo que comparar—, pero sí saben cuántas hermanas hay y
    //    cuántas se quedaron fuera: el silencio nunca puede confundirse con «no hay grupo».
    for (const orden of familia) {
      const comparada = comparables.includes(orden);
      /*
       * ⚠️⚠️ **`hermanas` NO SIRVE PARA SABER SI ESTA ORDEN ENTRÓ AL GRUPO, y es estructural:**
       * excluye a la propia orden, así que **su membresía nunca puede mover su propio conteo**. Si
       * entra, `comparables` crece en uno y el filtro quita exactamente ése ⇒ el número es el mismo
       * en los dos mundos. Cuenta cuántas OTRAS son comparables, y sólo eso.
       *
       * 🔴 Quien quiera probar que una orden fue COMPARADA tiene que mirar `aviso`/`diferencias`
       * (sólo una orden comparada produce diferencias) o el `fueraDeLaComparacion` **de OTRA** de la
       * familia. Ya costó una aserción en rojo en `hermanas-de-la-op.int.test.ts` y dos comentarios
       * que atribuían la prueba a esta cantidad; si vas a escribir `expect(...hermanas)`, pregúntate
       * primero de QUIÉN estás midiendo la membresía.
       */
      const hermanas = comparables.filter((o) => o.idOrden !== orden.idOrden);
      const diferencias = comparada ? (diferenciasPorOrden.get(orden.idOrden) ?? []) : [];
      // Si ESTA orden está fuera, ella misma no cuenta entre las que se quedaron fuera.
      const fueraDeLaComparacion = comparada ? fuera : fuera - 1;
      salida.set(orden.idOrden, {
        hermanas: hermanas.length,
        foliosHermanas: hermanas
          .map((h) => h.folio)
          .sort((a, b) => a - b)
          .slice(0, MAX_FOLIOS),
        fueraDeLaComparacion,
        diferencias,
        aviso: resumir(diferencias, difiereDe.get(orden.idOrden)?.size ?? 0, hermanas.length),
        notaFueraDeLaComparacion: notaDeLasQueQuedaronFuera(fueraDeLaComparacion),
      });
    }
  }

  return salida;
}

/**
 * El resumen de UNA línea, redactado por el servidor (A1). Nombra los materiales que difieren —un
 * chip que sólo dijera «distinta» obligaría a comparar a mano, que es justo lo que Daniel quiere
 * quitar—. `null` = no hay nada que avisar.
 *
 * ⚠️ **Dice con cuántas DIFIERE, no cuántas tiene.** Con cinco OP repartidas 3-2, decirle a una
 * minoritaria *«no va igual que sus 4 hermanas»* es falso: coincide exactamente con la otra
 * minoritaria. Cuando difiere de todas, la frase se queda corta y natural; cuando no, lo dice con
 * las dos cifras.
 */
function resumir(
  diferencias: readonly DiferenciaConHermanas[],
  difiereDe: number,
  hermanas: number,
): string | null {
  if (diferencias.length === 0) return null;
  const nombres = [...new Set(diferencias.map((d) => d.material))];
  const mostrados = nombres.slice(0, MAX_MATERIALES_EN_RESUMEN);
  const resto = nombres.length - mostrados.length;
  const lista = mostrados.map((n) => `«${n}»`).join(', ');
  const cola = resto > 0 ? ` y ${String(resto)} más` : '';
  const contra =
    difiereDe >= hermanas
      ? cuantasHermanas(hermanas)
      : `${String(difiereDe)} de sus ${String(hermanas)} hermanas`;
  return `Esta OP no va igual que ${contra}: ${lista}${cola}.`;
}

/**
 * ⭐ D3 — LA NOTA de las OP que quedaron FUERA de la comparación, **redactada por el servidor**.
 *
 * 🔴 Existe porque el número solo no bastaba: la pantalla lo enseñaba **únicamente dentro del aviso
 * de diferencias**, así que en el caso silencioso —el que la nota vino a destapar— era inalcanzable.
 * Y el chip no lo decía nunca. Con los números reales del histórico ése es el caso COMÚN.
 *
 * Se redacta aquí, y no en la pantalla, por lo mismo que el resto de los textos (A1): el
 * singular/plural es del servidor. `null` = no quedó ninguna fuera y no hay nada que decir.
 */
export function notaDeLasQueQuedaronFuera(cuantas: number): string | null {
  if (cuantas <= 0) return null;
  return cuantas === 1
    ? '1 OP del modelo quedó fuera de la comparación (es histórico migrado, o no tiene receta capturada).'
    : `${String(cuantas)} OP del modelo quedaron fuera de la comparación (son histórico migrado, o no tienen receta capturada).`;
}

/**
 * Lo que se pinta cuando una OP no tiene con quién compararse (o está cancelada).
 *
 * ⚠️ Es una FUNCIÓN y no una constante compartida a propósito: `FrenteAlGrupo` lleva arreglos, y un
 * único objeto repartido a todas las filas de una página es un alias — el día que alguien empuje
 * algo en `diferencias` se lo empujaría a TODAS. Devolver uno nuevo cuesta nada y cierra la clase
 * de defecto entera.
 */
export function sinHermanas(): FrenteAlGrupo {
  return {
    hermanas: 0,
    foliosHermanas: [],
    fueraDeLaComparacion: 0,
    diferencias: [],
    aviso: null,
    notaFueraDeLaComparacion: null,
  };
}

// ── 3. LA CARGA: de la base a la forma del embudo ──────────────────────────────────────────

/** `select` de un renglón de tela congelado, con lo mínimo que la comparación mira. */
const SELECT_TELA = {
  idOrden: true,
  idTela: true,
  excluido: true,
  estado: true,
  liberadoEn: true,
  liberadoPorId: true,
  consumoPorPrenda: true,
  tela: { select: { nombre: true } },
} as const;

/** `select` de un renglón de avío congelado (con sus medidas por talla, R18). */
const SELECT_AVIO = {
  idOrden: true,
  idAvio: true,
  excluido: true,
  estado: true,
  liberadoEn: true,
  liberadoPorId: true,
  consumoPorPrenda: true,
  consumoPorTalla: true,
  avio: { select: { clave: true, descripcion: true } },
  // ⚠️ `etiqueta`/`orden` no son adorno: son lo que permite al aviso DECIR en qué tallas difiere.
  tallas: {
    select: { idTalla: true, consumo: true, talla: { select: { etiqueta: true, orden: true } } },
  },
} as const;

/** `select` de un renglón de arte congelado. */
const SELECT_ARTE = {
  idOrden: true,
  idModeloArte: true,
  excluido: true,
  estado: true,
  liberadoEn: true,
  liberadoPorId: true,
  descripcion: true,
} as const;

/**
 * La IDENTIDAD de un renglón de ARTE dentro de su tipo.
 *
 * ⚠️ **El arte es la gemela que NO tiene la misma forma que las otras dos**, y se dice aquí en vez
 * de forzarla: no tiene `idMaterial` (su traza `idModeloArte` es NULL en los agregados a mano, donde
 * Postgres trata cada NULL como distinto) y **no tiene cantidad**. Así que:
 *  • los que vienen del modelo se casan por su traza —la misma identidad que ya usa
 *    `@@unique([idOrden, idModeloArte])` y la comparación vertical—, y
 *  • los AGREGADOS A MANO se casan por su **descripción normalizada**, que es el único campo visible
 *    que queda (§Post-F9.52 retiró el `nombre`). Dos hermanas que le pusieron a mano el mismo
 *    bordado con el mismo texto se reconocen; si lo escribieron distinto, salen como dos artes — que
 *    es lo honesto: el sistema no puede saber que son el mismo.
 *  • y su comparación es **sólo de presencia**: no hay «cantidad de arte» que difiera.
 */
function claveArte(f: { idModeloArte: number | null; descripcion: string }): string {
  return f.idModeloArte === null
    ? `arte-d-${f.descripcion.trim().toLocaleLowerCase('es').replace(/\s+/g, ' ')}`
    : `arte-m-${String(f.idModeloArte)}`;
}

/**
 * ⭐ **CÓMO VA CADA UNA DE ESTAS OP FRENTE A SUS HERMANAS** — la única puerta con base de datos, y
 * el único sitio del sistema que sabe armar esta comparación.
 *
 * Recibe **un conjunto** de órdenes (una sola desde la receta de la OP; la página entera desde el
 * Centro de Órdenes) porque el cálculo es **de grupo**: resolverlo orden por orden en una familia de
 * N colores costaría N×N consultas y, peor, obligaría a escribir la regla dos veces.
 *
 * **CINCO consultas, sea 1 orden o 100** (mismo criterio que los agregados por lote del Centro de
 * Órdenes: jamás un `await` por fila):
 *  1. el linaje de las órdenes pedidas,
 *  2. **todas** las órdenes NO CANCELADAS de esos linajes (las hermanas),
 *  3-5. las tres tablas de receta congelada de ese conjunto, de un tirón.
 *
 * ⚠️ **«No cancelada» NO es «viva», y la palabra importa:** el filtro de aquí sólo deja fuera las
 * CANCELADAS, así que una OP entregada en 2019 sigue en el conjunto para siempre. Decirle «vivas»
 * a este filtro fue justo lo que escondió que el histórico VOTABA (ver
 * {@link OrdenParaComparar.escritaPorLaMigracion}); quien acote esto algún día, que lo haga por el
 * ESTADO, no cambiando la palabra. **Desde 0.061 esa palanca ya existe** (`cerrada` /
 * `Orden.cerradaEn`) y este módulo, a propósito, TODAVÍA NO LA USA: acotar el grupo es una decisión
 * de negocio aparte, no un efecto colateral de que el estado se haya creado.
 *
 * El tamaño de lo que se trae lo manda el nº de LINAJES distintos de la página, no el de filas: en
 * el peor caso son las recetas de las OP vivas de esos modelos, unas decenas de renglones por OP.
 *
 * El `Map` devuelto va por `idOrden`. Una orden pedida que no aparezca (cancelada, de otra empresa,
 * inexistente) **simplemente no está**: quien llama pinta {@link sinHermanas} y no inventa nada.
 */
export async function frenteAlGrupoDeOrdenes(
  lector: Lector,
  idsOrden: readonly number[],
  idEmpresa: number,
): Promise<Map<number, FrenteAlGrupo>> {
  if (idsOrden.length === 0) return new Map();

  // 1. El linaje de las órdenes pedidas. Una CANCELADA no entra: no es del grupo (ni recibe aviso).
  const pedidas = await lector.orden.findMany({
    where: { id: { in: [...new Set(idsOrden)] }, idEmpresa, estado: { not: 'cancelada' } },
    select: { id: true, modelo: { select: SELECT_LINAJE_RECETA } },
  });
  if (pedidas.length === 0) return new Map();
  const linajes = [...new Set(pedidas.map((o) => idModeloDeLaReceta(o.modelo)))];

  // 2. TODA la familia de esos linajes. Las dos ramas del `OR` son las dos formas de pertenecer al
  //    linaje y hacen falta las dos: la orden cuyo modelo ES la raíz (todo lo migrado del Access y
  //    lo capturado a mano, donde `idModeloDesarrollo` es NULL) y la orden de un HIJO por color.
  //    ⚠️ El filtro es «no cancelada», que NO es «viva»: no hay estado de cerrada (ver el
  //    encabezado). Quien no debe VOTAR se aparta más abajo, por la marca de la migración.
  const familia = await lector.orden.findMany({
    where: {
      idEmpresa,
      estado: { not: 'cancelada' },
      OR: [{ idModelo: { in: linajes } }, { modelo: { idModeloDesarrollo: { in: linajes } } }],
    },
    select: { id: true, folio: true, modelo: { select: SELECT_LINAJE_RECETA } },
  });
  const idsFamilia = familia.map((o) => o.id);

  // 3-5. Las tres tablas de receta congelada, de golpe y **CON los excluidos**. Traerlos cuesta lo
  //      mismo y contesta las DOS preguntas de una sola lectura, que no son la misma:
  //       • *«¿esta orden tiene receta congelada?»* → ¿tiene ALGUNA fila, excluidos incluidos? Una
  //         orden que excluyó TODOS sus renglones **sí** tiene receta; filtrar antes la haría pasar
  //         por histórico del Access y la sacaría del grupo justo cuando más difiere.
  //       • *«¿qué LLEVA?»* → sólo las filas vivas. Una lápida es «no lo lleva», que es exactamente
  //         la diferencia que hay que ver (el caso de la jareta).
  const [telas, avios, artes] = await Promise.all([
    lector.ordenTela.findMany({ where: { idOrden: { in: idsFamilia } }, select: SELECT_TELA }),
    lector.ordenAvio.findMany({ where: { idOrden: { in: idsFamilia } }, select: SELECT_AVIO }),
    lector.ordenArte.findMany({ where: { idOrden: { in: idsFamilia } }, select: SELECT_ARTE }),
  ]);

  const conReceta = new Set<number>([
    ...telas.map((f) => f.idOrden),
    ...avios.map((f) => f.idOrden),
    ...artes.map((f) => f.idOrden),
  ]);

  /*
   * ⭐⭐ ¿La receta de esta orden la escribió un BACKFILL y nadie la ha firmado?
   *
   * **La marca no la inventa esta etapa: la declara el propio repo.** `20260815140000_receta_en_la_
   * orden/migration.sql:25` — *«`receta_liberada_por_id` queda NULL = "la liberó la migración",
   * distinguible de una persona»*—, y `schema.prisma` lo repite en `liberadoPorId`.
   *
   * ⚠️ **Cubre TRES poblaciones**, no sólo el histórico de Access: el ETL, el backfill de
   * `20260815140000` (que corrió **sin filtro** sobre `ordenes` ⇒ alcanzó a lo capturado a mano en
   * v2 antes del 15-ago) y el de `20260819120000`. Las tres tienen en común lo único que importa
   * aquí: **nadie las decidió**.
   *
   * Enumerados los escritores de esa columna en `src/`, el reparto no deja ambigüedad:
   *   • `migracion.ts:223` → `{ liberadoEn: fecha, liberadoPorId: null }` ← la migración;
   *   • `liberarReceta` (`receta-orden.ts:3089`) → `liberadoPorId: sesion.id` ← SIEMPRE una persona;
   *   • revivir lápida, traer del modelo y revocar → dejan los DOS en null (sin firma).
   * El backfill de `20260819120000` **copia** `receta_liberada_por_id` de la orden, así que tampoco
   * fabrica autores nulos donde había una persona.
   * ⇒ `liberadoEn != null && liberadoPorId == null` es exactamente *«firmada, y por nadie con
   * nombre»*.
   *
   * ⚠️ Hubo un SEXTO escritor y era una trampa: el sembrador de fixtures `pruebas/receta.ts`
   * firmaba con autor NULL, así que **cualquier prueba futura que sembrara dos hermanas con él
   * habría obtenido SILENCIO** y parecería que este módulo está roto. Ya firma con un id real.
   *
   * 🔑 **Por ORDEN, y con DOS condiciones**: que todos sus renglones vivos lleven la marca **y** que
   * no haya ninguna **lápida decidida** (`excluido` + `ajustado`). Basta que alguien haya tocado UN
   * renglón —editarlo le revoca la firma, volver a firmarlo la pone a su nombre, **quitarlo deja la
   * lápida**— para que la orden vuelva a la comparación: ya es una receta que una persona DECIDIÓ.
   *
   * 🔴 **La lápida hay que mirarla aparte y no es un detalle:** `quitarRenglonReceta` **no revoca la
   * firma a propósito**, así que la jareta dejaba la orden con todos sus vivos marcados y **la
   * apartaba de la comparación** — peor que el caso del cierre café, donde al menos entra.
   *
   * ⚠️ **Y exige al menos un renglón vivo**, porque un `every` sobre lista vacía es `true`: sin eso,
   * la orden que EXCLUYÓ toda su receta —la divergencia más fuerte que existe— se habría apartado
   * sola justo cuando más hay que verla.
   */
  const vivosPorOrden = new Map<number, { deLaMigracion: number; total: number }>();
  /**
   * ⭐⭐ Órdenes con una **LÁPIDA DECIDIDA** (`excluido` + `ajustado`): la jareta.
   *
   * 🔴 **Sin esto, quitar un renglón NO devolvía la orden al grupo, y eso es peor que el caso que
   * el módulo ya declara.** `quitarRenglonReceta` **no revoca la firma a propósito** (lo dice en su
   * propio comentario) y deja el renglón `excluido: true, estado: ajustado`. Como los vivos se
   * siguen contando sin él, TODOS seguían llevando la marca del backfill ⇒ la propia OP quedaba
   * **fuera de la comparación**: en el cierre café al menos entra y se queda sin hermanas; en la
   * jareta **ni siquiera se comparaba**.
   *
   * ⚠️ Y la firma no sirve para distinguirla: el backfill de `20260819120000` **firmó también los
   * excluidos** (*«Se firman TODOS los renglones (incluidos los `excluido`)»*), así que una lápida
   * puede llevar la marca. Lo que la distingue es `ajustado`, y el argumento no es que tenga un
   * único escritor —tiene **dos**— sino de dónde NO puede venir:
   *
   *  • `quitarRenglonReceta` la crea (`excluido: true, estado: ajustado`);
   *  • `editarRenglonReceta` también la deja así, porque **editar una lápida está permitido** y su
   *    `marca` pone `ajustado` sin tocar `excluido`;
   *  • …y **NINGÚN backfill escribe `ajustado`**: el `INSERT` de `20260815140000` (`:209-247`) pone
   *    literalmente `'sin_revisar', false, false`, y el de `20260819120000` sólo toca la firma.
   *
   * ⇒ Los dos escritores son **actos de una persona**, y la máquina no puede producir esta
   * combinación. Eso —y no la exclusividad— es lo que hace seguro el predicado.
   */
  const conLapidaDecidida = new Set<number>();
  const contar = (
    idOrden: number,
    r: { liberadoEn: Date | null; liberadoPorId: string | null },
  ) => {
    const cuenta = vivosPorOrden.get(idOrden) ?? { deLaMigracion: 0, total: 0 };
    cuenta.total += 1;
    if (r.liberadoEn !== null && r.liberadoPorId === null) cuenta.deLaMigracion += 1;
    vivosPorOrden.set(idOrden, cuenta);
  };
  for (const f of [...telas, ...avios, ...artes]) {
    if (f.excluido) {
      if (f.estado === EstadoRenglonReceta.ajustado) conLapidaDecidida.add(f.idOrden);
      continue;
    }
    contar(f.idOrden, f);
  }
  const escritaPorLaMigracion = (idOrden: number): boolean => {
    // Una lápida decidida basta para que la receta sea de una persona, aunque los vivos que queden
    // sigan siendo la copia del backfill: quitar la jareta ES decidir.
    if (conLapidaDecidida.has(idOrden)) return false;
    const cuenta = vivosPorOrden.get(idOrden);
    return cuenta !== undefined && cuenta.total > 0 && cuenta.deLaMigracion === cuenta.total;
  };

  const materialesPorOrden = new Map<number, MaterialDeLaOp[]>();
  const agregar = (idOrden: number, m: MaterialDeLaOp): void => {
    const lista = materialesPorOrden.get(idOrden) ?? [];
    lista.push(m);
    materialesPorOrden.set(idOrden, lista);
  };
  for (const t of telas) {
    if (t.excluido) continue;
    agregar(t.idOrden, {
      tipo: 'tela',
      clave: claveMaterial({ idTela: t.idTela, idAvio: null }),
      nombre: t.tela.nombre,
      consumoPorPrenda: num(t.consumoPorPrenda),
      porTalla: false,
      medidas: new Map(),
    });
  }
  for (const a of avios) {
    if (a.excluido) continue;
    agregar(a.idOrden, {
      tipo: 'avio',
      clave: claveMaterial({ idTela: null, idAvio: a.idAvio }),
      nombre: `${a.avio.clave} — ${a.avio.descripcion}`,
      consumoPorPrenda: num(a.consumoPorPrenda),
      porTalla: a.consumoPorTalla,
      medidas: new Map(
        a.tallas.map((t) => [
          t.idTalla,
          { consumo: num(t.consumo), etiqueta: t.talla.etiqueta, orden: t.talla.orden },
        ]),
      ),
    });
  }
  for (const ar of artes) {
    if (ar.excluido) continue;
    agregar(ar.idOrden, {
      tipo: 'arte',
      clave: claveArte(ar),
      nombre: ar.descripcion,
      // El arte NO tiene cantidad: se vigila que exista, igual que en la comparación vertical.
      consumoPorPrenda: null,
      porTalla: false,
      medidas: new Map(),
    });
  }

  const comparadas = compararConHermanas(
    familia.map((o) => ({
      idOrden: o.id,
      folio: Number(o.folio),
      idLinaje: idModeloDeLaReceta(o.modelo),
      materiales: materialesPorOrden.get(o.id) ?? [],
      tieneReceta: conReceta.has(o.id),
      escritaPorLaMigracion: escritaPorLaMigracion(o.id),
    })),
  );

  // Sólo se devuelve lo que se pidió: el resto de la familia se cargó para poder comparar, no para
  // publicarlo. (Y el `Map` va por id, que es lo que impide darle a una orden los datos de otra.)
  const pedidos = new Set(pedidas.map((o) => o.id));
  return new Map([...comparadas].filter(([idOrden]) => pedidos.has(idOrden)));
}
