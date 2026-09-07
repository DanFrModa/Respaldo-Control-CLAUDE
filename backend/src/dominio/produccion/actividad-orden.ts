/**
 * ⭐⭐ **«¿ESTA ORDEN YA TIENE VIDA?» — LA PREGUNTA, EN UN SOLO LUGAR** (fila 0.150).
 *
 * DANIEL, probando el flujo real: *«¿Qué pasa si me cancelan un pedido, pero la OC ya está
 * producida? **No quiero que se borren las OP en ese caso.** Pero si no hay nada comprado ni
 * producido y borra el pedido está bien cancelar en cascada.»*
 *
 * Hasta esta fila el sistema hacía justo lo contrario: `cancelarPedido` sólo miraba dos cosas —el
 * pedido ya cancelado y la orden CERRADA— y con la casilla de cascada marcada **cancelaba una OP
 * aunque ya estuviera cortada, enviada, comprada y auditada**. La cancelación es suave (D3), así
 * que no se pierde el dato; pero la orden desaparece de los tableros, del WIP y del MRP, y el piso
 * se queda sin la OP con la que está trabajando.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## 🔑 POR QUÉ ESTA FUNCIÓN Y NO `tieneActividadProduccion` A SECAS
 *
 * `tieneActividadProduccion` ({@link requisitos-orden.ts}) ya contestaba una pregunta parecida —y
 * por eso esta fila la **exportó y la reusa** en vez de escribir una cuarta copia del mismo
 * `count`—, pero contesta OTRA pregunta: *«¿puedo degradar el semáforo de completa a capturada?»*,
 * y para eso le basta con mirar `EtapaMovimiento`. No ve compras, ni tela surtida, ni notas de
 * salida, ni cierres de maquila, ni EsMa, ni costo, ni EDR. Copiar ese criterio aquí habría dejado
 * pasar —sin avisar— el pedido cuya tela ya se compró y se surtió: exactamente el caso de Daniel.
 *
 * Es la misma lección que `compras/comprometido-en-oc.ts` dejó escrita: **dos preguntas parecidas
 * llevan dos criterios distintos, cada uno escrito donde se usa** — y el que es más amplio REUSA al
 * más estrecho como una señal más, en vez de duplicarlo.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## ⚖️ QUÉ CUENTA COMO VIDA — y qué NO, con su razón
 *
 * **CUENTA** (ver {@link SENALES_EN_ORDEN}): la orden cerrada · la receta liberada o reabierta ·
 * etapas vivas (corte/envío/recibo/entrega/empaque) · cierres de maquila no deshechos · cargos EsMa
 * no cancelados · notas de salida **confirmadas** y vivas (que son también el camino del kardex de
 * AVÍOS) · compras comprometidas · kardex de PT y de TELA vivos · procesos de ruta crítica
 * **capturados de verdad** · hitos vivos · auditorías no canceladas · costo guardado · renglones de
 * EDR.
 *
 * **NO cuenta**, y cada exclusión tiene su porqué. La lista es EXHAUSTIVA sobre las relaciones de
 * `Orden`: si mañana nace otra, o entra aquí o entra abajo — lo que no puede es quedarse sin
 * decidir, porque el silencio se lee como «no lo pensé».
 *
 * *Derivados regenerables* (existen porque el sistema los recalculó, no porque alguien hiciera algo):
 *  • **`RequerimientoOrden`** (el snapshot del MRP): `mrp.ts` lo borra entero y lo recrea en cada
 *    explosión.
 *  • **`RutaOrden` por estar generada**: mismo patrón (`rutaOrden.ts` regenera la ruta) — ver la
 *    TRAMPA 3 de abajo, que es donde esto se puso caro.
 *  • **`OrdenTela` / `OrdenAvio` / `OrdenArte`** (la receta CONGELADA): nace con la orden por copia
 *    del BOM del modelo. Existir no es actividad; lo que sí lo es —que alguien la FIRMARA— viaja en
 *    `recetaLiberadaEn`.
 *
 * *Actos DESHECHOS*: etapas canceladas, notas canceladas, cierres deshechos, cargos EsMa cancelados,
 *  auditorías canceladas, hitos cancelados, movimientos anulados. Ya lo decidió
 *  `requisitos-orden.ts` (*«esa actividad se deshizo»*) y aquí se aplica a TODAS las familias.
 *
 * *Actos que NO son «comprado ni producido»* — la vara es la frase de DANIEL: *«si no hay nada
 *  comprado ni producido y borra el pedido está bien cancelar en cascada»*. Varios de éstos SÍ los
 *  hizo una persona, y aun así **no** conservan la OP: lo que la conserva es que haya material
 *  comprometido o piezas movidas, no que alguien la haya mirado.
 *  • **OC en BORRADOR**: ⭐ decidido por DANIEL el 7-sep-2026, textual: *«no cuenta como
 *    comprado»*. Por eso se usa {@link ESTATUS_OC_COMPROMETIDA} (autorizada + recibidas) y NO
 *    `ESTATUS_OC_QUE_CUBREN` (que sí incluye el borrador, porque contesta la otra pregunta: *«¿hace
 *    falta volver a comprar esto?»*). Un borrador no compromete a nadie frente al proveedor.
 *  • **`NotaSalida` en BORRADOR** (⭐ rechazo de la 0.150): `confirmadaEn` es *«cuándo se
 *    confirmó (se descontaron los avíos)»*. Una nota que nunca se confirmó no sacó un solo avío del
 *    almacén — **exactamente el mismo caso que el borrador de OC**, y por eso la misma respuesta.
 *  • **`RequerimientoCubierto`** («con esto queda cubierto», §Post-F9.99): es un acto humano, pero
 *    dice justo lo CONTRARIO de comprar — *«esto NO hace falta comprarlo»*. Y cuelga del mundo del
 *    snapshot del MRP, que arriba ya se descartó por regenerable.
 *  • **`FichaVerificacion`** (checklist de reactivos de F7-E4): alguien REVISÓ la orden. Revisar no
 *    compromete material ni mueve piezas; si de esa revisión salió algo real, ese algo tiene su
 *    propia señal (auditoría, hito, etapa).
 *  • **`OrdenPrecioEvento`** (historial inmutable del precio de maquila, R2): negociar un precio no
 *    es haber comprado. Lo que sí lo sería —el cargo al maquilero— es `EsMaCargo`, que ya cuenta.
 *  • **`OrdenComentario`** y **`OrdenArchivo`**: notas y adjuntos de apoyo. Conservar una OP porque
 *    alguien le pegó un comentario sería el falso positivo más barato de todos.
 *  • **`OrdenReferencia`** y **`OrdenFotoOculta`**: captura y presentación de la propia orden (la
 *    referencia del cliente, D7; qué foto no se enseña). Datos de la orden, no actividad sobre ella.
 *  • **`OrdenLinea`** (la matriz color×talla): es la orden misma. Si contara, NINGUNA orden sería
 *    cancelable en cascada y la casilla no serviría para nada.
 *  • **`DesarrolloOrden`** (liga desarrollo ↔ OP, F8-E6): decir de qué desarrollo nace la orden es
 *    trazabilidad, no consumo. El desarrollo sigue vivo con la OP cancelada.
 *  • **`InventarioCiclicoDet`**: sólo aparece cuando el conteo enumeró PT de esa orden — es decir,
 *    cuando ya hay existencia, y entonces **`kardex-pt` ya está encendida**. Contarlo no agregaría
 *    una sola orden conservada; sería una segunda verdad sobre el mismo hecho.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## 🔴 LAS TRES TRAMPAS QUE DEJAN LA GUARDA COJA (medidas, no supuestas)
 *
 * Las dos primeras la dejan de MENOS (deja pasar actividad real); la tercera, de MÁS (conserva
 * una orden que nadie tocó). Las tres se encontraron midiendo, ninguna razonando.
 *
 * **1. Al kardex se llega por TRES caminos distintos, no por una columna.**
 *    – PT: `MovimientoDetPt.idOrden` (columna real, con FK).
 *    – TELA: **no hay columna**. La salida a orden se marca con la referencia polimórfica
 *      `origenTipo = 'salida-tela-orden'` + `origenId = String(idOrden)` — ⚠️ `origenId` es
 *      **TEXTO** (ADR-0010 §1), así que se compara contra `String(id)`, nunca contra el número.
 *    – AVÍOS: por la **nota de salida** (`NotaSalidaLinea.idOrden`), que es quien genera el
 *      movimiento al confirmarse.
 *    Mirar sólo el camino obvio deja pasar un pedido cuya tela ya se surtió.
 *
 * **2. Cancelar un movimiento NO borra su rastro: lo DUPLICA.** `cancelarMovimientoPt`
 *    (`comun/kardex.ts`) crea el inverso **copiando `idOrden` del detalle original** (para
 *    neutralizar el mismo bucket). Un `count` pelón sobre `MovimientoDetPt.idOrden` **nunca da
 *    cero**, ni cuando toda la actividad se deshizo: la guarda bloquearía PARA SIEMPRE una orden
 *    limpia. Por eso los dos lados se descartan **por el encabezado**:
 *      – el original anulado → tiene inverso (`anuladoPor` no vacío);
 *      – el inverso mismo → apunta a su original (`idMovimientoInverso` no nulo).
 *    Lo mismo vale para la TELA con `cancelarMovimientoMaterial`.
 *
 * **3. `RutaOrden.fechaReal` NO significa «alguien capturó ese proceso».** Ésta se descubrió
 *    RECHAZANDO la primera versión de esta fila, y es la más cara de las tres porque disparaba en
 *    el caso de uso exacto de Daniel. `rutaOrden.ts` (§«Semántica de DURACIÓN 0») **auto-completa
 *    al GENERAR** todo proceso que quede con `duracionDias === 0` —resurtido, «Sin Aplicación» o
 *    tiempo estándar 0—: le escribe `fechaReal = fechaInicio`, `estado = 'completado'` y
 *    `origenCaptura = 'evento'`, y su propia cabecera aclara *«lo completó el sistema, no un
 *    usuario»*. ⇒ **programar la ruta crítica** —que se hace en la PLANEACIÓN, antes de comprar y
 *    de cortar— dejaba la OP conservada, con un `porque` que le decía al usuario *«ya tiene
 *    procesos capturados»* sobre una orden que nadie había tocado.
 *
 *    🔑 **Por qué NO basta con `duracionDias: { not: 0 }`** (que sería lo simple), medido en el
 *    código y no supuesto:
 *      – `completarProceso` (`cumplimiento.ts`) **no mira ni la duración ni el estado**: una
 *        persona SÍ puede capturar a mano un proceso de 0 días, y eso pone `origenCaptura='manual'`
 *        + `capturadoPorId`. Descartar por duración a secas se comería ese acto humano.
 *      – el ETL de la RC (`ruta-critica/migracion.ts`) escribe `origenCaptura: 'manual'` para toda
 *        `fechaReal` histórica, con `duracionDias` que puede ser 0.
 *    Por eso se descarta el **sello exacto del generador y sólo ése** — la TERNA
 *    `duracionDias = 0` **y** `capturadoPorId IS NULL` **y** `origenCaptura = 'evento'`—, que es lo
 *    único que escribe ese bloque y nadie más: la captura manual pone `'manual'`, el checklist
 *    (`cumplimiento.ts`) pone `capturadoPorId`, y el ETL pone `'manual'`.
 *
 *    ⚠️ El hueco que queda, dicho: un proceso de 0 días completado por el AUTO-AVANCE de F3/F4
 *    (`autoAvance.ts`, que deja `capturadoPorId` intacto) cae en la terna y no cuenta. No importa,
 *    y es por construcción: ese auto-avance lo dispara un corte, un recibo, una compra o un hito
 *    — y **cada uno de esos enciende su propia señal**. Por eso tampoco sirve `origenCaptura` solo
 *    como discriminador: `'evento'` lo usan también el auto-avance y el checklist.
 *
 *    ⚠️ Y la terna se escribe en POSITIVO (un `OR` de «no es el sello»), NUNCA como `NOT {terna}`:
 *    medido sobre el SQL que Prisma emite, `NOT (a AND b AND c)` con `origen_captura` NULL vale
 *    NULL y **tira la fila del conteo** — un falso negativo mudo, y del lado que cancela una OP
 *    con vida. Hoy ningún camino deja `fechaReal` con `origenCaptura` NULL (los cinco escritores
 *    ponen `'manual'` o `'evento'`), así que es un blindaje, no un arreglo; pero el `OR` cuesta lo
 *    mismo y no depende de que eso siga siendo cierto mañana.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * A9: **a propósito NO se filtra por empresa.** La pregunta es *«¿alguien ya movió esta orden?»* y
 * cualquier movimiento cuenta; un filtro de empresa sólo podría ESCONDER actividad, que es el lado
 * en el que esta guarda no puede equivocarse. La orden ya viene acotada por su pedido (A9).
 */
import { ESTATUS_OC_COMPROMETIDA } from '../compras/comprometido-en-oc.js';
import { ORIGEN } from '../../comun/origenes.js';
import type { Tx } from '../../comun/transaccion.js';
import { tieneActividadProduccion } from './requisitos-orden.js';

/** Cada FAMILIA de señal que hace que una orden «tenga vida». */
export type SenalActividadOrden =
  | 'cerrada'
  | 'receta-liberada'
  | 'receta-abierta'
  | 'produccion'
  | 'cierre-maquila'
  | 'esma'
  | 'notas-salida'
  | 'compras'
  | 'kardex-pt'
  | 'kardex-tela'
  | 'ruta-critica'
  | 'hitos'
  | 'auditorias'
  | 'costo'
  | 'edr';

/**
 * Cómo se NOMBRA cada señal en un mensaje al usuario. En lenguaje de negocio: quien lee esto está
 * decidiendo si va a Órdenes a cancelar una OP a mano, no depurando el esquema.
 */
export const ETIQUETA_SENAL_ACTIVIDAD: Record<SenalActividadOrden, string> = {
  cerrada: 'está CERRADA',
  'receta-liberada': 'su receta ya está liberada',
  'receta-abierta': 'su receta se abrió para corregir',
  produccion: 'ya tiene producción capturada (corte, envío, recibo o entrega)',
  'cierre-maquila': 'ya se cerró con un maquilero',
  esma: 'ya tiene cargos de maquila',
  'notas-salida': 'ya tiene notas de salida de material confirmadas',
  compras: 'ya tiene material comprado',
  'kardex-pt': 'ya movió inventario de producto terminado',
  'kardex-tela': 'ya se le surtió tela',
  'ruta-critica': 'ya tiene procesos capturados en su ruta crítica',
  hitos: 'ya tiene hitos registrados',
  auditorias: 'ya tiene auditorías de calidad',
  costo: 'ya tiene su costo guardado',
  edr: 'ya aparece en un estado de resultados',
};

/**
 * ORDEN en que se evalúan y se nombran las señales: de la más elocuente para quien lee («ya tiene
 * producción capturada») a la más administrativa. Es una constante y no el orden de un `Object.keys`
 * para que el mensaje sea ESTABLE (dos ejecuciones iguales dicen lo mismo, en el mismo orden).
 */
const SENALES_EN_ORDEN: readonly SenalActividadOrden[] = [
  'produccion',
  'kardex-pt',
  'kardex-tela',
  'notas-salida',
  'compras',
  'cierre-maquila',
  'esma',
  'auditorias',
  'ruta-critica',
  'hitos',
  'costo',
  'edr',
  'cerrada',
  'receta-liberada',
  'receta-abierta',
];

/**
 * Lo que la ORDEN misma ya contesta, sin una consulta extra. Las tres columnas viajan en la fila
 * que el llamador ya leyó (`cancelarPedido` las trae en su `select`), así que preguntarlas es
 * GRATIS: pedirlas por parámetro —en vez de re-leer la orden aquí— evita una consulta por orden.
 */
export interface OrdenParaActividad {
  id: number;
  /** Sello de «esta orden está cerrada» (la verdad autoritativa; el `estado` es su espejo). */
  cerradaEn: Date | null;
  /** Desarrollo firmó la receta congelada de ESTA orden por completo. */
  recetaLiberadaEn: Date | null;
  /** La receta liberada se volvió a abrir para corregir (otro acto de una persona). */
  recetaAbiertaEn: Date | null;
}

/**
 * ⭐ LA FUNCIÓN. Devuelve TODAS las señales de vida de UNA orden, en el orden de
 * {@link SENALES_EN_ORDEN}. Arreglo vacío = la orden está limpia y se puede cancelar en cascada
 * sin quitarle nada a nadie.
 *
 * Es una LECTURA (no escribe), pero recibe `tx` a propósito: sus llamadores la usan **dentro** de
 * la transacción que va a cancelar, después de tomar el bloqueo de la orden, para que nada se cuele
 * entre la comprobación y el `update` (A2).
 *
 * ⚠️ Es POR ORDEN, no por lote: así puede REUSAR `tieneActividadProduccion` tal cual (una función
 * de una orden) en vez de re-escribir su `count` agrupado, que es justo la duplicación que esta
 * fila vino a pagar. Sus llamadores cancelan «una orden a la vez» —ya lo hacían— y un pedido tiene
 * un puñado de OPs.
 *
 * ⚠️ **El `Promise.all` NO las hace concurrentes, y conviene no engañarse:** son **13 consultas**
 * (12 `count` aquí + el de `tieneActividadProduccion`) dentro de una transacción INTERACTIVA, o
 * sea sobre UNA sola conexión, así que `pg` las **encola y las corre en serie** (se nota: el driver
 * avisa *«Calling client.query() when the client is already executing a query»*). El `Promise.all`
 * sirve para escribirlas juntas y que ninguna se olvide, no para ganar tiempo. Son 13 `count` por
 * índice en una operación que se hace una vez por pedido cancelado: se deja así a propósito,
 * porque la alternativa —una consulta por lote— obligaría a duplicar `tieneActividadProduccion`.
 */
export async function senalesDeActividadOrden(
  tx: Tx,
  orden: OrdenParaActividad,
): Promise<SenalActividadOrden[]> {
  const idOrden = orden.id;

  const [
    produccion,
    cierreMaquila,
    esma,
    notasSalida,
    lineasCompra,
    ligasCompra,
    kardexPt,
    kardexTela,
    rutaCritica,
    hitos,
    auditorias,
    costo,
    edr,
  ] = await Promise.all([
    // ⭐ REUSO, no copia: la MISMA función que protege el des-completar (`requisitos-orden.ts`).
    tieneActividadProduccion(tx, idOrden),
    tx.cierreMaquilaOrden.count({ where: { idOrden, deshechoEn: null } }),
    tx.esMaCargo.count({ where: { idOrden, estado: { not: 'cancelado' } } }),
    // Las notas CONFIRMADAS y vivas. Es también el camino del kardex de AVÍOS: el descuento del
    // avío nace **al confirmar** la nota (`confirmadaEn`), y cuelga de este mismo renglón. Un
    // BORRADOR no ha sacado nada del almacén — mismo criterio que el borrador de OC (Daniel).
    tx.notaSalidaLinea.count({
      where: { idOrden, notaSalida: { confirmadaEn: { not: null }, canceladaEn: null } },
    }),
    // COMPRAS por los dos caminos: el renglón que nombra la orden y la liga OC↔orden (que el
    // esquema declara derivada de los renglones, pero se mira igual: nunca de menos).
    tx.ordenCompraLinea.count({
      where: { idOrden, ordenCompra: { estatus: { in: [...ESTATUS_OC_COMPROMETIDA] } } },
    }),
    tx.ordenCompraOrden.count({
      where: { idOrden, ordenCompra: { estatus: { in: [...ESTATUS_OC_COMPROMETIDA] } } },
    }),
    // 🔴 TRAMPA 2: se descartan por el ENCABEZADO tanto el original anulado (`anuladoPor` no
    // vacío) como el propio inverso (`idMovimientoInverso` no nulo), que hereda el `idOrden`.
    tx.movimientoDetPt.count({
      where: { idOrden, movimiento: { idMovimientoInverso: null, anuladoPor: { none: {} } } },
    }),
    // 🔴 TRAMPA 1: la tela NO tiene columna de orden — se llega por la referencia polimórfica, y
    // `origenId` es TEXTO. Mismo descarte de anulados que arriba.
    tx.movimiento.count({
      where: {
        origenTipo: ORIGEN.salidaTelaOrden,
        origenId: String(idOrden),
        idMovimientoInverso: null,
        anuladoPor: { none: {} },
      },
    }),
    // 🔴 TRAMPA 3 (rechazo de la 0.150): `fechaReal` NO siempre es una captura. `rutaOrden.ts`
    // AUTO-COMPLETA al GENERAR todo proceso de `duracionDias === 0` —le escribe `fechaReal`,
    // `estado='completado'` y `origenCaptura='evento'`— así que **programar la RC**, que pasa en la
    // planeación y antes de cortar, encendía esta señal sobre una orden sin un solo movimiento.
    // Se descarta ESE sello y sólo ése (ver la cabecera para por qué no basta `duracionDias`).
    tx.rutaOrden.count({
      where: {
        idOrden,
        fechaReal: { not: null },
        // ⚠️ Se escribe en POSITIVO (un OR de «no es el sello») y NO como `NOT: {terna}`, porque
        // esa forma es una trampa de SQL medida, no supuesta: Prisma la traduce a
        // `NOT (dur = 0 AND capturado IS NULL AND origen = 'evento')`, y con `origen_captura`
        // NULL el paréntesis vale NULL ⇒ `NOT NULL` = NULL ⇒ **la fila se cae del conteo**. El
        // fallo sería mudo y del lado caro (cancelar una OP con vida). La rama `origenCaptura:
        // null` es la que repara ese hueco: `<> 'evento'` por sí solo NO incluye los NULL.
        OR: [
          { duracionDias: { not: 0 } },
          { capturadoPorId: { not: null } },
          { origenCaptura: { not: 'evento' } },
          { origenCaptura: null },
        ],
      },
    }),
    tx.hitoOrden.count({ where: { idOrden, canceladoEn: null } }),
    tx.auditoria.count({ where: { idOrden, cancelada: false } }),
    tx.costoOrden.count({ where: { idOrden } }),
    tx.edrLinea.count({ where: { idOrden } }),
  ]);

  const encendidas: Record<SenalActividadOrden, boolean> = {
    cerrada: orden.cerradaEn !== null,
    'receta-liberada': orden.recetaLiberadaEn !== null,
    'receta-abierta': orden.recetaAbiertaEn !== null,
    produccion,
    'cierre-maquila': cierreMaquila > 0,
    esma: esma > 0,
    'notas-salida': notasSalida > 0,
    compras: lineasCompra > 0 || ligasCompra > 0,
    'kardex-pt': kardexPt > 0,
    'kardex-tela': kardexTela > 0,
    'ruta-critica': rutaCritica > 0,
    hitos: hitos > 0,
    auditorias: auditorias > 0,
    costo: costo > 0,
    edr: edr > 0,
  };

  return SENALES_EN_ORDEN.filter((s) => encendidas[s]);
}

/**
 * Las señales de una orden en UNA frase de negocio: `"ya tiene producción capturada (corte, envío,
 * recibo o entrega) y ya se le surtió tela"`. Cadena vacía si no hay ninguna (el llamador no
 * debería llegar aquí en ese caso).
 *
 * Vive junto a la regla —y no en quien redacta el mensaje— para que TODA pantalla que nombre estas
 * señales las diga igual. Las etiquetas salen de {@link ETIQUETA_SENAL_ACTIVIDAD}, así que el texto
 * sigue a la regla y no al revés.
 */
export function textoSenalesActividad(senales: readonly SenalActividadOrden[]): string {
  if (senales.length === 0) return '';
  const etiquetas = senales.map((s) => ETIQUETA_SENAL_ACTIVIDAD[s]);
  const ultima = etiquetas.pop() as string;
  return etiquetas.length === 0 ? ultima : `${etiquetas.join(', ')} y ${ultima}`;
}
